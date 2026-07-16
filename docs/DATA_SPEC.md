# Spotify Dashboard — Dataset Spec (`dataset.json`)

Compact columnar dataset for a single-file, fully client-side Spotify listening
dashboard. It is minified, gzip -9 compressed, base64-embedded in the HTML, and
decompressed in-browser via `DecompressionStream('gzip')`. Every play survives as
its own row so the browser can re-aggregate everything on any filter change.

- Source: Spotify Extended Streaming History (Audio + Video JSON).
- Build script: `pipeline/build_dataset.py` — Node verifier: `pipeline/verify.mjs`.
- `ip_addr` is **dropped** for privacy; `conn_country` is kept.
- Format version: `v = 1`.

---

## 1. Top-level shape (struct-of-arrays)

```jsonc
{
  "v": 1,
  "meta": { ...headline stats... },

  // ---- dictionaries (index = id) ----
  "artists":     ["Unknown", "Zach Bryan", ...],       // id 0 = Unknown sentinel
  "trackName":   ["Unknown", "Buttercup", ...],        // id 0 = Unknown sentinel
  "trackArtist": [0, 12, ...],                          // artist id, parallel to trackName
  "trackAlbum":  [0, 34, ...],                          // album id,  parallel to trackName
  "albumName":   ["Unknown", "Pop Food", ...],         // id 0 = Unknown sentinel
  "albumArtist": [0, 12, ...],                          // artist id, parallel to albumName
  "shows":       ["Unknown", "2021 Wrapped", ...],     // podcast show names
  "epName":      ["Luke Combs", ...],                  // podcast episode names
  "epShow":      [1, ...],                              // show id, parallel to epName
  "abTitle":     ["Icebreaker", "The Complete Athlete"],// audiobook titles
  "platforms":   ["iPhone","Windows","Mac",...],       // normalized device categories
  "countries":   ["US","DE",...],                      // conn_country (ISO-2)
  "reasonStart": ["playbtn","trackdone",...],
  "reasonEnd":   ["trackdone","endplay",...],

  // ---- per-play columnar arrays (all length n, sorted by local ts ascending) ----
  "n":  225845,
  "t0": 1605...,          // local-shifted epoch seconds of the FIRST play
  "dt": [0, 5, 210, ...], // delta seconds from previous play (dt[0] = 0, all >= 0)
  "ms": [208026, ...],    // ms_played (integer milliseconds, unrounded)
  "tr": [12, ...],        // id into track / episode / audiobook space, chosen by ty
  "ty": [0, ...],         // 0 = music, 1 = podcast, 2 = audiobook
  "pf": [0, ...],         // platform id
  "co": [0, ...],         // country id
  "rs": [1, ...],         // reason_start id
  "re": [0, ...],         // reason_end id
  "fl": [3, ...]          // bitflags: bit0 shuffle, bit1 skipped, bit2 offline, bit3 incognito
}
```

All 9 per-play arrays (`dt, ms, tr, ty, pf, co, rs, re, fl`) have length `n` and
share row order (ascending local time).

---

## 2. ID schemes

The `tr` column is a **type-tagged** id: its meaning depends on `ty[i]`, so the
three content types share the `tr` column but use **separate id spaces**.

| `ty` | meaning   | `tr` indexes | resolve name / metadata |
|------|-----------|--------------|--------------------------|
| 0    | music     | `trackName[]` | `trackName[tr]`, artist `artists[trackArtist[tr]]`, album `albumName[trackAlbum[tr]]` |
| 1    | podcast   | `epName[]`    | `epName[tr]`, show `shows[epShow[tr]]` |
| 2    | audiobook | `abTitle[]`   | `abTitle[tr]` |

Other columns are plain dictionary ids: `pf → platforms`, `co → countries`,
`rs → reasonStart`, `re → reasonEnd`.

**Sentinels.** `artists[0] = trackName[0] = albumName[0] = shows[0] = "Unknown"`.
Music plays whose `master_metadata_track_name` was `null` (7 of them — rapid
`unknown`→`endplay` blips on iOS, likely local files / ad skips) are kept as
`ty=0, tr=0` (the Unknown track). They are counted in totals but attributed to the
Unknown artist/track/album so they never pollute real top-N lists.

