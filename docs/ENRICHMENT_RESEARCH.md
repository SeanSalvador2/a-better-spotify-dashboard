# Spotify Dashboard — Data Enrichment Research

**Goal:** enrich a genre-less / feature-less Spotify Extended Streaming History
(225,845 plays, Nov 2020 – Jul 2026) with artist genres, track audio features
(energy/valence/danceability/tempo/acousticness), release years, artist origin,
popularity, and lyric-derived stats.

All numbers below are **measured empirically** from this sandbox on 2026-07-15
against the user's real join keys — not estimated from docs. Test scripts and raw
results live in `/root/spotify_dashboard/enrich_raw/` (`test_*.py`, `out_*.txt`,
`res_*.json`).

---

## 0. Join keys (extracted from RAW streaming history, not `dataset.json`)

`site/dataset.json` **does not contain Spotify track URIs** — they are used only as
an interning key by `build_dataset.py` and then dropped. The URIs were recovered
from the raw export at
`data/Spotify Extended Streaming History/Streaming_History_Audio_*.json`
(field `spotify_track_uri` = `spotify:track:<base62 id>`).

| Key | Count | Notes |
|---|---|---|
| Unique track IDs (base62) | **8,557** | 100% of music plays carry a URI; **100% of music-ms is URI-keyed** (0 name-only tracks) |
| Unique artist names | **2,654** | |
| Top-500 artists by ms | cover **96.1%** of all artist-ms | listening-time weighted |
| Top-2000 tracks by ms | cover **93.7%** of all track-ms | |

(`dataset.json` meta reports 8,634 tracks / 2,660 artists; the small delta is
interning of a few renamed/duplicate-URI tracks — immaterial for enrichment.)

Artifacts written:
- `enrich_raw/track_ids.txt` — all 8,557 base62 IDs
- `enrich_raw/tracks_all.json` — every track `{id,uri,name,artist,album,ms,plays}` sorted by ms
- `enrich_raw/top2000_tracks.json`, `enrich_raw/top500_artists.json`, `enrich_raw/artists_all.json`
- `enrich_raw/sample30_artists.json`, `enrich_raw/sample30_tracks.json` — stratified test samples

**This library is ~99.8% music, heavily recent (2022-2026) country** (Zach Bryan,
Luke Combs, Morgan Wallen, Megan Moroney, Ella Langley…). This skew is the single
biggest driver of every result below: static bulk datasets built from older,
genre-balanced Kaggle dumps miss most of it.

---

## 1. Per-source results

### Reachability summary (all via the agent HTTPS proxy)
Every candidate domain returned **HTTP 200** and needs **no auth**. `HF_TOKEN` is
**not** set in this sandbox and there is no cached HF token; gated HF datasets and
`huggingface_hub` downloads that require auth **fail with 401**.

| Source | Reach | Auth | Rate limit (observed) |
|---|---|---|---|
| Hugging Face public parquet | 200 | none | fine (single 13.6 MB GET) |
| HF gated (`embeat_45m`) | **401** | needs accepted terms + token | — |
| ReccoBeats | 200 | none | **no throttle** at 20 ids/req, ~1 req/0.3s |
| MusicBrainz | 200 | none | **1 req/s hard** (documented + enforced) |
| iTunes Search | 200 | none | **~20/min** — throttled hard above that (measured) |
| Deezer | 200 | none | no throttle at ~13/s; occasional connection stalls |
| Wikidata SPARQL | 200 | none | fine; batch 50 names/query |
| LRCLIB | 200 | none | no throttle, but **~8 s latency/request** |

---

### 1A. Hugging Face — bulk track datasets

**`maharshipandya/spotify-tracks-dataset`** (114k rows, **89,741 unique** track_id;
`vancenceho/spotify-tracks-clean` is the identical Kaggle dump; ~two dozen forks of
it exist). Public parquet, 13.6 MB, downloaded and joined by `track_id`.
Columns: track_id, artists, album_name, track_name, popularity, duration_ms,
explicit, danceability, energy, key, loudness, mode, speechiness, acousticness,
instrumentalness, liveness, valence, tempo, time_signature, **track_genre**.

