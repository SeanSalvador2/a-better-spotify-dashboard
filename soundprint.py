#!/usr/bin/env python3
"""
Soundprint — one-command builder.

Turn anyone's Spotify Extended Streaming History export into a single, fully
self-contained, enriched HTML dashboard.

    python soundprint.py my_spotify_data.zip
    python soundprint.py my_spotify_data.zip --out build --skip-enrich
    python soundprint.py my_spotify_data.zip --years 2019-2023
    python soundprint.py my_spotify_data.zip --top-lyrics 3000 --top-itunes 2000

Pipeline
    unzip -> pipeline/build_dataset.py -> (enrichment steps) -> site/build.py
             -> <out>/soundprint.html

The enrichment steps hit six public APIs (Wikidata, Deezer, ReccoBeats, iTunes,
LRCLIB, MusicBrainz). Every lookup is cached on disk under the work directory, so
an interrupted run resumes exactly where it left off and re-runs are incremental.
A full first enrichment pass can take anywhere from minutes to a few HOURS
depending on library size (iTunes is throttled to ~20 requests/minute). Pass
--skip-enrich for a fast dashboard without the genre / mood / lyrics pages.

Nothing leaves your machine except anonymous metadata lookups (artist names,
track titles). IP addresses are stripped; raw lyric text is fetched transiently
and never written to any shipped file.
"""
import argparse
import os
import shutil
import subprocess
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable


# ----------------------------------------------------------------------------
def banner(msg):
    line = "=" * min(78, len(msg) + 4)
    print(f"\n{line}\n  {msg}\n{line}", flush=True)


def run(cmd, env=None, label=None):
    """Run a subprocess, streaming its output; abort the build on failure."""
    if label:
        print(f"\n$ {label}", flush=True)
    print("  " + " ".join(str(c) for c in cmd), flush=True)
    t0 = time.time()
    r = subprocess.run(cmd, env=env)
    if r.returncode != 0:
        print(f"\nSTEP FAILED ({label or cmd[0]}) with exit code {r.returncode}", file=sys.stderr)
        sys.exit(r.returncode)
    print(f"  done in {time.time() - t0:.0f}s", flush=True)


def find_history_dir(root):
    """Locate the folder that actually contains Streaming_History_*.json."""
    for dirpath, _dirs, files in os.walk(root):
        if any(f.startswith("Streaming_History_") and f.endswith(".json") for f in files):
            return dirpath
    return None


# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(
        prog="soundprint.py",
        description="Build a single-file enriched dashboard from a Spotify Extended Streaming History zip.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("zip", help="your Spotify Extended Streaming History .zip (or an already-unzipped folder)")
    ap.add_argument("--out", default="build", help="output/work directory (default: ./build)")
    ap.add_argument("--skip-enrich", action="store_true",
                    help="skip the API enrichment steps (no genre/mood/lyrics pages; builds fast)")
    ap.add_argument("--years", default=None,
                    help="subset plays to a year or range before building, e.g. 2019-2023 or 2022")
    ap.add_argument("--tz", default="America/New_York",
                    help="IANA timezone for local-wall-clock timestamps (default America/New_York)")
    ap.add_argument("--top-lyrics", type=int, default=2000,
                    help="how many top tracks (by listening time) to fetch lyric stats for (default 2000)")
    ap.add_argument("--top-itunes", type=int, default=1200,
                    help="how many top tracks to look up release years for via iTunes (default 1200)")
    ap.add_argument("--keep-going", action="store_true",
                    help="if an enrichment source errors out, continue with whatever was gathered")
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    work_data = os.path.join(out, "data")
    enrich_raw = os.path.join(out, "enrich_raw")
    enrich_out = os.path.join(out, "enrich_out")
    docs_out = os.path.join(out, "_stats")
    os.makedirs(out, exist_ok=True)
    os.makedirs(enrich_raw, exist_ok=True)
    os.makedirs(enrich_out, exist_ok=True)

    idmap_path = os.path.join(enrich_raw, "idmap.json")
    dataset_json = os.path.join(out, "dataset.json")
    enrichment_json = os.path.join(out, "enrichment.json")
    final_html = os.path.join(out, "soundprint.html")

    # environment for the enrich/ scripts so their on-disk caches + outputs live
    # under the work directory (resumable across runs), while their bundled data
    # files (genre_umbrella_map.json, theme_lexicons.json) still resolve locally.
    env = dict(os.environ)
    env["SPOTIFY_DASH_ROOT"] = out
    env["SPOTIFY_DASH_ENRICH_RAW"] = enrich_raw
    env["SPOTIFY_DASH_ENRICH_OUT"] = enrich_out
    env["SPOTIFY_DASH_SITE"] = out

    banner("Soundprint build")
    print(f"input   : {args.zip}")
    print(f"output  : {out}")
    print(f"enrich  : {'OFF (--skip-enrich)' if args.skip_enrich else 'ON'}")
    if args.years:
        print(f"years   : {args.years}")

    # ---- 1. unzip -----------------------------------------------------------
    banner("1/4  Unpacking export")
    src = args.zip
    if os.path.isdir(src):
        history_dir = find_history_dir(src)
    else:
        if os.path.isdir(work_data):
            shutil.rmtree(work_data)
        os.makedirs(work_data, exist_ok=True)
        with zipfile.ZipFile(src) as z:
            z.extractall(work_data)
        history_dir = find_history_dir(work_data)
    if not history_dir:
        print("ERROR: could not find any Streaming_History_*.json in the export.\n"
              "       Make sure you requested *Extended* Streaming History from Spotify\n"
              "       (Account -> Privacy -> 'Extended streaming history'), not the basic one.",
              file=sys.stderr)
        sys.exit(1)
    print(f"  history: {history_dir}")

    # ---- 2. build dataset ---------------------------------------------------
    banner("2/4  Building dataset")
    cmd = [PY, os.path.join(HERE, "pipeline", "build_dataset.py"),
           "--data-dir", history_dir, "--out-dir", out,
           "--docs-dir", docs_out, "--tz", args.tz]
    if args.years:
        cmd += ["--years", args.years]
    run(cmd, label="build_dataset.py")

    # ---- 3. enrichment ------------------------------------------------------
    if not args.skip_enrich:
        banner("3/4  Enriching (this can take minutes to hours; caches are resumable)")
        print("  Six public APIs are queried; every lookup is cached under\n"
              f"  {enrich_raw}/cache — safe to Ctrl-C and re-run to resume.\n")

        # id-space bridge (must match the dataset's interning exactly)
        idmap_cmd = [PY, os.path.join(HERE, "enrich", "idmap.py"),
                     "--data-dir", history_dir, "--dataset", dataset_json,
                     "--out", idmap_path, "--tz", args.tz]
        if args.years:
            idmap_cmd += ["--years", args.years]
        run(idmap_cmd, env=env, label="idmap.py")

        E = os.path.join(HERE, "enrich")
        steps = [
            (["run_wikidata.py"], "Wikidata — genres · origin · formation year (all artists)"),
            (["run_deezer.py"], "Deezer — coarse genre + popularity (all artists)"),
            (["run_musicbrainz.py"], "MusicBrainz — city-level origin (top artists)"),
            (["run_reccobeats.py"], "ReccoBeats — audio features (all tracks)"),
            (["run_itunes.py", "--top-n", str(args.top_itunes)], "iTunes — release years (throttled, slow)"),
            (["run_lrclib.py", "--top-n", str(args.top_lyrics)], "LRCLIB — lyric-derived stats (no raw text stored)"),
            (["run_release.py"], "Release years — merge iTunes/Deezer/ISRC"),
        ]
        failed = []
        for i, (script, desc) in enumerate(steps, 1):
            banner(f"  enrich {i}/{len(steps)}: {desc}")
            cmd = [PY, os.path.join(E, script[0]), "--idmap", idmap_path] + script[1:]
            try:
                run(cmd, env=env, label=script[0])
            except SystemExit:
                if not args.keep_going:
                    raise
                print(f"  (continuing despite failure in {script[0]} — --keep-going)", file=sys.stderr)
                failed.append(script[0])

        banner("  Merging enrichment")
        run([PY, os.path.join(E, "build_enrichment.py"),
             "--idmap", idmap_path, "--out", enrichment_json], env=env,
            label="build_enrichment.py")
        if failed:
            print(f"  NOTE: partial enrichment — these steps did not finish: {', '.join(failed)}")
    else:
        banner("3/4  Enrichment skipped (--skip-enrich)")
        # make sure a stale enrichment.json from a previous run isn't picked up
        for p in (enrichment_json, enrichment_json + ".gz"):
            if os.path.exists(p):
                os.remove(p)
        print("  Dashboard will build without genre / mood / lyrics pages.")

    # ---- 4. assemble single-file html --------------------------------------
    banner("4/4  Assembling soundprint.html")
    run([PY, os.path.join(HERE, "site", "build.py"),
         "--data-dir", out, "--out", final_html], label="site/build.py")

    size = os.path.getsize(final_html)
    banner("Done")
    print(f"Your dashboard: {final_html}")
    print(f"Size: {size / 1024 / 1024:.2f} MB — a single self-contained file.")
    print("Open it in any modern browser (Chrome, Edge, Firefox, Safari). It works")
    print("fully offline; no data ever leaves the file.")


if __name__ == "__main__":
    main()
