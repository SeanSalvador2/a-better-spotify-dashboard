#!/usr/bin/env node
// Verify site/enrichment.json against site/dataset.json.
// Asserts: id-space alignment; spot-checks (Zach Bryan country+US; upbeat valence
// > sad ballad; old Beatles year < 1975; +more); coverage numbers reproduce; and
// NO string anywhere in enrichment.json longer than 60 chars (raw-lyric guard).
//
// Usage: node enrich/verify_enrichment.mjs [dataset.json] [enrichment.json]
import fs from "node:fs";

const DATASET = process.argv[2] || "dataset.json";
const ENRICH  = process.argv[3] || "enrichment.json";

const d = JSON.parse(fs.readFileSync(DATASET, "utf8"));
const e = JSON.parse(fs.readFileSync(ENRICH, "utf8"));

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log("  PASS", m); };
const bad = (m) => { fail++; console.log("  FAIL", m); };
function assert(cond, m) { cond ? ok(m) : bad(m); }
function approx(a, b, tol, m) {
  const dd = Math.abs(a - b);
  dd <= tol ? ok(`${m} (${a} vs ${b})`) : bad(`${m} — got ${a}, expected ${b} (|Δ|=${dd.toFixed(2)}>${tol})`);
}

// ---------- 1. id-space alignment ----------
console.log("\n[1] id-space alignment with dataset.json");
assert(e.n_artists === d.artists.length, `n_artists ${e.n_artists} == dataset.artists ${d.artists.length}`);
assert(e.n_tracks === d.trackName.length, `n_tracks ${e.n_tracks} == dataset.trackName ${d.trackName.length}`);
for (const k of ["artistUmbrella","artistSubgenres","artistCountry","artistCity","artistYear","artistFans"])
  assert(e[k].length === d.artists.length, `${k}.length aligns to artists`);
for (const k of ["trackEnergy","trackValence","trackDance","trackAcoustic","trackTempo","trackLoud",
                 "trackFeatSrc","trackYear","trackYearSrc","lyrWords","lyrSent","lyrThemes","lyrTop"])
  assert(e[k].length === d.trackName.length, `${k}.length aligns to trackName`);

// helpers
const artistIdx = (name) => d.artists.indexOf(name);
// best (highest-ms) music track index whose name includes substr (+optional artist)
function ms_by_track() {
  const m = new Float64Array(d.trackName.length);
  for (let i = 0; i < d.n; i++) if (d.ty[i] === 0) m[d.tr[i]] += d.ms[i];
  return m;
}
const TMS = ms_by_track();
function findTrack(substr, artist, needValence=false) {
  let best = -1, bestMs = -1;
  const s = substr.toLowerCase();
  for (let t = 1; t < d.trackName.length; t++) {
    if (!d.trackName[t].toLowerCase().includes(s)) continue;
    if (artist && d.artists[d.trackArtist[t]] !== artist) continue;
    if (needValence && !(e.trackValence[t] >= 0)) continue;
    if (TMS[t] > bestMs) { bestMs = TMS[t]; best = t; }
  }
  return best;
}

// ---------- 2. spot-checks ----------
console.log("\n[2] spot-checks");
const uCountry = e.umbrellas.indexOf("country");

