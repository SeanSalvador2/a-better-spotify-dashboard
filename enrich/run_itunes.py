#!/usr/bin/env python3
"""
Step 4a - iTunes Search: release YEAR for the top-N tracks by listening time.

Most accurate free release-year source (docs/ENRICHMENT_RESEARCH.md 1E), but a
hard ~20/min throttle (403/429). Rate-limited + backoff; resumable per-track cache.
Kick off EARLY (slowest step) so it overlaps everything else.

Output: enrich_out/itunes_years.json
  { "<trackIdx>": {"year": <int>, "itunes_track","itunes_artist"} }
"""
import argparse, os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

SRC = "itunes"
SEARCH = "https://itunes.apple.com/search?entity=song&limit=5&term="
RETRY = (403, 429, 500, 502, 503, 504)

def fetch_year(artist, title):
    term = f"{artist} {title}"
    raw = C.http_get(SEARCH + C.q(term), retries=6, backoff=3.0, retry_on=RETRY, timeout=30)
    js = json.loads(raw.decode("utf-8"))
    res = js.get("results", [])
    if not res:
        return None
    ta = C.norm_name(artist); tt = C.norm_name(title)
    best = None
    for r in res:
        if C.norm_name(r.get("artistName", "")) == ta:
            best = r; break
    best = best or res[0]
    rd = best.get("releaseDate", "") or ""
    if len(rd) >= 4 and rd[:4].isdigit():
        return {"year": int(rd[:4]), "itunes_track": (best.get("trackName") or "")[:60],
                "itunes_artist": (best.get("artistName") or "")[:60]}
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idmap", default=os.path.join(C.ENRICH_RAW, "idmap.json"))
    ap.add_argument("--out", default=os.path.join(C.ENRICH_OUT, "itunes_years.json"))
    ap.add_argument("--top-n", type=int, default=1200)
    ap.add_argument("--rate", type=float, default=20.0, help="requests per minute")
    args = ap.parse_args()

    idmap = C.load_idmap(args.idmap)
    tracks = C.track_worklist(idmap)[:args.top_n]
    delay = 60.0 / max(args.rate, 1.0)

    todo = [t for t in tracks if not C.cache_has(SRC, t["id"] or f"idx{t['idx']}")]
    C.log(f"itunes: top-{args.top_n} tracks, {len(tracks)-len(todo)} cached, {len(todo)} to fetch "
          f"(@{args.rate}/min ~= {len(todo)*delay/60:.0f} min)")

    t0 = time.time(); done = 0
    for t in todo:
        ckey = t["id"] or f"idx{t['idx']}"
        title = C.clean_track_title(t["name"])
        try:
            rec = fetch_year(t["artist"], title)
            C.cache_put(SRC, ckey, rec)
        except Exception as e:
            C.eprint(f"  {t['name'][:30]} err {str(e)[:60]} (retry next run)")
        done += 1
        if done % 50 == 0 or done == len(todo):
            hit = sum(1 for x in tracks if C.cache_get(SRC, x['id'] or f"idx{x['idx']}"))
            C.log(f"  {done}/{len(todo)} fetched, {hit} years so far ({time.time()-t0:.0f}s)")
        time.sleep(delay)

    out = {}; total_ms = sum(t["ms"] for t in tracks); hit_ms = 0
    for t in tracks:
        ckey = t["id"] or f"idx{t['idx']}"
        rec = C.cache_get(SRC, ckey) if C.cache_has(SRC, ckey) else None
        if rec and rec.get("year"):
            out[str(t["idx"])] = rec
            hit_ms += t["ms"]
    C.dump_json(args.out, out)
    C.log(f"itunes done: {len(out)}/{len(tracks)} years; time-weighted of top-{args.top_n}: "
          f"{100*hit_ms/total_ms:.1f}%")
    C.log(f"wrote {args.out}")

if __name__ == "__main__":
    main()