| Metric | Result |
|---|---|
| Unique-track match | **1,160 / 8,557 = 13.6%** |
| **Time-weighted match** | **14.1%** of listening ms |
| Within top-2000 tracks | 288/2000, 14.3% of their ms |
| 30-track stratified sample | **3/30** (only older mainstream: e.g. Kendrick "N95") |

→ **Verdict: unusable as a primary source.** It is a 2022, genre-balanced *sample*
(one row per track per genre → duplicate IDs), so it misses the recent country
catalog that dominates this user. This ceiling is structural: **Spotify removed the
`/audio-features` API endpoint on 2024-11-27**, so no static dataset can contain real
audio features for tracks released/scraped after ~2022. The 20+ near-duplicate
"spotify-tracks-dataset" repos on HF are all the same 114k source — combining them
does not help.

**`GD-Studio/embeat_45m_spotify_tracks`** (45M tracks, 3 × 3.15 GB parquet = ~9.4 GB).
Per its (public) README it has **26 columns incl. full audio features**
(danceability, energy, valence, tempo, acousticness, …), release_year, ISRC,
popularity, artist_id, and **Every-Noise-at-Once artist genres**
(`artist_genre_map.json`). **This is gated** — `hf_fs`/`paths-info` returns
*"you are not in the authorized list"* and the parquet resolve URL returns **401**.
Could not download or measure. The MCP is authenticated as user `SeanSalvador`, so
**access requires that user to open the dataset page and accept the terms**
(automated gate, likely instant). *Caveat:* even if granted, its audio-feature
columns' coverage of post-2024 tracks is unverified given the API deprecation, and
license is **CC BY-NC 4.0 (non-commercial only)** — check this against the project.

→ **Verdict: highest-upside bulk source but currently inaccessible.** Recommend the
user accept the terms so it can be tested; if its features are populated for recent
tracks it could push coverage toward 90%+ in one download. Until then, treat as
unavailable.

---

### 1B. ReccoBeats — audio features by Spotify ID (the winner for mood) ⭐

`GET https://api.reccobeats.com/v1/audio-features?ids=<id1,id2,...>` (≤~40 ids/call;
maps results back via the `href` = `open.spotify.com/track/<our id>`). No auth, no
key. Returns **real** acousticness, danceability, energy, instrumentalness, key,
liveness, loudness, mode, speechiness, tempo, **valence**, plus **ISRC**.

**Full-library run (all 8,557 tracks, single-thread, 20 ids/batch):**

| Metric | Result |
|---|---|
| Unique-track match | **6,558 / 8,557 = 76.6%** |
| **Time-weighted coverage** | **79.6% of ALL listening ms** |
| Runtime | **277 s (4.6 min)**, 0 throttled, 0 errors |
| Sample values | e.g. our #1 track (Stapleton "What Are You Listening To?"): energy 0.553, valence 0.409, danceability 0.563, tempo 161.9, acousticness 0.19 |

→ **Verdict: the audio-features solution.** ~5.7× better time-weighted coverage than
the HF dump (79.6% vs 14.1%), free, fast, no throttle, and crucially it matches the
**exact IDs the user actually played** (resolves each `open.spotify.com/track/<id>`),
so re-recordings/deluxe reissues are matched correctly. The missing ~20% is the
long-tail + brand-new releases — cover it with an **artist-average backfill**
(below).

---

### 1C. Wikidata SPARQL — rich artist genre + origin + year (best bulk artist source) ⭐

`GET https://query.wikidata.org/sparql?format=json&query=...`, matched by
`rdfs:label|skos:altLabel`, restricted to music types
(`Q5 human`, `Q215380 band`, `Q2088357 musical group`, `Q56816954 musical duo`),
pulling `P136 genre`, `P495 country of origin` / `P27 citizenship`,
`P571 inception` / `P569 birth year`. **Batched 50 names/query.**

**Scaled run (top-250 artists = 86.5% of artist-ms):**

