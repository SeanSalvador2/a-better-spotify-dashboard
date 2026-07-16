#!/usr/bin/env python3
"""
Step 4b - Combine release-year sources, recording which source won per track.

Priority (docs/ENRICHMENT_RESEARCH.md 1E / section 2c):
  1. iTunes song-entity year (most accurate)   -> src "itunes"
  2. Deezer track-by-ISRC release_date year     -> src "deezer"
  3. ISRC year-prefix (era proxy, +-1-2 yr)     -> src "isrc"   (quirk #12)

ISRCs come from the ReccoBeats pass. Deezer-by-ISRC is fetched here (no throttle),
cached per ISRC. Depends on enrich_out/itunes_years.json + reccobeats_features.json;
safe to re-run incrementally as iTunes fills in.

Output: enrich_out/release_years.json  { "<trackIdx>": {"year":int,"src":"..."} }
"""
import argparse, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

DSRC = "deezer_isrc"
DTRACK = "https://api.deezer.com/track/isrc:%s"
CUR_YY = time.gmtime().tm_year % 100

def isrc_prefix_year(isrc):
    s = isrc.replace("-", "").upper()
    if len(s) < 7 or not s[5:7].isdigit():
        return None
    yy = int(s[5:7])
    yr = 2000 + yy if yy <= CUR_YY else 1900 + yy
    if 1900 <= yr <= 2100:
        return yr
    return None

def deezer_isrc_year(isrc):
    key = isrc.replace("-", "").upper()
    cached = C.cache_get(DSRC, key)
    if cached is not None or C.cache_has(DSRC, key):
        return cached.get("year") if cached else None
    try:
        d = C.http_get_json(DTRACK % key, timeout=25)
        rd = d.get("release_date") or ""
        yr = int(rd[:4]) if rd[:4].isdigit() and rd[:4] != "0000" else None
        C.cache_put(DSRC, key, {"year": yr} if yr else None)
        return yr
    except Exception:
        return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idmap", default=os.path.join(C.ENRICH_RAW, "idmap.json"))
    ap.add_argument("--itunes", default=os.path.join(C.ENRICH_OUT, "itunes_years.json"))
    ap.add_argument("--reccobeats", default=os.path.join(C.ENRICH_OUT, "reccobeats_features.json"))
    ap.add_argument("--out", default=os.path.join(C.ENRICH_OUT, "release_years.json"))
    ap.add_argument("--workers", type=int, default=10)
    args = ap.parse_args()

    idmap = C.load_idmap(args.idmap)
    tracks = C.track_worklist(idmap)
    itunes = C.load_json(args.itunes) if os.path.exists(args.itunes) else {}
    recco = C.load_json(args.reccobeats) if os.path.exists(args.reccobeats) else {"features": {}}
    feats = recco["features"]

    isrc_by_idx = {}
    for sidx, rec in feats.items():
        if rec.get("isrc"):
            isrc_by_idx[int(sidx)] = rec["isrc"]

    # fetch Deezer-by-ISRC for all ISRC tracks WITHOUT an iTunes year (cache-backed)
    need_deezer = [idx for idx in isrc_by_idx if str(idx) not in itunes]
    todo = [idx for idx in need_deezer if not C.cache_has(DSRC, isrc_by_idx[idx].replace('-', '').upper())]
    C.log(f"release: {len(itunes)} itunes years; {len(isrc_by_idx)} ISRCs; "
          f"deezer-by-isrc to fetch: {len(todo)}")
    t0 = time.time(); done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(deezer_isrc_year, isrc_by_idx[idx]): idx for idx in todo}
        for f in as_completed(futs):
            done += 1
            if done % 500 == 0 or done == len(todo):
                C.log(f"  deezer {done}/{len(todo)} ({time.time()-t0:.0f}s)")

    # resolve per track by priority
    out = {}
    src_counts = {"itunes": 0, "deezer": 0, "isrc": 0}
    for t in tracks:
        idx = t["idx"]
        if str(idx) in itunes and itunes[str(idx)].get("year"):
            out[str(idx)] = {"year": itunes[str(idx)]["year"], "src": "itunes"}
            src_counts["itunes"] += 1
            continue
        isrc = isrc_by_idx.get(idx)
        if isrc:
            yr = deezer_isrc_year(isrc)
            if yr:
                out[str(idx)] = {"year": yr, "src": "deezer"}
                src_counts["deezer"] += 1
                continue
            yr = isrc_prefix_year(isrc)
            if yr:
                out[str(idx)] = {"year": yr, "src": "isrc"}
                src_counts["isrc"] += 1
    C.dump_json(args.out, out)

    total_ms = sum(t["ms"] for t in tracks)
    hit_ms = sum(t["ms"] for t in tracks if str(t["idx"]) in out)
    C.log(f"release done: {len(out)}/{len(tracks)} tracks have a year "
          f"({100*hit_ms/total_ms:.1f}% time-weighted)")
    C.log(f"  by source: {src_counts}")
    C.log(f"wrote {args.out}")

if __name__ == "__main__":
    main()