**Track de-duplication key.** Tracks are interned by `spotify_track_uri` when
present (stable across renames), else by `(name, artistId)`. Episodes by
`spotify_episode_uri`, audiobooks by `audiobook_uri`.

---

## 3. Encoding decisions

- **Local time baked in (DST-aware).** Source `ts` is UTC. Each timestamp is
  converted to `America/New_York` with `zoneinfo` (so DST is handled per-record),
  then stored as a **local-shifted epoch**: the UTC-epoch value whose UTC wall
  clock equals the New York wall clock. Result: in the browser,
  `new Date(t*1000).getUTCHours()` / `getUTCDay()` / `getUTCFullYear()` yield the
  real local hour / weekday / year with no further tz math.
- **Delta-encoded timestamps.** Rows are sorted by local epoch ascending; `t0`
  holds the first absolute value and `dt[i]` holds the non-negative gap to the
  previous row. This compresses far better than absolute epochs under gzip.
- **`ms` kept as raw integer milliseconds** (not rounded). The gzip target was met
  with huge margin (1.43 MB vs 6 MB), so no lossy rounding was applied.
- **Bit-packed flags** collapse 4 booleans into one small int (`fl`).
- **No derived per-play fields** (hour, weekday, year) are stored — the browser
  derives them once from `t` into typed arrays at load (see snippet below).
- **Platform normalization**: 19 raw platform strings bucketed into 6 device
  categories (see §5). Raw→category counts preserved in this spec.

---

## 4. Browser decode snippet

```js
// gz = Uint8Array of the gzip bytes (from atob(base64) → bytes)
async function loadDataset(gzBytes) {
  const ds = new DecompressionStream('gzip');
  const buf = await new Response(
    new Blob([gzBytes]).stream().pipeThrough(ds)
  ).arrayBuffer();
  const d = JSON.parse(new TextDecoder().decode(buf));

  const n = d.n;

  // ---- delta-decode local timestamps into a typed array ----
  const t = new Float64Array(n);         // local-shifted epoch seconds
  let acc = d.t0;
  for (let i = 0; i < n; i++) { acc += d.dt[i]; t[i] = acc; }

  // ---- derive local hour / weekday / year once (no tz math needed) ----
  const hour = new Uint8Array(n), dow = new Uint8Array(n), year = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const dt = new Date(t[i] * 1000);
    hour[i] = dt.getUTCHours();          // local hour (0-23)
    dow[i]  = dt.getUTCDay();            // 0 = Sun ... 6 = Sat, local
    year[i] = dt.getUTCFullYear();      // local year
  }

  // ---- unpack flags ----
  const shuffle = i => !!(d.fl[i] & 1);
  const skipped = i => !!(d.fl[i] & 2);
  const offline = i => !!(d.fl[i] & 4);
  const incognito = i => !!(d.fl[i] & 8);

  // ---- resolve a row's display name by type ----
  function nameOf(i) {
    const tr = d.tr[i];
    switch (d.ty[i]) {
      case 0: return { title: d.trackName[tr],
                       artist: d.artists[d.trackArtist[tr]],
                       album:  d.albumName[d.trackAlbum[tr]] };
      case 1: return { title: d.epName[tr], show: d.shows[d.epShow[tr]] };
      case 2: return { title: d.abTitle[tr] };
    }
  }

  return { d, n, t, hour, dow, year, shuffle, skipped, offline, incognito, nameOf };
}

// Example re-aggregation: total ms per artist for music plays only
function artistMs(x) {
  const { d, n } = x, out = new Map();
  for (let i = 0; i < n; i++) {
    if (d.ty[i] !== 0) continue;
    const aid = d.trackArtist[d.tr[i]];
    out.set(aid, (out.get(aid) || 0) + d.ms[i]);
  }
  return out; // Map<artistId, ms>
}
```

---

## 5. Headline stats

Generated by `build_dataset.py` (also embedded in `dataset.meta`).

| Metric | Value |
|---|---|
| Total plays | **225,845** |
| Total ms played | **36,176,535,237 ms** (≈ 10,049 hours / 419 days) |
| Date range (local) | **2020-11-11 → 2026-07-12** |
| Unique artists | 2,660 |
| Unique tracks | 8,634 |
| Unique albums | 5,169 |
| Unique podcast shows | 81 |
| Unique podcast episodes | 184 |
| Unique audiobooks | 2 |
| Null-track plays (→ Unknown sentinel) | 7 |
| Skip rate | 25.88% |
| Shuffle rate | 65.03% |

