#!/usr/bin/env python3
"""
Step 5 - LRCLIB lyrics for the top-N tracks by listening time -> DERIVED STATS ONLY.

Raw lyric text is fetched transiently, cached ONLY in enrich_raw scratch, and NEVER
written to any shipping output (copyright; quirk #14). We ship per-track: word count,
unique words, repetitiveness, VADER sentiment, explicit flag, theme flags (from
theme_lexicons.json), and top-5 distinctive words (TF-IDF, stopword-filtered).

Concurrent polite workers (LRCLIB is ~8s latency-bound, not rate-limited; quirk #13).

Output: enrich_out/lyrics_stats.json
  { "<trackIdx>": {wc,uw,rep,sent,exp,themes:[...],words:[...]} }
"""
import argparse, os, sys, time, re, math, json
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

RAW = "lrclib_raw"   # scratch cache namespace (raw lyrics; enrich_raw only, never shipped)
SEARCH = "https://lrclib.net/api/search?track_name=%s&artist_name=%s"

STOPWORDS = set("""a about above after again all am an and any are aren't as at be because been
before being below between both but by can can't cannot could couldn't did didn't do does doesn't
doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd
he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is
isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other
ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such
than that that's the their theirs them themselves then there there's these they they'd they'll they're
they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't
what what's when when's where where's which while who who's whom why why's with won't would wouldn't
you you'd you'll you're you've your yours yourself yourselves oh yeah ooh na la da gonna wanna gotta
aint got get got im dont cant youre ill ive well cause em back one now know like just go come see
say said get got make take give let em back go going""".split())

PROFANITY = set("""fuck fucks fucked fucking fuckin motherfucker shit shitty bullshit bitch bitches
ass asshole dick dickhead pussy cunt nigga niggas nigger bastard damn goddamn hell whore slut cock
piss pissed prick douche jackass""".split())

WORD_RE = re.compile(r"[a-z][a-z']+")

def fetch_lyrics(track, artist):
    url = SEARCH % (C.q(C.clean_track_title(track)), C.q(artist))
    res = C.http_get_json(url, timeout=45, retries=3, backoff=3.0)
    if not res:
        return {"plain": None}
    best = None
    for r in res:
        if r.get("plainLyrics"):
            best = r; break
    if best is None:
        return {"plain": None}
    return {"plain": best.get("plainLyrics")}

def tokenize(text):
    return WORD_RE.findall(text.lower())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idmap", default=os.path.join(C.ENRICH_RAW, "idmap.json"))
    ap.add_argument("--lexicons", default=os.path.join(C.ENRICH_DIR, "theme_lexicons.json"))
    ap.add_argument("--out", default=os.path.join(C.ENRICH_OUT, "lyrics_stats.json"))
    ap.add_argument("--top-n", type=int, default=2000)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    idmap = C.load_idmap(args.idmap)
    tracks = C.track_worklist(idmap)[:args.top_n]
    tracks = [t for t in tracks if t["id"]]
    lex = C.load_json(args.lexicons)
    themes = lex["themes"]; min_hits = lex.get("min_hits", 2)

    # ---- fetch phase (concurrent), cache raw lyrics in scratch ----
    todo = [t for t in tracks if not C.cache_has(RAW, t["id"])]
    C.log(f"lrclib: top-{args.top_n} tracks, {len(tracks)-len(todo)} cached, {len(todo)} to fetch "
          f"({args.workers} workers)")
    t0 = time.time(); done = 0
    def work(t):
        try:
            C.cache_put(RAW, t["id"], fetch_lyrics(t["name"], t["artist"]))
            return True
        except Exception as e:
            C.eprint(f"  {t['name'][:30]} err {str(e)[:50]} (retry next run)")
            return False
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(work, t): t for t in todo}
        for f in as_completed(futs):
            done += 1
            if done % 100 == 0 or done == len(todo):
                C.log(f"  {done}/{len(todo)} fetched ({time.time()-t0:.0f}s)")

    # ---- stats phase: compute derived stats + global DF for TF-IDF ----
    vader = SentimentIntensityAnalyzer()
    docs = {}        # trackIdx -> token list
    df = {}          # word -> document frequency
    for t in tracks:
        rec = C.cache_get(RAW, t["id"]) if C.cache_has(RAW, t["id"]) else None
        if not rec or not rec.get("plain"):
            continue
        toks = tokenize(rec["plain"])
        if not toks:
            continue
        docs[t["idx"]] = (toks, rec["plain"])
        seen = set(w for w in toks if w not in STOPWORDS and len(w) >= 3)
        for w in seen:
            df[w] = df.get(w, 0) + 1

    N = max(len(docs), 1)
    out = {}
    for idx, (toks, plain) in docs.items():
        total = len(toks)
        uniq = len(set(toks))
        rep = 1 - uniq / total if total else 0
        comp = vader.polarity_scores(plain)["compound"]
        # explicit
        exp = 1 if sum(1 for w in toks if w in PROFANITY) >= 1 else 0
        # themes
        low = plain.lower()
        tflags = []
        for name, words in themes.items():
            hits = 0
            for w in words:
                if " " in w:
                    hits += low.count(w)
                else:
                    hits += sum(1 for tk in toks if tk == w)
                if hits >= min_hits:
                    break
            if hits >= min_hits:
                tflags.append(name)
        # tf-idf distinctive words
        tf = {}
        for w in toks:
            if w in STOPWORDS or len(w) < 3:
                continue
            tf[w] = tf.get(w, 0) + 1
        scored = sorted(tf.items(), key=lambda kv: -kv[1] * math.log(N / df.get(kv[0], 1) + 1))
        words = [w for w, _ in scored[:5]]
        out[str(idx)] = {
            "wc": total, "uw": uniq, "rep": round(rep * 100),
            "sent": round(comp * 100), "exp": exp,
            "themes": tflags, "words": words,
        }

    C.dump_json(args.out, out)
    total_ms = sum(t["ms"] for t in tracks)
    hit_ms = sum(t["ms"] for t in tracks if str(t["idx"]) in out)
    C.log(f"lrclib done: {len(out)}/{len(tracks)} tracks with lyric stats; "
          f"time-weighted of top-{args.top_n}: {100*hit_ms/total_ms:.1f}%")
    C.log(f"wrote {args.out}")

if __name__ == "__main__":
    main()
