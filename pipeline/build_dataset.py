#!/usr/bin/env python3
"""
Build compact columnar dataset for the single-file Spotify HTML dashboard.

Input : Spotify Extended Streaming History JSON (Audio + Video)
Output: <out-dir>/dataset.json (minified) + <out-dir>/dataset.json.gz (gzip -9)
        <docs-dir>/_stats.json (headline stats, optional)

Design goals:
 - per-play granularity preserved (browser re-aggregates on every filter change)
 - struct-of-arrays / dictionary encoding for gzip friendliness
 - local (timezone-configurable, DST-aware) timestamps baked in via local-shifted epoch
 - ip_addr dropped for privacy

Fully parameterized: no user-specific paths in logic. Any user's Extended
Streaming History -> dataset.json.
"""
import argparse, json, glob, gzip, os, random, re, subprocess, sys
from collections import Counter
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def parse_years(spec):
    """'2022' -> (2022, 2022); '2019-2023' -> (2019, 2023); '' / None -> None."""
    if not spec:
        return None
    spec = str(spec).strip()
    if "-" in spec:
        lo, hi = spec.split("-", 1)
        lo, hi = int(lo), int(hi)
    else:
        lo = hi = int(spec)
    if lo > hi:
        lo, hi = hi, lo
    return (lo, hi)


def local_year(ts, tz):
    """Local (tz-shifted) calendar year of a Spotify 'YYYY-MM-DDTHH:MM:SSZ' ts.
    Kept identical to enrich/idmap.py so year-subsetting stays index-aligned."""
    dt_utc = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return dt_utc.astimezone(tz).year

# ----------------------------------------------------------------------------
# Platform normalization -> ~6 device categories. Keep raw->category map for the report.
# ----------------------------------------------------------------------------
def normalize_platform(p):
    if not p:
        return "Unknown"
    s = p.lower()
    if "web_player" in s or "webplayer" in s:
        return "Web Player"
    if "ipad" in s:
        return "iPad"
    if "iphone" in s or s == "ios" or s.startswith("ios "):
        return "iPhone"
    if s == "osx" or "macos" in s or "os x" in s or "mac" in s:
        return "Mac"
    if "android" in s:
        return "Android"
    if "windows" in s or s == "windows":
        return "Windows"
    if "linux" in s:
        return "Linux"
    if "playstation" in s or "ps4" in s or "ps5" in s:
        return "PlayStation"
    if "cast" in s or "tv" in s or "speaker" in s or "sonos" in s:
        return "Speaker/TV"
    return "Other"

# type codes
T_MUSIC, T_PODCAST, T_AUDIOBOOK = 0, 1, 2

def load_all(data_dir, tz, year_range=None):
    rows = []
    raw_platform_counts = Counter()
    files = sorted(glob.glob(os.path.join(data_dir, "Streaming_History_*.json")))
    audio_files = [f for f in files if "Audio" in os.path.basename(f)]
    video_files = [f for f in files if "Video" in os.path.basename(f)]
    seen = set()          # (ts, uri, ms_played) for exact-duplicate dedup
    dup_count = 0
    counts = {"audio": 0, "video": 0}
    for f in audio_files + video_files:
        src = "video" if "Video" in os.path.basename(f) else "audio"
        for r in json.load(open(f, encoding="utf-8")):
            # year subsetting happens FIRST (before dedup/interning) so the
            # reconstructed id-space in enrich/idmap.py stays identical.
            if year_range and r.get("ts"):
                yr = local_year(r["ts"], tz)
                if yr < year_range[0] or yr > year_range[1]:
                    continue
            counts[src] += 1
            uri = r.get("spotify_track_uri") or r.get("spotify_episode_uri") or r.get("audiobook_uri") or ""
            key = (r.get("ts"), uri, r.get("ms_played"))
            if key in seen:
                dup_count += 1
                continue
            seen.add(key)
            raw_platform_counts[r.get("platform")] += 1
            rows.append(r)
    return rows, raw_platform_counts, dup_count, counts