### Type split (podcast vs music vs audiobook)

| Type | Plays |
|---|---|
| Music (0) | 225,276 |
| Podcast (1) | 565 |
| Audiobook (2) | 4 |

### Plays per year (local time)

| Year | Plays |
|---|---|
| 2020 | 2,514 |
| 2021 | 31,142 |
| 2022 | 47,442 |
| 2023 | 42,216 |
| 2024 | 39,685 |
| 2025 | 43,586 |
| 2026 | 19,260 (partial, through July) |

### Top 10 artists by ms

| Artist | Hours |
|---|---|
| Zach Bryan | 806.1 |
| Luke Combs | 791.6 |
| Morgan Wallen | 570.5 |
| Kanye West | 391.4 |
| Rex Orange County | 345.8 |
| Megan Moroney | 235.7 |
| Zac Brown Band | 192.7 |
| Chris Stapleton | 156.3 |
| The Beatles | 140.0 |
| Tyler Childers | 119.0 |

### Top 10 artists by plays

| Artist | Plays |
|---|---|
| Zach Bryan | 18,343 |
| Luke Combs | 17,400 |
| Morgan Wallen | 13,594 |
| Kanye West | 7,675 |
| Rex Orange County | 7,094 |
| Megan Moroney | 5,357 |
| Zac Brown Band | 4,150 |
| The Beatles | 3,659 |
| Chris Stapleton | 3,259 |
| Tyler Childers | 2,698 |

### Top 10 tracks by ms

| Track | Artist | Hours |
|---|---|---|
| What Are You Listening To? | Chris Stapleton | 42.5 |
| What Are You Listening To? | Megan Moroney | 29.8 |
| Always | Rex Orange County | 27.8 |
| Talkin' Tennessee | Morgan Wallen | 25.8 |
| Does To Me (feat. Eric Church) | Luke Combs | 25.1 |
| It's Not The Same Anymore | Rex Orange County | 24.4 |
| Houston, We Got a Problem | Luke Combs | 24.3 |
| Moon Over Mexico | Luke Combs | 24.1 |
| Outrunnin' Your Memory | Luke Combs | 23.9 |
| Last Call | Kanye West | 23.7 |

### Top 10 tracks by plays

| Track | Artist | Plays |
|---|---|---|
| What Are You Listening To? | Chris Stapleton | 853 |
| Houston, We Got a Problem | Luke Combs | 585 |
| Always | Rex Orange County | 578 |
| What Are You Listening To? | Megan Moroney | 570 |
| Moon Over Mexico | Luke Combs | 541 |
| Nothing Like You | Luke Combs | 511 |
| Talkin' Tennessee | Morgan Wallen | 508 |
| Does To Me (feat. Eric Church) | Luke Combs | 504 |
| Whatever It Is | Zac Brown Band | 477 |
| Mine Again | Zach Bryan | 466 |

### Platform categories (normalized) — play counts

| Category | Plays |
|---|---|
| iPhone | 172,675 |
| Windows | 52,187 |
| Mac | 732 |
| Android | 115 |
| iPad | 109 |
| Web Player | 27 |

#### Raw platform string → category mapping (raw counts)

| Raw platform | Count | Category |
|---|---|---|
| `ios` | 121,907 | iPhone |
| `windows` | 32,934 | Windows |
| `iOS 15.3.1 (iPhone10,1)` | 26,358 | iPhone |
| `iOS 14.7.1 (iPhone10,1)` | 20,492 | iPhone |
| `Windows 10 (10.0.18363; x64)` | 13,181 | Windows |
| `Windows 10 (10.0.19043; x64; AppX)` | 3,825 | Windows |
| `iOS 14.4.2 (iPhone10,1)` | 3,724 | iPhone |
| `Windows 10 (10.0.22000; x64; AppX)` | 2,237 | Windows |
| `osx` | 732 | Mac |
| `android` | 115 | Android |
| `iOS 12.5.5 (iPad4,4)` | 109 | iPad |
| `iOS 14.2 (iPhone10,1)` | 81 | iPhone |
| `iOS 14.4 (iPhone10,1)` | 81 | iPhone |
| `iOS 13.7 (iPhone10,1)` | 32 | iPhone |
| `web_player windows 10;chrome 99.0.4844.51;desktop` | 25 | Web Player |
| `Windows 10 (10.0.22000; x64)` | 6 | Windows |
| `Windows 10 (10.0.19043; x64)` | 4 | Windows |
| `web_player windows 10;chrome 92.0.4515.159;desktop` | 1 | Web Player |
| `web_player windows 10;chrome 98.0.4758.81;desktop` | 1 | Web Player |

