#!/usr/bin/env python3
"""
Build the authoritative id-space bridge between the raw Extended Streaming
History and site/dataset.json, so enrichment can be keyed by the SAME artist /
track array indices as dataset.json.

dataset.json does NOT store Spotify URIs (build_dataset.py interns tracks by URI
then drops them). We reproduce that interning EXACTLY from the raw JSON, then
assert the reconstructed dictionaries match dataset.json's arrays element-for-
element. If they match, our uri -> trackIndex map is correct by construction.

Outputs enrich_raw/idmap.json:
  {
    "n_artists": <len artists incl sentinel>,
    "n_tracks":  <len trackName incl sentinel>,
    "artistIndexByName": { "<exact name>": <idx> },      # from dataset.artists
    "trackIndexByUri":   { "<base62 id>": <trackIndex> },  # music tracks w/ a URI
    "trackArtistIdx":    [ ... ],   # copy of dataset.trackArtist
    "trackName":         [ ... ],   # copy of dataset.trackName (for reporting)
  }

Reusable: paths are argparse-driven; no user specifics baked in.
"""
import argparse, glob, os, json, sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C


def parse_years(spec):
    if not spec:
        return None
    spec = str(spec).strip()
    if "-" in spec:
        lo, hi = spec.split("-", 1); lo, hi = int(lo), int(hi)
    else:
        lo = hi = int(spec)
    return (min(lo, hi), max(lo, hi))


def local_year(ts, tz):
    dt_utc = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return dt_utc.astimezone(tz).year


