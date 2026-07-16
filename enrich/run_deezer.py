#!/usr/bin/env python3
"""
Step 2 - Deezer: coarse genre bucket + nb_fan popularity for ALL artists.

Gap-filler for genres (docs/ENRICHMENT_RESEARCH.md 1D) + ~100% popularity proxy
(nb_fan). Per-artist: search (returns id + nb_fan) -> albums (genre_id) -> genre
name. Same-name wrong matches guarded by normalized-name verification (quirk #11).
Polite thread pool; cached per artist so reruns are incremental.

Output: enrich_out/deezer_artists.json
  { "<artistIdx>": {"deezer_id","name","nb_fan","genre","genre_id"} }
"""
import argparse, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

SRC = "deezer"
GSRC = "deezer_genre"
SEARCH = "https://api.deezer.com/search/artist?limit=5&q="
ALBUMS = "https://api.deezer.com/artist/%s/albums?limit=8"
GENRE = "https://api.deezer.com/genre/%s"

def genre_name(gid):
    key = str(gid)
    cached = C.cache_get(GSRC, key)
    if cached is not None:
        return cached or None
    try:
        gd = C.http_get_json(GENRE % gid, timeout=20)
        nm = gd.get("name")
        C.cache_put(GSRC, key, nm)
        return nm
    except Exception:
        return None

def fetch_artist(name):
    """Return dict or None. Requires normalized-name match to accept."""
    target = C.norm_name(name)
    js = C.http_get_json(SEARCH + C.q(name), timeout=25)
    data = js.get("data", [])
    if not data:
        return None
    # among candidates whose normalized name matches, pick the most-followed
    # profile: Deezer often has duplicate same-name entries (e.g. two
    # "Tyler Childers", 705 vs 40,639 fans) and the canonical one is the biggest.
    matches = [c for c in data if C.norm_name(c.get("name", "")) == target]
    if not matches:
        return None  # only same-name wrong matches -> skip (conservative)
    m = max(matches, key=lambda c: c.get("nb_fan") or -1)
    aid = m["id"]
    rec = {"deezer_id": aid, "name": m.get("name"), "nb_fan": m.get("nb_fan"),
           "genre": None, "genre_id": None}
    try:
        alb = C.http_get_json(ALBUMS % aid, timeout=25)
        for al in alb.get("data", []):
            gid = al.get("genre_id")
            if gid and gid != -1:
                rec["genre_id"] = gid
                rec["genre"] = genre_name(gid)
                break
    except Exception:
        pass
    return rec

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idmap", default=os.path.join(C.ENRICH_RAW, "idmap.json"))
    ap.add_argument("--out", default=os.path.join(C.ENRICH_OUT, "deezer_artists.json"))
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--top-n", type=int, default=0, help="0 = all artists")
    args = ap.parse_args()

    idmap = C.load_idmap(args.idmap)
    artists = C.artist_worklist(idmap)
    if args.top_n:
        artists = artists[:args.top_n]

    todo = [a for a in artists if not C.cache_has(SRC, a["name"])]
    C.log(f"deezer: {len(artists)} artists, {len(artists)-len(todo)} cached, {len(todo)} to fetch")

    t0 = time.time(); done = 0
    def work(a):
        try:
            rec = fetch_artist(a["name"])
            C.cache_put(SRC, a["name"], rec)
            return True
        except Exception as e:
            C.eprint(f"  {a['name'][:30]} err {str(e)[:60]}")
            return False
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(work, a): a for a in todo}
        for f in as_completed(futs):
            done += 1
            if done % 200 == 0 or done == len(todo):
                C.log(f"  {done}/{len(todo)} fetched ({time.time()-t0:.0f}s)")

    # assemble
    out = {}; total_ms = sum(a["ms"] for a in artists)
    g_ms = 0; f_ms = 0
    for a in artists:
        rec = C.cache_get(SRC, a["name"]) if C.cache_has(SRC, a["name"]) else None
        if not rec:
            continue
        # backfill genre name from genre_id (heals transient genre-name misses)
        if not rec.get("genre") and rec.get("genre_id"):
            rec["genre"] = genre_name(rec["genre_id"])
        out[str(a["idx"])] = rec
        if rec.get("genre"):
            g_ms += a["ms"]
        if rec.get("nb_fan") is not None:
            f_ms += a["ms"]
    C.dump_json(args.out, out)
    C.log(f"deezer done: {len(out)}/{len(artists)} artists matched")
    C.log(f"  time-weighted genre: {100*g_ms/total_ms:.1f}%  nb_fan: {100*f_ms/total_ms:.1f}%")
    C.log(f"wrote {args.out}")

if __name__ == "__main__":
    main()