Raw counts are post-dedup (see §6), so a few differ slightly from the totals in the
original files.

### Countries (`conn_country`)

`US`, `DE`, `PH`, `SG`, `NL`, `GR`, `TR`, `CA` — overwhelmingly `US`; the others
are travel blips.

---

## 6. Data quirks & pipeline notes

- **Audio vs Video files.** 225,692 audio records + 602 video records. Video files
  do **not** duplicate audio — they *complement* it with Spotify "Wrapped" recap
  videos and video-podcast episodes (all resolve to podcast/`ty=1` via
  `episode_name`). No audio↔video exact duplicates were found.
- **449 exact-duplicate records removed.** Deduped on `(ts, uri, ms_played)`. These
  are within the audio export itself, from overlapping year-split files (e.g.
  `..._2021.json` and `..._2021_1.json`). Final row count 226,294 → 225,845.
- **Null tracks (7).** Handled via the Unknown sentinel (see §2).
- **`offline` had 64 `null` values** — treated as `false` (bit unset).
- **`platform` is inconsistent across the export's lifetime**: early records use
  verbose strings (`iOS 15.3.1 (iPhone10,1)`, `Windows 10 (10.0.18363; x64)`,
  `web_player ...;chrome ...`), later records use terse lowercase tokens (`ios`,
  `windows`, `osx`, `android`). Both forms are normalized into the 6 categories.
  One `iPad4,4` model string is the only iPad signal; generic lowercase `ios` is
  bucketed as iPhone.
- **Only 2 audiobooks / 4 plays and 565 podcast plays** — this library is ~99.8%
  music (heavily country).

---

## 7. File sizes

| File | Size |
|---|---|
| `site/dataset.json` (minified) | 6,505,099 bytes (6.51 MB) |
| `site/dataset.json.gz` (gzip -9) | 1,434,409 bytes (1.43 MB) |

Target was gzipped ≤ 6 MB — met with ~4× headroom, so no lossy encoding
(ms rounding) was needed.

---

# ENRICHMENT (`enrichment.json`)

A companion file, `site/enrichment.json` (+ gzip), adds genres, audio features,
release years, artist origin, popularity, and lyric-derived stats. It is built by
the pipeline under `enrich/` from free public sources (no auth) and is **index-
aligned with `dataset.json`**: enrichment artist arrays are parallel to
`dataset.artists[]`, and enrichment track arrays are parallel to
`dataset.trackName[]` (same interning, verified element-for-element by
`enrich/idmap.py`). So `enrichment.artistUmbrella[dataset.trackArtist[tr]]` is the
umbrella genre of the artist of track `tr`, and `enrichment.trackValence[tr]` is
that track's valence. Index `0` is the `Unknown` sentinel in both spaces.

Load it exactly like `dataset.json` (gzip → JSON). It is small (gzip well under the
1.5 MB budget) because it is dictionary-encoded and integer-quantized.

## Top-level shape