| Metric | Result |
|---|---|
| Genre hit | **205/250 = 82.0%** unique |
| **Time-weighted genre** | **90.2%** of top-250 ms |
| Country hit | **215/250 = 86.0%** |
| + formation/birth year | returned alongside |
| Runtime | **11 s for 250 artists** (5 queries) |

Granularity is **excellent** — real subgenres, multiple per artist:
Zach Bryan → *red dirt, alternative country*; Morgan Wallen → *bro-country, country
pop, country music*; King Crimson → *jazz rock, art rock, progressive*. Misses are
almost all tiny tail artists (a cappella groups, one-play artists), hence the 82%
unique but ~90% weighted.

→ **Verdict: primary artist-metadata source.** Fastest per artist by far (~50×
faster than MusicBrainz), richest structured genres, plus country + year for free.
Full 2,654 artists ≈ **~2 min** (54 batched queries).

---

### 1D. Deezer — coarse genre, ~100% match, no throttle (the gap-filler) ⭐

`https://api.deezer.com/search/artist?q=<name>` → artist id; genre needs a 2nd call
(`/artist/{id}/albums` → `genre_id` → `/genre/{id}`). No auth.

| Metric | Result |
|---|---|
| Artist match (scaled, top-150) | **148/150 = 98.7%** |
| Time-weighted (top-150) | **99.5%** |
| Throttling | **none** (documented ~50 req/s); 2/150 transient connection stalls |
| Genre granularity | **coarse, one bucket**: Country / Pop / Rock / Alternative / Rap-Hip-Hop / R&B |
| 30-artist genre sample | 30/30 |

→ **Verdict: use to fill the ~10-18% of artist-ms Wikidata misses** and to give a
clean top-level genre bucket. Latency-bound (~0.6 s/artist single-thread) but
parallelizable to ~50/s → full run in minutes. Bonus: the artist-detail object
returns **`nb_fan`**, a usable popularity/mainstream-ness proxy at ~100% coverage.
Watch for wrong same-name matches on obscure artists (normalize + verify name).

---

### 1E. iTunes Search — perfect match but strict rate cap; best track release-year

`https://itunes.apple.com/search?term=<name>&entity=musicArtist` (artist genre) and
`entity=song` (track genre + `releaseDate`). No auth.

| Metric | Result |
|---|---|
| 30-artist genre sample (slow rate) | **30/30**, single coarse genre |
| **Scaled top-500 @ ~8/s** | **330/500 requests throttled (403/429)** → only 167 genres |
| Track release-year (song entity, 18 tracks) | **17/18 = 94%**, years accurate |
| Genre granularity | coarse single genre (Country/Pop/Rock/Alternative/Hip-Hop-Rap) |

→ **Verdict: excellent quality, painful throughput.** Name-match is ~100% but the
**~20/min cap is real and enforced** — the "33% coverage" at scale is *throttling,
not match failure*. Must run at ≤~20/min with retry/backoff → full 2,654 artists
≈ **2-2.5 h**. Prefer Deezer for bulk; keep iTunes as the **release-year** source
(most accurate free option) and a genre tie-breaker.

---

### 1F. MusicBrainz — richest per-artist (genre + city + year) but slow

`ws/2/artist?query=...` (search) then `ws/2/artist/{mbid}?inc=genres+tags` (lookup).
No auth, **1 req/s hard limit** → 2 requests/artist ≈ 3.5 s/artist.

| Metric | Result |
|---|---|
| 30-artist genre/tag hit | **24/30 = 80%** |
| Extra data | multi-genre **+ city-level `area`** (Philadelphia, Montgomery, California) **+ begin year / birthdate** |
| Runtime | **104 s for 30** → full 2,654 ≈ **~1.5 h** |

Quality is high for mainstream country (Zach Bryan → alternative country, americana,
country, red dirt; area United States; b.1996) but has **disambiguation failures**:
*Kanye West → "Kanye West Tribute Band"* (empty genres), *Phoenix → "Nick Phoenix"*
(a composer). Must filter search results by type=Person/Group and score / exact name
before lookup.