def reconstruct(data_dir, tz=None, year_range=None):
    """Replay build_dataset.py interning; return the dicts + uri map.
    When year_range is set, applies the SAME first-pass year filter as
    build_dataset.load_all so the reconstructed id-space stays identical."""
    files = sorted(glob.glob(os.path.join(data_dir, "Streaming_History_*.json")))
    audio_files = [f for f in files if "Audio" in os.path.basename(f)]
    video_files = [f for f in files if "Video" in os.path.basename(f)]

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

    trackName, trackArtist, trackAlbum = ["Unknown"], [0], [0]
    track_ix = {}
    trackUri = [None]           # parallel to trackName; URI that keyed each track
    def track_id(uri, name, aid, alid):
        k = uri if uri else ("N", name, aid)
        if k not in track_ix:
            track_ix[k] = len(trackName)
            trackName.append(name or "Unknown"); trackArtist.append(aid); trackAlbum.append(alid)
            trackUri.append(uri or None)
        return track_ix[k]

    # dedup exactly like build_dataset.load_all: (ts, uri, ms_played)
    seen = set()
    for f in audio_files + video_files:
        for r in json.load(open(f, encoding="utf-8")):
            # identical first-pass year filter to build_dataset.load_all
            if year_range and r.get("ts"):
                yr = local_year(r["ts"], tz)
                if yr < year_range[0] or yr > year_range[1]:
                    continue
            uri = r.get("spotify_track_uri") or r.get("spotify_episode_uri") or r.get("audiobook_uri") or ""
            key = (r.get("ts"), uri, r.get("ms_played"))
            if key in seen:
                continue
            seen.add(key)
            # only music tracks intern into the track space
            abt = r.get("audiobook_title")
            ename = r.get("episode_name")
            if abt or ename:
                continue
            tname = r.get("master_metadata_track_name")
            if not tname:
                continue  # null -> Unknown sentinel (tr=0), not interned
            aid = artist_id(r.get("master_metadata_album_artist_name"))
            alid = album_id(r.get("master_metadata_album_album_name"), aid)
            track_id(r.get("spotify_track_uri"), tname, aid, alid)

    return {
        "artists": artists, "trackName": trackName,
        "trackArtist": trackArtist, "trackAlbum": trackAlbum,
        "albumName": albumName, "albumArtist": albumArtist,
        "trackUri": trackUri,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=os.path.join(C.ROOT, "data", "Spotify Extended Streaming History"))
    ap.add_argument("--dataset", default=os.path.join(C.SITE_DIR, "dataset.json"))
    ap.add_argument("--out", default=os.path.join(C.ENRICH_RAW, "idmap.json"))
    ap.add_argument("--tz", default="America/New_York",
                    help="must match the --tz passed to build_dataset.py")
    ap.add_argument("--years", default=None,
                    help="must match the --years passed to build_dataset.py")
    args = ap.parse_args()

    year_range = parse_years(args.years)
    tz = ZoneInfo(args.tz)
    C.log("reconstructing interning from raw streaming history...")
    rec = reconstruct(args.data_dir, tz, year_range)
    ds = C.load_json(args.dataset)

    # ---- verify alignment element-for-element against dataset.json ----
    problems = []
    for field in ("artists", "trackName", "trackArtist", "trackAlbum", "albumName", "albumArtist"):
        a, b = rec[field], ds[field]
        if len(a) != len(b):
            problems.append(f"{field}: length {len(a)} (reconstructed) != {len(b)} (dataset)")
            continue
        mism = [i for i in range(len(a)) if a[i] != b[i]]
        if mism:
            problems.append(f"{field}: {len(mism)} element mismatches, first at idx {mism[0]}: "
                            f"{a[mism[0]]!r} != {b[mism[0]]!r}")

    if problems:
        C.eprint("!! ID-SPACE ALIGNMENT FAILED — reconstruction does not match dataset.json:")
        for p in problems:
            C.eprint("   " + p)
        sys.exit(1)
    C.log(f"  OK: dictionaries match dataset.json exactly "
          f"({len(rec['artists'])} artists, {len(rec['trackName'])} tracks incl sentinel)")

    # ---- build the uri -> trackIndex map ----
    uri_by_idx = rec["trackUri"]
    trackIndexByUri = {}
    for idx, uri in enumerate(uri_by_idx):
        if uri and uri.startswith("spotify:track:"):
            base62 = uri.split(":")[-1]
            trackIndexByUri[base62] = idx
    n_with_uri = len(trackIndexByUri)

    artistIndexByName = {name: i for i, name in enumerate(ds["artists"])}

    # ---- listening-time weights per track/artist index (music plays only) ----
    n_tr = len(ds["trackName"]); n_ar = len(ds["artists"])
    trackMs = [0] * n_tr; trackPlays = [0] * n_tr
    artistMs = [0] * n_ar; artistPlays = [0] * n_ar
    tr = ds["tr"]; ty = ds["ty"]; ms = ds["ms"]; tArt = ds["trackArtist"]
    for i in range(ds["n"]):
        if ty[i] != 0:
            continue
        tid = tr[i]
        trackMs[tid] += ms[i]; trackPlays[tid] += 1
        aid = tArt[tid]
        artistMs[aid] += ms[i]; artistPlays[aid] += 1
    total_music_ms = sum(ms[i] for i in range(ds["n"]) if ty[i] == 0)

    out = {
        "n_artists": len(ds["artists"]),
        "n_tracks": len(ds["trackName"]),
        "n_tracks_with_uri": n_with_uri,
        "total_music_ms": total_music_ms,
        "artistIndexByName": artistIndexByName,
        "trackIndexByUri": trackIndexByUri,
        "trackArtistIdx": ds["trackArtist"],
        "trackName": ds["trackName"],
        "artists": ds["artists"],
        "albumName": ds["albumName"],
        "trackAlbum": ds["trackAlbum"],
        "trackMs": trackMs, "trackPlays": trackPlays,
        "artistMs": artistMs, "artistPlays": artistPlays,
    }
    C.dump_json(args.out, out)
    C.log(f"  {n_with_uri}/{len(ds['trackName'])-1} track slots have a Spotify URI")
    C.log(f"wrote {args.out}")


if __name__ == "__main__":
    main()