```jsonc
{
  "v": 1,
  "n_artists": 2661,           // == dataset.artists.length (incl. Unknown[0])
  "n_tracks":  8635,           // == dataset.trackName.length (incl. Unknown[0])

  // ---- dictionaries (index = id) ----
  "umbrellas": ["country","hip-hop","rock","pop","indie","folk/americana","r&b",
                "electronic","jazz","classical","metal","latin","christian/gospel",
                "soundtrack","comedy","other"],   // ~16 umbrella genres
  "subgenres": ["red dirt","alternative country", ...],  // raw subgenre labels
  "countries": ["United States","United Kingdom", ...],  // artist origin country
  "cities":    ["Nashville","Liverpool", ...],           // artist origin city
  "themes":    ["love","heartbreak","drinking_partying","trucks_roads_driving",
                "small_town_home","faith","money","night","summer"], // lyric themes
  "featOrder": ["energy","valence","danceability","acousticness",
                "instrumentalness","speechiness"],        // the 0-100 track features
  "yearSrc":   ["itunes","deezer","isrc"],                // release-year provenance
  "featSrc":   ["direct","artist-mean"],                  // audio-feature provenance

  // ---- ARTIST arrays (length n_artists; index i <-> dataset.artists[i]) ----
  "artistUmbrella":  [umbrellaIdx | -1, ...],   // primary umbrella genre
  "artistSubgenres": [[subgenreIdx, ...], ...], // rich subgenre id list (may be [])
  "artistCountry":   [countryIdx | -1, ...],
  "artistCity":      [cityIdx | -1, ...],       // top artists only (MusicBrainz)
  "artistYear":      [year | 0, ...],           // formation / birth year
  "artistFans":      [nb_fan | -1, ...],        // Deezer popularity proxy

  // ---- TRACK arrays (length n_tracks; index i <-> dataset.trackName[i]) ----
  //      audio features quantized 0-100 (int); -1 = missing
  "trackEnergy":[..], "trackValence":[..], "trackDance":[..],
  "trackAcoustic":[..], "trackInstr":[..], "trackSpeech":[..],
  "trackTempo": [bpm | -1, ...],                // integer BPM
  "trackLoud":  [dB  | -127, ...],              // integer dBFS (negative)
  "trackFeatSrc":[0=direct | 1=artist-mean | -1=none, ...],

  "trackYear":    [year | 0, ...],              // release year
  "trackYearSrc": [0=itunes | 1=deezer | 2=isrc | -1=none, ...],

  // lyric-derived stats (shipping = DERIVED ONLY; raw lyrics never included)
  "lyrWords":   [totalWords | -1, ...],
  "lyrUnique":  [uniqueWords | -1, ...],
  "lyrRep":     [repetitiveness 0-100 | -1, ...], // 100*(1 - unique/total)
  "lyrSent":    [sentiment -100..100 | 0, ...],   // VADER compound *100
  "lyrExplicit":[0 | 1 | -1, ...],
  "lyrThemes":  [[themeIdx, ...], ...],           // flags into themes[]
  "lyrTop":     [[word, ...up to 5], ...],        // distinctive words (TF-IDF)

  "coverage": { ...time-weighted % per enrichment type... }
}
```

Every shipped string is ≤ 60 chars (guards against raw-lyric leakage; enforced by
`enrich/verify_enrichment.mjs`).

## Provenance (see `docs/ENRICHMENT_RESEARCH.md`)

| Facet | Primary | Fill / fallback |
|---|---|---|
| genres (subgenre + umbrella) | Wikidata SPARQL | Deezer coarse bucket; MusicBrainz |
| umbrella rollup | `enrich/genre_umbrella_map.json` (standalone, maintainable) | |
| audio features | ReccoBeats (by Spotify id) | per-artist mean vector backfill (`trackFeatSrc=1`) |
| release year | iTunes (top-N tracks) | Deezer album date (by ISRC); ISRC year-prefix |
| origin country | MusicBrainz area (top artists) → Wikidata | |
| origin city | MusicBrainz begin-area (top-N artists) | |
| popularity | Deezer `nb_fan` | |
| lyric stats | LRCLIB → VADER + `enrich/theme_lexicons.json` | derived only |

## Browser decode example

