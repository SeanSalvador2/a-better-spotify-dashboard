#!/usr/bin/env python3
"""
Step 3 - ReccoBeats audio features for ALL track IDs, by Spotify ID.

Winner for mood (docs/ENRICHMENT_RESEARCH.md 1B): ~80% time-weighted direct match,
no auth/throttle. Results mapped back by href (the Spotify id) - NEVER by request
order (quirk #7). Cached per track id so reruns are incremental.

Also computes artist-level MEAN feature vectors from matched tracks, for backfill
of unmatched tracks at build time.

Output: enrich_out/reccobeats_features.json
  { "features": {"<trackIdx>": {energy,valence,danceability,tempo,acousticness,
                                instrumentalness,speechiness,loudness,liveness,isrc}},
    "artist_means": {"<artistIdx>": {feat: mean, ... , "n": <#matched tracks>}} }
"""
import argparse, os, sys, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

SRC = "reccobeats"
API = "https://api.reccobeats.com/v1/audio-features?ids="
FEATS = ["energy", "valence", "danceability", "tempo", "acousticness",
         "instrumentalness", "speechiness", "loudness", "liveness"]
HREF_RE = re.compile(r"/track/([A-Za-z0-9]+)")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idmap", default=os.path.join(C.ENRICH_RAW, "idmap.json"))
    ap.add_argument("--out", default=os.path.join(C.ENRICH_OUT, "reccobeats_features.json"))
    ap.add_argument("--batch", type=int, default=20)
    ap.add_argument("--sleep", type=float, default=0.1)
    ap.add_argument("--top-n", type=int, default=0, help="0 = all tracks")
    args = ap.parse_args()

    idmap = C.load_idmap(args.idmap)
    tracks = C.track_worklist(idmap)
    if args.top_n:
        tracks = tracks[:args.top_n]
    tracks = [t for t in tracks if t["id"]]

    todo = [t for t in tracks if not C.cache_has(SRC, t["id"])]
    C.log(f"reccobeats: {len(tracks)} tracks, {len(tracks)-len(todo)} cached, {len(todo)} to fetch")

    t0 = time.time(); fetched = 0
    for i in range(0, len(todo), args.batch):
        batch = todo[i:i + args.batch]
        ids = [t["id"] for t in batch]
        try:
            js = C.http_get_json(API + ",".join(ids), timeout=30)
        except Exception as e:
            C.eprint(f"  batch {i} error: {str(e)[:100]} (retry next run)")
            time.sleep(args.sleep * 5)
            continue
        by_id = {}
        for e in js.get("content", []):
            m = HREF_RE.search(e.get("href", "") or "")
            if not m or e.get("energy") is None:
                continue
            tid = m.group(1)
            rec = {}
            for f in FEATS:
                v = e.get(f)
                if v is not None:
                    rec[f] = v
            if e.get("isrc"):
                rec["isrc"] = e["isrc"]
            by_id[tid] = rec
        # cache each requested id: matched -> record, else None (genuine miss)
        for t in batch:
            C.cache_put(SRC, t["id"], by_id.get(t["id"]))
        fetched += len(batch)
        if (i // args.batch) % 80 == 0 or fetched >= len(todo):
            C.log(f"  {fetched}/{len(todo)} fetched ({time.time()-t0:.0f}s)")
        time.sleep(args.sleep)

    # ---- assemble features keyed by track index + artist means ----
    features = {}
    art_acc = {}   # artistIdx -> {feat: [sum,count]}
    matched_ms = 0; total_ms = sum(t["ms"] for t in tracks)
    for t in tracks:
        rec = C.cache_get(SRC, t["id"]) if C.cache_has(SRC, t["id"]) else None
        if not rec:
            continue
        features[str(t["idx"])] = rec
        matched_ms += t["ms"]
        aid = t["artistIdx"]
        acc = art_acc.setdefault(aid, {})
        for f in FEATS:
            if f in rec:
                s = acc.setdefault(f, [0.0, 0])
                s[0] += rec[f]; s[1] += 1

    artist_means = {}
    for aid, acc in art_acc.items():
        m = {"n": max(acc.get(f, [0, 0])[1] for f in FEATS)}
        for f in FEATS:
            if f in acc and acc[f][1] > 0:
                m[f] = acc[f][0] / acc[f][1]
        artist_means[str(aid)] = m

    C.dump_json(args.out, {"features": features, "artist_means": artist_means})
    C.log(f"reccobeats done: {len(features)}/{len(tracks)} tracks matched "
          f"({100*len(features)/len(tracks):.1f}%)")
    C.log(f"  time-weighted coverage: {100*matched_ms/total_ms:.1f}%  "
          f"artist-mean vectors: {len(artist_means)}")
    C.log(f"wrote {args.out}")

if __name__ == "__main__":
    main()
