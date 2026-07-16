// Verify dataset.json.gz: gunzip -> JSON.parse -> delta-decode -> reproduce
// total play count, total ms, and top artist by ms. Mirrors the browser decode path
// (DecompressionStream('gzip')) but uses zlib here since we run under Node.
// Usage: node pipeline/verify.mjs [dataset.json.gz] [dataset.json]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const GZ = process.argv[2] || "dataset.json.gz";
const RAW = process.argv[3] || GZ.replace(/\.gz$/, "");

// 1. decompress + parse
const buf = gunzipSync(readFileSync(GZ));
const d = JSON.parse(buf.toString("utf-8"));

// sanity: gz decode must equal the plain minified file
const plain = readFileSync(RAW, "utf-8");
if (buf.toString("utf-8") !== plain) throw new Error("gz payload != dataset.json");

const n = d.n;
const cols = ["dt", "ms", "tr", "ty", "pf", "co", "rs", "re", "fl"];
for (const c of cols) {
  if (d[c].length !== n) throw new Error(`length mismatch: ${c} ${d[c].length} != ${n}`);
}

// 2. delta-decode local timestamps into typed array (as the browser would)
const t = new Float64Array(n); // seconds; local-shifted epoch
let acc = d.t0;
for (let i = 0; i < n; i++) {
  acc += d.dt[i];
  if (d.dt[i] < 0) throw new Error("negative delta at " + i);
  t[i] = acc;
}

// 3. re-aggregate: total plays, total ms, top artist by ms (music only, ty===0)
let totalMs = 0;
const artistMs = new Map();
const yearPlays = new Map();
let skip = 0, shuf = 0;
for (let i = 0; i < n; i++) {
  totalMs += d.ms[i];
  if (d.fl[i] & 2) skip++;
  if (d.fl[i] & 1) shuf++;
  // derive local year from local-shifted epoch via getUTCFullYear
  const yr = new Date(t[i] * 1000).getUTCFullYear();
  yearPlays.set(yr, (yearPlays.get(yr) || 0) + 1);
  if (d.ty[i] === 0) {
    const aid = d.trackArtist[d.tr[i]];
    artistMs.set(aid, (artistMs.get(aid) || 0) + d.ms[i]);
  }
}
let topAid = -1, topMs = -1;
for (const [aid, ms] of artistMs) if (ms > topMs) { topMs = ms; topAid = aid; }

const out = {
  totalPlays: n,
  totalMs,
  topArtist: d.artists[topAid],
  topArtistMs: topMs,
  skipRate: +(skip / n).toFixed(4),
  shuffleRate: +(shuf / n).toFixed(4),
  firstLocal: new Date(t[0] * 1000).toISOString().slice(0, 10),
  lastLocal: new Date(t[n - 1] * 1000).toISOString().slice(0, 10),
  yearPlays: Object.fromEntries([...yearPlays.entries()].sort()),
};

// 4. cross-check against embedded meta
const m = d.meta;
const checks = [
  ["totalPlays", out.totalPlays === m.totalPlays],
  ["totalMs", out.totalMs === m.totalMs],
  ["skipRate", out.skipRate === m.skipRate],
  ["shuffleRate", out.shuffleRate === m.shuffleRate],
];
console.log(JSON.stringify(out, null, 2));
let ok = true;
for (const [k, pass] of checks) { if (!pass) { ok = false; console.error("MISMATCH:", k); } }
if (!ok) { console.error("VERIFY FAILED"); process.exit(1); }
console.log("\nVERIFY OK: gz decodable, JSON parsed, deltas decoded, aggregates match meta.");
