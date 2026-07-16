#!/usr/bin/env python3
"""
Step 1 - Wikidata SPARQL (batched): genres + origin country + formation/birth year
for ALL artists.

Primary artist-metadata source (rich subgenres, per docs/ENRICHMENT_RESEARCH.md 1C).
Batched 50 names/query; results cached PER ARTIST so interrupted runs resume and
reruns only query the artists not yet cached.

Output: enrich_out/wikidata_artists.json
  { "<artistIdx>": {"label","genres":[...],"country","year"} }  (only matched artists)
"""
import argparse, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

SPARQL = "https://query.wikidata.org/sparql?format=json&query="
SRC = "wikidata"

def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')

def build_query(names):
    values = " ".join('"%s"@en' % esc(n) for n in names)
    return f'''SELECT ?name (SAMPLE(?item) AS ?it) (GROUP_CONCAT(DISTINCT ?g;separator="|") AS ?genres)
      (SAMPLE(?cty) AS ?country) (SAMPLE(?yr) AS ?year) WHERE {{
      VALUES ?name {{ {values} }}
      ?item rdfs:label|skos:altLabel ?name .
      ?item wdt:P31/wdt:P279* ?t . VALUES ?t {{ wd:Q5 wd:Q215380 wd:Q2088357 wd:Q56816954 }}
      OPTIONAL {{ ?item wdt:P136 ?ge . ?ge rdfs:label ?g FILTER(LANG(?g)="en") }}
      OPTIONAL {{ ?item wdt:P495 ?c . ?c rdfs:label ?cty FILTER(LANG(?cty)="en") }}
      OPTIONAL {{ ?item wdt:P27 ?c2 . ?c2 rdfs:label ?cty FILTER(LANG(?cty)="en") }}
      OPTIONAL {{ ?item wdt:P571 ?y . BIND(YEAR(?y) AS ?yr) }}
      OPTIONAL {{ ?item wdt:P569 ?y2 . BIND(YEAR(?y2) AS ?yr) }}
    }} GROUP BY ?name'''

def parse_rows(rows):
    got = {}
    for b in rows:
        nm = b["name"]["value"]
        g = b.get("genres", {}).get("value", "")
        genres = [x.strip() for x in g.split("|") if x.strip()]
        rec = {
            "label": b.get("it", {}).get("value", "").split("/")[-1],
            "genres": genres,
            "country": b.get("country", {}).get("value", ""),
            "year": b.get("year", {}).get("value", ""),
        }
        if nm not in got or (genres and not got[nm]["genres"]):
            got[nm] = rec
    return got

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idmap", default=os.path.join(C.ENRICH_RAW, "idmap.json"))
    ap.add_argument("--out", default=os.path.join(C.ENRICH_OUT, "wikidata_artists.json"))
    ap.add_argument("--batch", type=int, default=50)
    ap.add_argument("--sleep", type=float, default=1.0, help="seconds between queries")
    ap.add_argument("--top-n", type=int, default=0, help="0 = all artists")
    args = ap.parse_args()

    idmap = C.load_idmap(args.idmap)
    artists = C.artist_worklist(idmap)
    if args.top_n:
        artists = artists[:args.top_n]

    # figure out which artists still need querying (per-artist cache)
    todo = [a for a in artists if not C.cache_has(SRC, a["name"])]
    C.log(f"wikidata: {len(artists)} artists, {len(artists)-len(todo)} cached, {len(todo)} to query")

    t0 = time.time()
    for i in range(0, len(todo), args.batch):
        batch = todo[i:i + args.batch]
        names = [a["name"] for a in batch]
        try:
            js = C.http_get_json(SPARQL + C.q(build_query(names)),
                                 headers={"Accept": "application/sparql-results+json"},
                                 timeout=90)
            got = parse_rows(js["results"]["bindings"])
        except Exception as e:
            C.eprint(f"  batch {i} error: {str(e)[:120]} (will retry next run)")
            time.sleep(args.sleep * 3)
            continue
        # cache every artist in the batch (matched -> record, unmatched -> None sentinel)
        for a in batch:
            C.cache_put(SRC, a["name"], got.get(a["name"]))
        done = i + len(batch)
        if (i // args.batch) % 5 == 0 or done >= len(todo):
            C.log(f"  {done}/{len(todo)} queried  ({time.time()-t0:.0f}s)")
        time.sleep(args.sleep)

    # assemble output keyed by artist index from cache
    out = {}
    matched = 0
    for a in artists:
        rec = C.cache_get(SRC, a["name"]) if C.cache_has(SRC, a["name"]) else None
        if rec and (rec.get("genres") or rec.get("country") or rec.get("year")):
            out[str(a["idx"])] = rec
            matched += 1
    C.dump_json(args.out, out)

    # coverage report
    total_ms = sum(a["ms"] for a in artists)
    g_ms = sum(a["ms"] for a in artists if C.cache_get(SRC, a["name"]) and C.cache_get(SRC, a["name"]).get("genres"))
    c_ms = sum(a["ms"] for a in artists if C.cache_get(SRC, a["name"]) and C.cache_get(SRC, a["name"]).get("country"))
    C.log(f"wikidata done: {matched}/{len(artists)} artists have any metadata")
    C.log(f"  time-weighted genre coverage: {100*g_ms/total_ms:.1f}%  country: {100*c_ms/total_ms:.1f}%")
    C.log(f"wrote {args.out}")

if __name__ == "__main__":
    main()