→ **Verdict: not for bulk (too slow), but the only free source giving city-level
artist origin.** Use as a **targeted fallback** for high-value artists Wikidata
misses, and specifically to get **city/state origin** for the top ~200 artists.

---

### 1G. LRCLIB — lyrics for derived stats

`https://lrclib.net/api/search?track_name=<t>&artist_name=<a>`. No auth. Returns
`plainLyrics` + `syncedLyrics`.

| Metric | Result |
|---|---|
| 30-track sample: any match | **28/30 = 93%** |
| 30-track sample: **plain lyrics present** | **27/30 = 90%** |
| Word counts | healthy (240-680 words/song) |
| Latency | **~8 s/request** (server-side; not a rate cap) |
| Runtime | 245 s for 30 single-thread |

→ **Verdict: viable for lyric-derived stats.** 90% plain-text hit on top tracks. The
8 s latency is the constraint, not a rate limit — **run concurrent workers**
(8 workers → ~2,000 top tracks in ~30-35 min). Strip `(feat …)`, `- Acoustic`,
`- Live`, `- Remaster` suffixes before matching. **Only ship derived stats**
(sentiment, word/type counts, theme keywords); fetch raw text transiently and
discard it (copyright).

---

## 2. Recommended enrichment pipeline

| Facet | Primary source | Fill / fallback | Expected time-weighted coverage |
|---|---|---|---|
| **(a) Artist genres** | **Wikidata** (rich subgenres, batched) | **Deezer** for misses (coarse bucket); iTunes/MusicBrainz tie-break | **~99%** (Wikidata 90% + Deezer ~99% fill) |
| **(b) Track audio features** (energy/valence/dance/tempo/acousticness) | **ReccoBeats** by Spotify ID | **artist-average backfill** from the matched subset for the missing ~20% | **~80% direct → ~95%+ with backfill** |
| **(c) Track release year** | **iTunes** song entity (94%, accurate) | Deezer album `release_date`; ReccoBeats **ISRC-year** as a free ±1-2 yr era proxy; embeat `release_year` | **~90-95%** |
| **(d) Artist origin + formation** | **Wikidata** (country 86% + inception/birth year) | **MusicBrainz** for city/state on top ~200 artists | country **~86-95%**; city ~top-artists only |
| **(e) Popularity / mainstream-ness** | **Deezer `nb_fan`** (artist, ~100%) | maharshi `popularity` (only 14% match); embeat popularity if unlocked | **~99%** (artist-level proxy) |
| **(f) Lyrics-derived stats** | **LRCLIB** (concurrent) | — | **~90%** of top-track ms; ship derived only |

### Audio-features fallback, stated plainly
Bulk feature **datasets match this library poorly (14%)** and cannot improve — the
Spotify audio-features API is dead, so no new static dataset covers 2023-2026
releases. **ReccoBeats is the fallback that works (79.6% weighted).** For the
remaining ~20%: compute each artist's mean feature vector from their ReccoBeats-
matched tracks and impute it onto their unmatched tracks. Because top artists are
well covered, this lifts effective **mood coverage to ~95%+**. If, after that, a
few high-play tracks still lack features, present mood as an artist-level aggregate
rather than dropping the feature — do **not** ship maharshi-based features. Only if
none of this satisfies the design, consider unlocking `embeat_45m` (verify its
recent-track feature coverage first) or drop energy/valence entirely.

### Realistic full-run time budget (single-thread unless noted)
- ReccoBeats audio features, 8,557 tracks — **~5 min** (measured 4.6 min) + ISRC-year free
- Wikidata genres+country+year, 2,654 artists — **~2 min** (54 batched queries)
- Deezer coarse-genre + `nb_fan` fill on the ~500 gap artists — **~5 min**
- iTunes release years for top ~2,000 tracks @ 20/min — **~1.7 h** (or skip; use ISRC-year era + Deezer)
- MusicBrainz city origin for top ~200 artists @ 1/s — **~12 min**
- LRCLIB lyrics for top ~2,000 tracks, **8 concurrent workers** — **~35 min**

