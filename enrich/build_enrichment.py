#!/usr/bin/env python3
"""
Assemble site/enrichment.json (+ .gz): compact, dictionary-encoded, keyed by the
SAME artist/track array indices as dataset.json.

Merges all step outputs:
  wikidata_artists.json, deezer_artists.json, musicbrainz_artists.json,
  reccobeats_features.json, release_years.json, lyrics_stats.json
into index-aligned columnar arrays. Floats quantized (0-1 features -> 0-100 int;
tempo -> int bpm; loudness -> int dB). Includes a time-weighted `coverage` block.

Reusable: paths argparse-driven; nothing user-specific in logic.
"""
import argparse, os, sys, gzip, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import genremap as G

FEAT01 = ["energy", "valence", "danceability", "acousticness", "instrumentalness", "speechiness"]

def q100(v):
    if v is None:
        return -1
    return max(0, min(100, round(v * 100)))

def load_opt(path):
    return C.load_json(path) if os.path.exists(path) else {}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idmap", default=os.path.join(C.ENRICH_RAW, "idmap.json"))
    ap.add_argument("--wikidata", default=os.path.join(C.ENRICH_OUT, "wikidata_artists.json"))
    ap.add_argument("--deezer", default=os.path.join(C.ENRICH_OUT, "deezer_artists.json"))
    ap.add_argument("--musicbrainz", default=os.path.join(C.ENRICH_OUT, "musicbrainz_artists.json"))
    ap.add_argument("--reccobeats", default=os.path.join(C.ENRICH_OUT, "reccobeats_features.json"))
    ap.add_argument("--release", default=os.path.join(C.ENRICH_OUT, "release_years.json"))
    ap.add_argument("--lyrics", default=os.path.join(C.ENRICH_OUT, "lyrics_stats.json"))
    ap.add_argument("--out", default=os.path.join(C.SITE_DIR, "enrichment.json"))
    args = ap.parse_args()

    idmap = C.load_idmap(args.idmap)
    n_ar = idmap["n_artists"]; n_tr = idmap["n_tracks"]
    artistMs = idmap["artistMs"]; trackMs = idmap["trackMs"]; tArt = idmap["trackArtistIdx"]
    total_artist_ms = sum(artistMs); total_track_ms = sum(trackMs)

    wiki = load_opt(args.wikidata)
    deez = load_opt(args.deezer)
    mb = load_opt(args.musicbrainz)
    recco = load_opt(args.reccobeats) or {"features": {}, "artist_means": {}}
    feats = recco.get("features", {}); art_means = recco.get("artist_means", {})
    release = load_opt(args.release)
    lyrics = load_opt(args.lyrics)

    # ---------- dictionaries ----------
    umbrellas = G.umbrellas()
    umb_ix = {u: i for i, u in enumerate(umbrellas)}
    def clip(s):  # defensive: keep every shipped string <=60 chars
        return s[:60]
    subgenres = []; sub_ix = {}
    def sub_id(label):
        key = clip(label.strip())
        if key not in sub_ix:
            sub_ix[key] = len(subgenres); subgenres.append(key)
        return sub_ix[key]
    countries = []; ctry_ix = {}
    def ctry_id(name):
        if not name:
            return -1
        name = clip(name)
        if name not in ctry_ix:
            ctry_ix[name] = len(countries); countries.append(name)
        return ctry_ix[name]
    cities = []; city_ix = {}
    def city_id(name):
        if not name:
            return -1
        name = clip(name)
        if name not in city_ix:
            city_ix[name] = len(cities); cities.append(name)
        return city_ix[name]

    # ---------- ARTIST arrays ----------
    A_umb = [-1] * n_ar
    A_sub = [[] for _ in range(n_ar)]
    A_ctry = [-1] * n_ar
    A_city = [-1] * n_ar
    A_year = [0] * n_ar
    A_fans = [-1] * n_ar

    for aidx in range(1, n_ar):
        s = str(aidx)
        w = wiki.get(s); d = deez.get(s); m = mb.get(s)
        labels = []
        if w and w.get("genres"):
            labels += w["genres"]
        if m and m.get("genres"):
            labels += m["genres"]
        # dedup labels case-insensitively, preserve order
        seen = set(); ulabels = []
        for lab in labels:
            k = lab.lower()
            if k not in seen:
                seen.add(k); ulabels.append(lab)
        deezer_genre = d.get("genre") if d else None
        # subgenre index list (rich level a) - includes Deezer coarse bucket as a label
        sub_list = list(ulabels)
        if deezer_genre and deezer_genre.lower() not in seen:
            sub_list.append(deezer_genre)
        A_sub[aidx] = [sub_id(x) for x in sub_list]
        # primary umbrella (level b)
        umb = G.primary_umbrella(ulabels, deezer_genre)
        if umb is None and deezer_genre:
            umb = G.umbrella_of(deezer_genre)
        if umb is not None:
            A_umb[aidx] = umb_ix[umb]
        # origin country: prefer MusicBrainz area (top artists, type+name+score
        # disambiguated) when present; else Wikidata country. Wikidata's batched
        # altLabel match can pull a wrong same-name item (e.g. The Beatles ->
        # "Soviet Union"); MB fixes the high-visibility ones. (quirk #8/#9)
        ctry = (m.get("area") if m else "") or (w.get("country") if w else "")
        A_ctry[aidx] = ctry_id(ctry)
        # city: MusicBrainz begin-area
        if m and m.get("city"):
            A_city[aidx] = city_id(m["city"])
        # formation/birth year: MB begin_year when present, else Wikidata
        yr = 0
        if m and m.get("begin_year"):
            yr = m["begin_year"]
        if not yr and w and w.get("year"):
            try: yr = int(str(w["year"])[:4])
            except: yr = 0
        A_year[aidx] = yr if yr else 0
        # popularity
        if d and d.get("nb_fan") is not None:
            A_fans[aidx] = d["nb_fan"]

    # ---------- TRACK arrays ----------
    T = {f: [-1] * n_tr for f in FEAT01}
    T_tempo = [-1] * n_tr
    T_loud = [-127] * n_tr
    T_featsrc = [-1] * n_tr    # 0 direct, 1 artist-backfill, -1 none
    T_year = [0] * n_tr
    T_yearsrc = [-1] * n_tr    # 0 itunes, 1 deezer, 2 isrc
    YSRC = {"itunes": 0, "deezer": 1, "isrc": 2}

    def set_feats(tidx, rec, src):
        for f in FEAT01:
            if f in rec and rec[f] is not None:
                T[f][tidx] = q100(rec[f])
        if rec.get("tempo") is not None:
            T_tempo[tidx] = round(rec["tempo"])
        if rec.get("loudness") is not None:
            T_loud[tidx] = round(rec["loudness"])
        T_featsrc[tidx] = src

    direct_ct = 0; backfill_ct = 0
    for tidx in range(1, n_tr):
        s = str(tidx)
        rec = feats.get(s)
        if rec:
            set_feats(tidx, rec, 0); direct_ct += 1
        else:
            # artist-average backfill
            am = art_means.get(str(tArt[tidx]))
            if am and am.get("n", 0) > 0:
                set_feats(tidx, am, 1); backfill_ct += 1
        # release year
        r = release.get(s)
        if r and r.get("year"):
            T_year[tidx] = r["year"]
            T_yearsrc[tidx] = YSRC.get(r.get("src"), -1)

    # ---------- lyric arrays ----------
    theme_names = list(C.load_json(os.path.join(C.ENRICH_DIR, "theme_lexicons.json"))["themes"].keys())
    theme_ix = {t: i for i, t in enumerate(theme_names)}
    L_wc = [-1] * n_tr; L_uw = [-1] * n_tr; L_rep = [-1] * n_tr
    L_sent = [0] * n_tr; L_exp = [-1] * n_tr
    L_themes = [[] for _ in range(n_tr)]; L_top = [[] for _ in range(n_tr)]
    L_has = [0] * n_tr
    for s, ly in lyrics.items():
        tidx = int(s)
        L_wc[tidx] = ly["wc"]; L_uw[tidx] = ly["uw"]; L_rep[tidx] = ly["rep"]
        L_sent[tidx] = ly["sent"]; L_exp[tidx] = ly["exp"]
        L_themes[tidx] = [theme_ix[t] for t in ly.get("themes", []) if t in theme_ix]
        L_top[tidx] = [w[:60] for w in ly.get("words", [])[:5]]
        L_has[tidx] = 1

    # ---------- coverage (time-weighted) ----------
    def aw(pred):  # artist-ms weighted fraction
        num = sum(artistMs[i] for i in range(1, n_ar) if pred(i))
        return round(100 * num / total_artist_ms, 1) if total_artist_ms else 0.0
    def tw(pred):  # track-ms weighted fraction
        num = sum(trackMs[i] for i in range(1, n_tr) if pred(i))
        return round(100 * num / total_track_ms, 1) if total_track_ms else 0.0

    coverage = {
        "genres_umbrella": aw(lambda i: A_umb[i] >= 0),
        "genres_subgenre": aw(lambda i: len(A_sub[i]) > 0),
        "origin_country": aw(lambda i: A_ctry[i] >= 0),
        "origin_city": aw(lambda i: A_city[i] >= 0),
        "formation_year": aw(lambda i: A_year[i] > 0),
        "popularity": aw(lambda i: A_fans[i] >= 0),
        "audio_features_direct": tw(lambda i: T_featsrc[i] == 0),
        "audio_features_any": tw(lambda i: T_featsrc[i] >= 0),
        "release_year": tw(lambda i: T_year[i] > 0),
        "lyrics": tw(lambda i: L_has[i] == 1),
    }

    # ---------- emit (index-aligned, dictionary-encoded) ----------
    out = {
        "v": 1,
        "note": "see docs/DATA_SPEC.md ENRICHMENT section",
        "n_artists": n_ar, "n_tracks": n_tr,
        "umbrellas": umbrellas,
        "subgenres": subgenres,
        "countries": countries,
        "cities": cities,
        "themes": theme_names,
        "featOrder": FEAT01,
        "yearSrc": ["itunes", "deezer", "isrc"],
        "featSrc": ["direct", "artist-mean"],
        # artist-level
        "artistUmbrella": A_umb,
        "artistSubgenres": A_sub,
        "artistCountry": A_ctry,
        "artistCity": A_city,
        "artistYear": A_year,
        "artistFans": A_fans,
        # track-level audio features (0-100 ints; tempo bpm; loud dB)
        "trackEnergy": T["energy"], "trackValence": T["valence"],
        "trackDance": T["danceability"], "trackAcoustic": T["acousticness"],
        "trackInstr": T["instrumentalness"], "trackSpeech": T["speechiness"],
        "trackTempo": T_tempo, "trackLoud": T_loud, "trackFeatSrc": T_featsrc,
        # track release year
        "trackYear": T_year, "trackYearSrc": T_yearsrc,
        # track lyric-derived stats
        "lyrWords": L_wc, "lyrUnique": L_uw, "lyrRep": L_rep, "lyrSent": L_sent,
        "lyrExplicit": L_exp, "lyrThemes": L_themes, "lyrTop": L_top,
        "coverage": coverage,
    }

    minified = json.dumps(out, separators=(",", ":"), ensure_ascii=False)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(minified)
    raw = minified.encode("utf-8")
    with gzip.open(args.out + ".gz", "wb", compresslevel=9) as f:
        f.write(raw)
    jsize = os.path.getsize(args.out); gsize = os.path.getsize(args.out + ".gz")

    # also drop a copy in enrich_out for inspection
    C.dump_json(os.path.join(C.ENRICH_OUT, "coverage.json"), coverage, indent=1)

    C.log("=== enrichment built ===")
    C.log(f"  artists={n_ar-1} tracks={n_tr-1}  subgenres-dict={len(subgenres)} "
          f"countries={len(countries)} cities={len(cities)}")
    C.log(f"  features: {direct_ct} direct + {backfill_ct} artist-mean backfill")
    C.log(f"  enrichment.json    : {jsize:,} bytes ({jsize/1e6:.2f} MB)")
    C.log(f"  enrichment.json.gz : {gsize:,} bytes ({gsize/1e6:.2f} MB)")
    C.log("  coverage (time-weighted %):")
    for k, v in coverage.items():
        C.log(f"    {k:24s} {v}")

if __name__ == "__main__":
    main()