```js
// enrichment.json.gz loaded the same way as dataset.json (gzip -> JSON)
async function loadEnrichment(gzBytes) {
  const ds = new DecompressionStream('gzip');
  const buf = await new Response(new Blob([gzBytes]).stream().pipeThrough(ds)).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(buf));
}

// d = decoded dataset.json, en = decoded enrichment.json
function trackMood(d, en, tr) {                 // tr = a music track id (ty===0)
  const v = en.trackValence[tr], e = en.trackEnergy[tr];
  return v < 0 ? null : { valence: v, energy: e, tempo: en.trackTempo[tr],
                          approx: en.trackFeatSrc[tr] === 1 };  // artist-mean backfill
}
function artistGenre(d, en, tr) {
  const aid = d.trackArtist[tr];
  const u = en.artistUmbrella[aid];
  return {
    umbrella: u >= 0 ? en.umbrellas[u] : null,
    subgenres: en.artistSubgenres[aid].map(i => en.subgenres[i]),
    origin: en.artistCity[aid] >= 0 ? en.cities[en.artistCity[aid]]
          : en.artistCountry[aid] >= 0 ? en.countries[en.artistCountry[aid]] : null,
    fans: en.artistFans[aid],
  };
}
function trackLyricThemes(en, tr) {
  return en.lyrThemes[tr].map(i => en.themes[i]);   // e.g. ["heartbreak","drinking_partying"]
}
// Example: umbrella share of listening TIME (music only)
function umbrellaMs(d, en) {
  const out = new Map();
  for (let i = 0; i < d.n; i++) {
    if (d.ty[i] !== 0) continue;
    const u = en.artistUmbrella[d.trackArtist[d.tr[i]]];
    const key = u >= 0 ? en.umbrellas[u] : "unknown";
    out.set(key, (out.get(key) || 0) + d.ms[i]);
  }
  return out;
}
```

## Frontend notes / quirks

- **Missing sentinels differ by field**: `-1` for genre/country/city/feature/fan
  indices and lyric counts; `0` for `artistYear` / `trackYear` (no year) and for
  `lyrSent` (neutral). Always test `>= 0` (or `> 0` for years) before using.
- **`trackFeatSrc === 1`** means the track's features are its **artist's mean**
  vector (backfill for tracks ReccoBeats didn't match) — present them as
  approximate ("artist-typical mood") rather than exact.
- **Release year is the release of the version listened to.** For legacy catalog
  outside the iTunes top-N, the year comes from Deezer/ISRC and can reflect a
  **reissue/remaster** (e.g. a 2015 Beatles remaster). Prefer `trackYearSrc===0`
  (iTunes) years for exact original-release dates; treat `deezer`/`isrc` years as
  era proxies (±1–2 yr, or reissue year for remasters).
- **Two-level genres**: `artistUmbrella` (one of ~16 for coloring/rollups) and
  `artistSubgenres` (rich, several per artist, for tooltips/word detail).
- **Origin is artist-level.** City is populated for the top artists only
  (MusicBrainz, 1 req/s); country covers the long tail via Wikidata. City strings
  are birth/formation places (e.g. Zach Bryan → "Okinawa", his birthplace on a US
  base; country still United States). Some UK artists resolve to "England".
- **`artistFans`** (Deezer `nb_fan`) is a mainstream-ness proxy, not plays; scale
  is millions for superstars, hundreds for niche artists.
- **`lyrTop`** are stopword-filtered TF-IDF-distinctive words for word clouds, not
  necessarily the most frequent words.

## Coverage (time-weighted % of listening time) & file sizes

Time-weighted = % of the user's total music listening time (ms) whose
artist/track carries that enrichment. Built 626,136 B raw / 150,788 B gzip.

| Enrichment | Source(s) | Time-weighted coverage |
|---|---|---|
| Artist genre — umbrella | Wikidata → Deezer → MusicBrainz | **99.6%** |
| Artist genre — subgenre | Wikidata + MusicBrainz + Deezer | **99.6%** |
| Audio features — direct | ReccoBeats (by Spotify id) | **79.6%** |
| Audio features — with artist-mean backfill | ReccoBeats + per-artist mean | **97.8%** |
| Release year | iTunes → Deezer(ISRC) → ISRC-prefix | **94.9%** |
| Artist origin — country | MusicBrainz area → Wikidata | **93.2%** |
| Artist origin — city | MusicBrainz (top-100 artists) | **65.6%** |
| Artist formation/birth year | MusicBrainz → Wikidata | **92.8%** |
| Popularity (Deezer nb_fan) | Deezer | **99.7%** |
| Lyric-derived stats | LRCLIB → VADER + lexicons | **92.7%** |

Release-year winning source (per-track counts): iTunes 1192, Deezer/ISRC
5518, ISRC year-prefix 91.

| File | Size |
|---|---|
| `site/enrichment.json` (minified) | 626,136 bytes (0.63 MB) |
| `site/enrichment.json.gz` (gzip -9) | 150,788 bytes (0.15 MB) |

Target was ≤ 1.5 MB gzipped — met with ~10× headroom.