**Everything except the optional iTunes release-year pass fits comfortably under an
hour.** Expected final time-weighted coverage: genres ~99%, mood ~95% (with
backfill), release era ~90%, origin/country ~86%, popularity ~99%, lyrics ~90%.

---

## 3. Quirks the pipeline MUST handle

1. **URIs are not in `dataset.json`** — always join from the raw
   `Streaming_History_Audio_*.json` `spotify_track_uri`.
2. **Name normalization** for all name-keyed lookups (Deezer/iTunes/Wikidata/
   MusicBrainz/LRCLIB): lowercase, strip punctuation, handle `&`/`and`
   (Simon & Garfunkel), leading "The", featuring credits, and **non-ASCII hyphens**
   (MusicBrainz returned `Sophie Ellis‐Bextor` with a U+2010 hyphen).
3. **Track-title cleaning** before track lookups: strip `(feat …)`, `(with …)`,
   `- Acoustic`, `- Live`, `- Remaster/Remastered`, `- Radio Edit`.
4. **Multiple genres per artist** (Wikidata, MusicBrainz return lists) vs **single
   coarse genre** (iTunes, Deezer). Keep both: a "primary bucket" (Deezer/iTunes) and
   a "rich subgenre set" (Wikidata/MB). Decide dedup/priority rules.
5. **maharshi/Kaggle dump has duplicate track_ids** (114k rows → 89,741 unique;
   one row per (track, genre)) → dedup, and a single track can carry conflicting
   genre labels.
6. **Feature datasets are keyed to different track IDs than the user played**
   (deluxe / re-recorded / regional reissue IDs differ) — this is *why* the bulk
   join is 14%. ReccoBeats sidesteps it by resolving the exact
   `open.spotify.com/track/<id>` the user played.
7. **ReccoBeats batch returns fewer entries than requested** when some IDs are
   unknown — **map results back by `href` (the Spotify ID), never by request order**;
   filter out rows with null `energy`.
8. **Wikidata typing**: solo artists need `P27` (citizenship); `P495` (country of
   origin) only exists for bands. Formation is `P571` (bands) vs birth `P569`
   (people). Use `rdfs:label|skos:altLabel` (aliases) or you lose ~exact-case misses.
9. **MusicBrainz disambiguation**: same-name tribute bands / different artists
   (Kanye West → tribute band; Phoenix → composer). Filter by artist type + search
   `score`, prefer exact normalized name; the search endpoint has **no** genres —
   a second `inc=genres+tags` lookup is required (doubles the 1 req/s cost).
10. **iTunes ~20/min throttle** is real and returns 403/429 — throttle to
    ~3 s/request with exponential backoff + retry, or it silently under-covers.
11. **Deezer**: genre is **album-level** (needs the extra album call) and search can
    return a wrong same-name artist for obscure names; occasional connection stalls
    (use a short timeout + retry). Genre buckets are coarse.
12. **ISRC-year ≠ release year**: it is the recording's *reference* year and can be
    off by 1-2 years (measured 3/6 exact vs iTunes) — fine for decade/era bucketing,
    not for exact release dates.
13. **LRCLIB latency (~8 s)** dominates — parallelize; it is not a rate limit.
14. **Lyrics licensing**: fetch raw text transiently, persist only derived stats.
15. **HF gated datasets need accepted terms + a token**; none is configured here, so
    `embeat_45m` is currently unreachable (401). It is also **CC BY-NC**.

---

## 4. Files produced

Under `/root/spotify_dashboard/enrich_raw/` (~16 MB total, no multi-GB hoarding):
- Join keys: `track_ids.txt`, `tracks_all.json`, `artists_all.json`,
  `top2000_tracks.json`, `top500_artists.json`, `sample30_{artists,tracks}.json`
- Downloaded dataset: `maharshi_114k.parquet` (13.6 MB)
- Test scripts: `test_{musicbrainz,itunes,deezer,wikidata,lrclib,reccobeats*,itunes_scale,deezer_scale2,release,wikidata_scale}.py`
- Raw outputs: `out_*.txt`; parsed results: `res_*.json`
  (incl. `res_reccobeats_full.json`, `reccobeats_sample_features.json`)