def main():
    ap = argparse.ArgumentParser(description="Build dataset.json from Spotify Extended Streaming History.")
    ap.add_argument("--data-dir", required=True,
                    help="folder containing Streaming_History_*.json")
    ap.add_argument("--out-dir", required=True,
                    help="where dataset.json + dataset.json.gz are written")
    ap.add_argument("--docs-dir", default=None,
                    help="optional folder for _stats.json (headline stats dump)")
    ap.add_argument("--tz", default="America/New_York",
                    help="IANA timezone for local-wall-clock timestamps (default America/New_York)")
    ap.add_argument("--years", default=None,
                    help="subset plays to a year or range before building, e.g. 2022 or 2019-2023")
    args = ap.parse_args()

    tz = ZoneInfo(args.tz)
    year_range = parse_years(args.years)
    SITE_DIR = args.out_dir
    DOCS_DIR = args.docs_dir
    os.makedirs(SITE_DIR, exist_ok=True)
    if DOCS_DIR:
        os.makedirs(DOCS_DIR, exist_ok=True)
    if year_range:
        print(f"year subset: {year_range[0]}–{year_range[1]}")

    rows, raw_platform_counts, dup_count, file_counts = load_all(args.data_dir, tz, year_range)
    if not rows:
        print("ERROR: no plays found (check --data-dir path / --years range)", file=sys.stderr)
        sys.exit(1)

    # dictionaries (with interned lookup maps)
    artists, artist_ix = ["Unknown"], {"Unknown": 0}
    def artist_id(name):
        name = name or "Unknown"
        if name not in artist_ix:
            artist_ix[name] = len(artists); artists.append(name)
        return artist_ix[name]

    albumName, albumArtist, album_ix = ["Unknown"], [0], {("Unknown", 0): 0}
    def album_id(name, aid):
        name = name or "Unknown"
        k = (name, aid)
        if k not in album_ix:
            album_ix[k] = len(albumName); albumName.append(name); albumArtist.append(aid)
        return album_ix[k]

    # track id-space (type 0). id 0 = Unknown sentinel (null track names).
    trackName, trackArtist, trackAlbum = ["Unknown"], [0], [0]
    track_ix = {}
    def track_id(uri, name, aid, alid):
        # key by uri when present (stable), else by (name, aid)
        k = uri if uri else ("N", name, aid)
        if k not in track_ix:
            track_ix[k] = len(trackName)
            trackName.append(name or "Unknown"); trackArtist.append(aid); trackAlbum.append(alid)
        return track_ix[k]

    shows, show_ix = ["Unknown"], {"Unknown": 0}
    def show_id(name):
        name = name or "Unknown"
        if name not in show_ix:
            show_ix[name] = len(shows); shows.append(name)
        return show_ix[name]

    # episode id-space (type 1)
    epName, epShow, ep_ix = [], [], {}
    def episode_id(uri, name, shid):
        k = uri if uri else ("N", name, shid)
        if k not in ep_ix:
            ep_ix[k] = len(epName); epName.append(name or "Unknown"); epShow.append(shid)
        return ep_ix[k]

    # audiobook id-space (type 2)
    abTitle, ab_ix = [], {}
    def audiobook_id(uri, title):
        k = uri if uri else ("N", title)
        if k not in ab_ix:
            ab_ix[k] = len(abTitle); abTitle.append(title or "Unknown")
        return ab_ix[k]

    platforms, plat_ix = [], {}
    def plat_id(cat):
        if cat not in plat_ix:
            plat_ix[cat] = len(platforms); platforms.append(cat)
        return plat_ix[cat]

    countries, co_ix = [], {}
    def country_id(c):
        c = c or "??"
        if c not in co_ix:
            co_ix[c] = len(countries); countries.append(c)
        return co_ix[c]

    reasonStart, rs_ix = [], {}
    def rs_id(x):
        x = x if x is not None else "unknown"
        if x not in rs_ix:
            rs_ix[x] = len(reasonStart); reasonStart.append(x)
        return rs_ix[x]

    reasonEnd, re_ix = [], {}
    def re_id(x):
        x = x if x is not None else "unknown"
        if x not in re_ix:
            re_ix[x] = len(reasonEnd); reasonEnd.append(x)
        return re_ix[x]

    # ---- first pass: parse each record into an intermediate tuple with local epoch
    recs = []  # (local_epoch_sec, ms, tr, ty, pf, co, rs, re, flags, orig_ref)
    null_track = 0
    for r in rows:
        # local-shifted epoch: value such that new Date(t*1000).getUTC*() -> local wall-clock
        dt_utc = datetime.strptime(r["ts"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        local = dt_utc.astimezone(tz)
        # wall-clock components as if UTC
        local_epoch = int(datetime(local.year, local.month, local.day, local.hour,
                                    local.minute, local.second, tzinfo=timezone.utc).timestamp())

        ms = int(r.get("ms_played") or 0)

        tname = r.get("master_metadata_track_name")
        ename = r.get("episode_name")
        abt = r.get("audiobook_title")
        if abt:
            ty = T_AUDIOBOOK
            tr = audiobook_id(r.get("audiobook_uri"), abt)
        elif ename:
            ty = T_PODCAST
            shid = show_id(r.get("episode_show_name"))
            tr = episode_id(r.get("spotify_episode_uri"), ename, shid)
        else:
            ty = T_MUSIC
            if not tname:
                null_track += 1
                tr = 0  # Unknown sentinel track
            else:
                aid = artist_id(r.get("master_metadata_album_artist_name"))
                alid = album_id(r.get("master_metadata_album_album_name"), aid)
                tr = track_id(r.get("spotify_track_uri"), tname, aid, alid)

        pf = plat_id(normalize_platform(r.get("platform")))
        co = country_id(r.get("conn_country"))
        rs = rs_id(r.get("reason_start"))
        re_ = re_id(r.get("reason_end"))

        flags = 0
        if r.get("shuffle"): flags |= 1
        if r.get("skipped"): flags |= 2
        if r.get("offline"): flags |= 4
        if r.get("incognito_mode"): flags |= 8

        recs.append([local_epoch, ms, tr, ty, pf, co, rs, re_, flags, r])

    # ---- sort by local epoch ascending (stable) for delta encoding
    recs.sort(key=lambda x: x[0])
    n = len(recs)

    # delta-encode local epoch
    t0 = recs[0][0]
    dt = [0] * n
    prev = t0
    for i, rec in enumerate(recs):
        dt[i] = rec[0] - prev
        prev = rec[0]

    ms_arr = [rec[1] for rec in recs]
    tr_arr = [rec[2] for rec in recs]
    ty_arr = [rec[3] for rec in recs]
    pf_arr = [rec[4] for rec in recs]
    co_arr = [rec[5] for rec in recs]
    rs_arr = [rec[6] for rec in recs]
    re_arr = [rec[7] for rec in recs]
    fl_arr = [rec[8] for rec in recs]

    # ---------------- headline stats (computed here, embedded in meta + spec) --------
    total_ms = sum(ms_arr)
    # ms/plays per artist & track (music only)
    artist_ms = Counter(); artist_plays = Counter()
    track_ms = Counter(); track_plays = Counter()
    year_plays = Counter(); year_ms = Counter()
    type_plays = Counter()
    plat_plays = Counter()
    skip_ct = 0; shuf_ct = 0
    for i in range(n):
        ty = ty_arr[i]; type_plays[ty] += 1
        plat_plays[platforms[pf_arr[i]]] += 1
        yr = datetime.utcfromtimestamp(t0 + sum_deltas if False else recs[i][0]).year
        year_plays[yr] += 1; year_ms[yr] += ms_arr[i]
        if fl_arr[i] & 2: skip_ct += 1
        if fl_arr[i] & 1: shuf_ct += 1
        if ty == T_MUSIC:
            tid = tr_arr[i]
            aid = trackArtist[tid]
            artist_ms[aid] += ms_arr[i]; artist_plays[aid] += 1
            track_ms[tid] += ms_arr[i]; track_plays[tid] += 1

    def top_artists(counter, k=10):
        return [(artists[a], c) for a, c in counter.most_common(k)]
    def top_tracks(counter, k=10):
        out = []
        for tid, c in counter.most_common(k):
            out.append((trackName[tid], artists[trackArtist[tid]], c))
        return out

    date_min = datetime.utcfromtimestamp(recs[0][0]).strftime("%Y-%m-%d")
    date_max = datetime.utcfromtimestamp(recs[-1][0]).strftime("%Y-%m-%d")

    headline = {
        "totalPlays": n,
        "totalMs": total_ms,
        "dateRange": [date_min, date_max],
        "uniqueArtists": len(artists) - 1,  # minus Unknown sentinel
        "uniqueTracks": len(trackName) - 1,
        "uniqueAlbums": len(albumName) - 1,
        "uniqueShows": len(shows) - 1,
        "uniqueEpisodes": len(epName),
        "uniqueAudiobooks": len(abTitle),
        "nullTrackPlays": null_track,
        "skipRate": round(skip_ct / n, 4),
        "shuffleRate": round(shuf_ct / n, 4),
        "typePlays": {"music": type_plays[0], "podcast": type_plays[1], "audiobook": type_plays[2]},
    }

    # ---------------- assemble dataset ----------------
    dataset = {
        "v": 1,
        "meta": headline,
        # dictionaries
        "artists": artists,
        "trackName": trackName, "trackArtist": trackArtist, "trackAlbum": trackAlbum,
        "albumName": albumName, "albumArtist": albumArtist,
        "shows": shows,
        "epName": epName, "epShow": epShow,
        "abTitle": abTitle,
        "platforms": platforms,
        "countries": countries,
        "reasonStart": reasonStart,
        "reasonEnd": reasonEnd,
        # per-play columnar arrays (all length n, sorted by local ts asc)
        "n": n,
        "t0": t0,                 # local-shifted epoch seconds of first play
        "dt": dt,                 # delta seconds from previous play (dt[0]=0)
        "ms": ms_arr,
        "tr": tr_arr,             # id into track/episode/audiobook space per ty
        "ty": ty_arr,             # 0 music, 1 podcast, 2 audiobook
        "pf": pf_arr,
        "co": co_arr,
        "rs": rs_arr,
        "re": re_arr,
        "fl": fl_arr,             # bit0 shuffle, bit1 skipped, bit2 offline, bit3 incognito
    }

    # ---------------- sanity checks ----------------
    L = n
    for name, arr in [("dt", dt), ("ms", ms_arr), ("tr", tr_arr), ("ty", ty_arr),
                      ("pf", pf_arr), ("co", co_arr), ("rs", rs_arr), ("re", re_arr), ("fl", fl_arr)]:
        assert len(arr) == L, f"length mismatch {name}: {len(arr)} != {L}"
    assert all(d >= 0 for d in dt), "negative delta found"
    assert max(pf_arr) < len(platforms) and max(co_arr) < len(countries)
    assert max(rs_arr) < len(reasonStart) and max(re_arr) < len(reasonEnd)
    for i in range(L):
        if ty_arr[i] == T_MUSIC: assert tr_arr[i] < len(trackName)
        elif ty_arr[i] == T_PODCAST: assert tr_arr[i] < len(epName)
        else: assert tr_arr[i] < len(abTitle)
    assert len(trackName) == len(trackArtist) == len(trackAlbum)
    assert len(albumName) == len(albumArtist)
    assert len(epName) == len(epShow)

    # round-trip spot check: decode 3 random rows and compare to originals
    def decode_row(i):
        t = t0 + sum(dt[:i + 1])
        rec = {}
        rec["local_epoch"] = t
        rec["ms"] = ms_arr[i]
        ty = ty_arr[i]
        if ty == T_MUSIC:
            rec["track"] = trackName[tr_arr[i]]
            rec["artist"] = artists[trackArtist[tr_arr[i]]]
            rec["album"] = albumName[trackAlbum[tr_arr[i]]]
        elif ty == T_PODCAST:
            rec["episode"] = epName[tr_arr[i]]
            rec["show"] = shows[epShow[tr_arr[i]]]
        else:
            rec["audiobook"] = abTitle[tr_arr[i]]
        rec["platform"] = platforms[pf_arr[i]]
        rec["country"] = countries[co_arr[i]]
        rec["reason_start"] = reasonStart[rs_arr[i]]
        rec["reason_end"] = reasonEnd[re_arr[i]]
        rec["shuffle"] = bool(fl_arr[i] & 1)
        rec["skipped"] = bool(fl_arr[i] & 2)
        return rec

    # cumulative for fast decode check
    cum = [0] * n
    acc = 0
    for i in range(n):
        acc += dt[i]; cum[i] = acc
    def decode_row_fast(i):
        t = t0 + cum[i]
        orig = recs[i]
        return t, orig

    random.seed(42)
    spot = random.sample(range(n), 3)
    spot_report = []
    for i in spot:
        t_dec = t0 + cum[i]
        orig = recs[i]
        r0 = orig[9]
        # local epoch must match the value we sorted on
        assert t_dec == orig[0], f"epoch decode mismatch at {i}"
        assert ms_arr[i] == int(r0.get("ms_played") or 0)
        assert bool(fl_arr[i] & 1) == bool(r0.get("shuffle"))
        assert bool(fl_arr[i] & 2) == bool(r0.get("skipped"))
        # name round-trip
        ty = ty_arr[i]
        if ty == T_MUSIC and r0.get("master_metadata_track_name"):
            assert trackName[tr_arr[i]] == r0["master_metadata_track_name"]
            assert artists[trackArtist[tr_arr[i]]] == (r0.get("master_metadata_album_artist_name") or "Unknown")
        elif ty == T_PODCAST:
            assert epName[tr_arr[i]] == r0["episode_name"]
        spot_report.append((i, r0.get("ts"), decode_row(i) if False else {
            "local_epoch": t_dec, "ms": ms_arr[i],
            "name": (trackName[tr_arr[i]] if ty == T_MUSIC else
                     epName[tr_arr[i]] if ty == T_PODCAST else abTitle[tr_arr[i]]),
            "orig_ts_utc": r0.get("ts"),
        }))
    print("Spot-check round-trip OK for rows:", spot)

    # ---------------- write outputs ----------------
    json_path = os.path.join(SITE_DIR, "dataset.json")
    gz_path = json_path + ".gz"
    minified = json.dumps(dataset, separators=(",", ":"), ensure_ascii=False)
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(minified)
    raw_bytes = minified.encode("utf-8")
    with gzip.open(gz_path, "wb", compresslevel=9) as f:
        f.write(raw_bytes)

    json_size = os.path.getsize(json_path)
    gz_size = os.path.getsize(gz_path)

    # ---------------- build report data for spec ----------------
    stats = {
        "headline": headline,
        "raw_platform_counts": dict(raw_platform_counts.most_common()),
        "platform_category_counts": dict(Counter(plat_plays).most_common()),
        "top_artists_ms": top_artists(artist_ms),
        "top_artists_plays": top_artists(artist_plays),
        "top_tracks_ms": top_tracks(track_ms),
        "top_tracks_plays": top_tracks(track_plays),
        "year_plays": dict(sorted(year_plays.items())),
        "year_ms": dict(sorted(year_ms.items())),
        "countries": countries,
        "reasonStart": reasonStart,
        "reasonEnd": reasonEnd,
        "dup_count": dup_count,
        "file_counts": file_counts,
        "json_size": json_size,
        "gz_size": gz_size,
    }
    if DOCS_DIR:
        with open(os.path.join(DOCS_DIR, "_stats.json"), "w") as f:
            json.dump(stats, f, indent=1, ensure_ascii=False, default=str)

    print(f"dataset.json    : {json_size:,} bytes ({json_size/1e6:.2f} MB)")
    print(f"dataset.json.gz : {gz_size:,} bytes ({gz_size/1e6:.2f} MB)")
    print(f"records: {n:,}  artists: {len(artists)-1:,}  tracks: {len(trackName)-1:,}")
    print(f"dup records removed: {dup_count}")
    return stats

if __name__ == "__main__":
    main()