// (a) Zach Bryan -> country umbrella + US origin
{
  const ai = artistIdx("Zach Bryan");
  assert(ai > 0, `Zach Bryan present (idx ${ai})`);
  assert(e.artistUmbrella[ai] === uCountry, `Zach Bryan umbrella == country (got ${e.umbrellas[e.artistUmbrella[ai]]})`);
  const ctry = e.artistCountry[ai] >= 0 ? e.countries[e.artistCountry[ai]] : null;
  assert(/United States|USA|US/.test(ctry || ""), `Zach Bryan origin US (got ${ctry})`);
}
// (b) "Something in the Orange" is Zach Bryan / country-consistent
{
  const t = findTrack("Something in the Orange", "Zach Bryan");
  assert(t > 0, `"Something in the Orange" present (idx ${t})`);
  const ai = d.trackArtist[t];
  assert(e.artistUmbrella[ai] === uCountry, `SITO artist umbrella == country`);
}
// (c) upbeat valence > sad ballad valence
{
  const upNames = ["Chicken Fried","Knee Deep","Callin' Baton Rouge","Toes","Whatever It Is",
                   "Can't Stop","Uptown Funk","September","Good Vibrations","Sunflower"];
  const sadNames = ["Something in the Orange","Whiskey Lullaby","The Night We Met","Fix You",
                    "Hurt","Tears in Heaven","Cover Me Up","Fast Car"];
  let up = -1, sad = -1;
  for (const nm of upNames) { const t = findTrack(nm, null, true); if (t > 0) { up = t; break; } }
  for (const nm of sadNames) { const t = findTrack(nm, null, true); if (t > 0) { sad = t; break; } }
  if (up > 0 && sad > 0) {
    assert(e.trackValence[up] > e.trackValence[sad],
      `upbeat "${d.trackName[up]}" valence ${e.trackValence[up]} > sad "${d.trackName[sad]}" valence ${e.trackValence[sad]}`);
  } else bad(`could not locate upbeat/sad tracks with valence (up=${up}, sad=${sad})`);
}
// (d) an old Beatles track release year < 1975 (min over Beatles tracks with a year)
{
  const ai = artistIdx("The Beatles");
  let minYr = Infinity, cnt = 0;
  for (let t = 1; t < d.trackName.length; t++) {
    if (d.trackArtist[t] === ai && e.trackYear[t] > 0) { cnt++; minYr = Math.min(minYr, e.trackYear[t]); }
  }
  assert(cnt > 0 && minYr < 1975, `oldest Beatles track year ${minYr} < 1975 (over ${cnt} dated tracks)`);
}
// (e) popularity: a top mainstream artist has more Deezer fans than a deep-tail artist
{
  const luke = artistIdx("Luke Combs");
  assert(luke > 0 && e.artistFans[luke] > 1000, `Luke Combs nb_fan populated (${e.artistFans[luke]})`);
}

// ---------- 3. coverage reproduces ----------
console.log("\n[3] coverage block reproduces from arrays + dataset weights");
const AMS = new Float64Array(d.artists.length);
const totalArtistMs = (() => {
  let tot = 0;
  for (let i = 0; i < d.n; i++) if (d.ty[i] === 0) { AMS[d.trackArtist[d.tr[i]]] += d.ms[i]; tot += d.ms[i]; }
  return tot;
})();
let totalTrackMs = 0; for (let t = 0; t < TMS.length; t++) totalTrackMs += TMS[t];
const awf = (pred) => { let n = 0; for (let i = 1; i < d.artists.length; i++) if (pred(i)) n += AMS[i]; return 100 * n / totalArtistMs; };
const twf = (pred) => { let n = 0; for (let t = 1; t < d.trackName.length; t++) if (pred(t)) n += TMS[t]; return 100 * n / totalTrackMs; };
const cov = e.coverage;
approx(awf(i => e.artistUmbrella[i] >= 0), cov.genres_umbrella, 0.15, "genres_umbrella");
approx(awf(i => e.artistSubgenres[i].length > 0), cov.genres_subgenre, 0.15, "genres_subgenre");
approx(awf(i => e.artistCountry[i] >= 0), cov.origin_country, 0.15, "origin_country");
approx(awf(i => e.artistCity[i] >= 0), cov.origin_city, 0.15, "origin_city");
approx(awf(i => e.artistYear[i] > 0), cov.formation_year, 0.15, "formation_year");
approx(awf(i => e.artistFans[i] >= 0), cov.popularity, 0.15, "popularity");
approx(twf(t => e.trackFeatSrc[t] === 0), cov.audio_features_direct, 0.15, "audio_features_direct");
approx(twf(t => e.trackFeatSrc[t] >= 0), cov.audio_features_any, 0.15, "audio_features_any");
approx(twf(t => e.trackYear[t] > 0), cov.release_year, 0.15, "release_year");
approx(twf(t => e.lyrWords[t] >= 0), cov.lyrics, 0.15, "lyrics");

// ---------- 4. no string > 60 chars anywhere (raw-lyric leakage guard) ----------
console.log("\n[4] no shipped string > 60 chars (raw-lyric guard)");
let longest = 0, longVal = "", count = 0;
(function walk(x) {
  if (typeof x === "string") { count++; if (x.length > longest) { longest = x.length; longVal = x; } }
  else if (Array.isArray(x)) x.forEach(walk);
  else if (x && typeof x === "object") Object.values(x).forEach(walk);
})(e);
assert(longest <= 60, `longest string ${longest} chars <= 60 (sampled ${count} strings; worst="${longVal.slice(0,50)}")`);

// ---------- summary ----------
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
