#!/usr/bin/env python3
"""
Step 6 - MusicBrainz city-level origin for the top-N artists by listening time.

Only free source giving city/state origin (docs/ENRICHMENT_RESEARCH.md 1F).
1 req/s hard limit. Disambiguation guarded: filter search candidates by
type Person/Group + normalized-name match + score before the genre/area lookup
(quirk #9: Kanye West -> tribute band; Phoenix -> composer). Cached per artist.

Output: enrich_out/musicbrainz_artists.json
  { "<artistIdx>": {"mbid","city","area","begin_year","genres":[...],"type"} }
"""
import argparse, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

SRC = "musicbrainz"
SEARCH = "https://musicbrainz.org/ws/2/artist?fmt=json&limit=5&query="
LOOKUP = "https://musicbrainz.org/ws/2/artist/%s?fmt=json&inc=genres+tags"

def choose(cands, name):
    target = C.norm_name(name)
    scored = []
    for c in cands:
        if c.get("type") not in ("Person", "Group", "Orchestra", "Choir", None):
            continue
        nm = C.norm_name(c.get("name", ""))
        exact = (nm == target)
        scored.append((exact, c.get("score", 0), c))
    if not scored:
        return None
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    top = scored[0]
    # require either exact normalized name or a very high search score
    if not top[0] and top[1] < 90:
        return None
    return top[2]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idmap", default=os.path.join(C.ENRICH_RAW, "idmap.json"))
    ap.add_argument("--out", default=os.path.join(C.ENRICH_OUT, "musicbrainz_artists.json"))
    ap.add_argument("--top-n", type=int, default=100)
    ap.add_argument("--sleep", type=float, default=1.1, help="seconds between requests (1 req/s)")
    args = ap.parse_args()

    idmap = C.load_idmap(args.idmap)
    artists = C.artist_worklist(idmap)[:args.top_n]

    todo = [a for a in artists if not C.cache_has(SRC, a["name"])]
    C.log(f"musicbrainz: top-{args.top_n} artists, {len(artists)-len(todo)} cached, {len(todo)} to fetch")

    t0 = time.time(); done = 0
    for a in todo:
        try:
            js = C.http_get_json(SEARCH + C.q('artist:"%s"' % a["name"].replace('"', '')), timeout=30)
            time.sleep(args.sleep)
            cand = choose(js.get("artists", []), a["name"])
            if not cand:
                C.cache_put(SRC, a["name"], None)
                done += 1; continue
            mbid = cand["id"]
            lu = C.http_get_json(LOOKUP % mbid, timeout=30)
            time.sleep(args.sleep)
            genres = [g["name"] for g in lu.get("genres", [])]
            if not genres:
                tags = sorted(lu.get("tags", []), key=lambda x: -x.get("count", 0))
                genres = [t["name"] for t in tags[:6]]
            area = (lu.get("area") or {}).get("name")
            begin_area = (lu.get("begin-area") or {}).get("name")
            begin = (lu.get("life-span") or {}).get("begin") or ""
            rec = {
                "mbid": mbid,
                "city": begin_area,
                "area": area,
                "begin_year": int(begin[:4]) if begin[:4].isdigit() else None,
                "genres": genres[:8],
                "type": lu.get("type"),
            }
            C.cache_put(SRC, a["name"], rec)
        except Exception as e:
            C.eprint(f"  {a['name'][:30]} err {str(e)[:60]} (retry next run)")
        done += 1
        if done % 20 == 0 or done == len(todo):
            C.log(f"  {done}/{len(todo)} fetched ({time.time()-t0:.0f}s)")

    out = {}
    for a in artists:
        rec = C.cache_get(SRC, a["name"]) if C.cache_has(SRC, a["name"]) else None
        if rec:
            out[str(a["idx"])] = rec
    C.dump_json(args.out, out)
    city_ct = sum(1 for v in out.values() if v.get("city"))
    C.log(f"musicbrainz done: {len(out)}/{len(artists)} matched, {city_ct} with city-level origin")
    C.log(f"wrote {args.out}")

if __name__ == "__main__":
    main()
