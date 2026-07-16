#!/usr/bin/env python3
"""
SOUNDPRINT build script.
Inlines CSS, base64 fonts, vendor libs (correct order), JS modules (correct order),
and the base64 gzip dataset into a single fully self-contained soundprint.html.
No external requests remain in the output.

Parameterized:
  --data-dir DIR   folder holding dataset.json.gz (+ optional enrichment.json.gz)
  --out FILE       output HTML path

Vendor libraries: the permissively-licensed libs (ECharts, CountUp, canvas-confetti)
and the SIL-OFL fonts are committed to the repo. The GSAP libs (gsap.min.js,
ScrollTrigger.min.js) are NOT redistributed here — GSAP's Standard "No Charge"
license reserves redistribution rights — so this script downloads them from cdnjs
(pinned, integrity-checked) on first run into vendor/. See VENDOR_LICENSES.md.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
VENDOR = os.path.join(HERE, "vendor")
FONTS = os.path.join(VENDOR, "fonts")
# set from argv in main(); sensible defaults for standalone use in this folder
OUT = os.path.join(HERE, "soundprint.html")
DATASET_GZ = os.path.join(HERE, "dataset.json.gz")
ENRICH_GZ = os.path.join(HERE, "enrichment.json.gz")

# JS load order (dependency order): core -> charts -> sections/* -> app
VENDOR_ORDER = [
    "echarts.min.js",
    "gsap.min.js",
    "ScrollTrigger.min.js",
    "countUp.umd.min.js",
    "confetti.min.js",
]

# Vendor files fetched on first build (not committed, for licensing reasons).
# Pinned to exact cdnjs versions; sha256 verified so a fetched file is provably
# the known-good artifact this dashboard was built against.
VENDOR_FETCH = {
    "gsap.min.js": (
        "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/gsap.min.js",
        "711b6bca2497f7b1ce6728d60796cd9e20f6adbb3b9b12b8af64de984e65628b",
    ),
    "ScrollTrigger.min.js": (
        "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/ScrollTrigger.min.js",
        "6878e5dc3693e75d58ff504d2dae2811e76ceae30e812f21e96c3d0d6948a809",
    ),
}


def ensure_vendor(name):
    """Return path to a vendor file, downloading it on first run if it is one of
    the fetch-on-build libraries (GSAP). Committed libs must already be present.
    Downloaded content is sha256-verified against the pinned GSAP 3.15.0 build."""
    path = os.path.join(VENDOR, name)
    if os.path.exists(path):
        return path
    if name in VENDOR_FETCH:
        url, want = VENDOR_FETCH[name]
        print(f"  vendor: fetching {name} from cdnjs (first run)…")
        os.makedirs(VENDOR, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "soundprint-build"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        got = hashlib.sha256(data).hexdigest()
        if want and got != want:
            raise SystemExit(
                f"ERROR: {name} sha256 mismatch\n  expected {want}\n  got      {got}\n"
                f"       Refusing to use an unexpected build. Check the pinned version."
            )
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        print(f"          saved {name} ({len(data)/1024:.0f} KB, sha256 ok)")
        return path
    raise SystemExit(
        f"ERROR: vendor file '{name}' is missing and is not a fetch-on-build lib.\n"
        f"       Restore it from the repository (site/vendor/{name})."
    )


def read(path, mode="r"):
    with open(path, mode) as f:
        return f.read()


def build_fonts_css():
    """Emit @font-face rules with base64 woff2. Variable fonts are deduped by
    content hash and declared once per family with a font-weight range."""
    manifest = json.load(open(os.path.join(FONTS, "manifest.json")))
    by_family = {}
    for m in manifest:
        by_family.setdefault(m["family"], []).append(m)

    rules = []
    total = 0
    for family, entries in by_family.items():
        weights = sorted(int(e["weight"]) for e in entries)
        # group by file content hash (variable fonts share one file)
        buckets = {}
        for e in entries:
            data = read(os.path.join(FONTS, e["file"]), "rb")
            hsh = hashlib.md5(data).hexdigest()
            buckets.setdefault(hsh, {"data": data, "weights": []})
            buckets[hsh]["weights"].append(int(e["weight"]))
        for b in buckets.values():
            total += len(b["data"])
            b64 = base64.b64encode(b["data"]).decode("ascii")
            ws = sorted(b["weights"])
            wrange = f"{ws[0]} {ws[-1]}" if ws[0] != ws[-1] else str(ws[0])
            rules.append(
                "@font-face{font-family:'%s';font-style:normal;font-weight:%s;"
                "font-display:swap;src:url(data:font/woff2;base64,%s) format('woff2');}"
                % (family, wrange, b64)
            )
    print(f"  fonts: {len(rules)} @font-face rule(s), {total/1024:.1f} KB raw woff2")
    return "<style id=\"fonts\">\n" + "\n".join(rules) + "\n</style>"


def build_styles():
    css = read(os.path.join(SRC, "styles.css"))
    return "<style>\n" + css + "\n</style>"


def build_vendor():
    parts = []
    for name in VENDOR_ORDER:
        path = ensure_vendor(name)
        js = read(path)
        if name == "confetti.min.js":
            # cdnjs ships the CommonJS build (attaches to module.exports). Give it a
            # real module object in a private scope, then expose window.confetti.
            js = ("(function(){var module={exports:{}};\n" + js +
                  "\nwindow.confetti=module.exports;})();")
        parts.append(f"<!-- vendor:{name} -->\n<script>{js}\n</script>")
        print(f"  vendor: {name} ({len(js)/1024:.0f} KB)")
    return "\n".join(parts)


def build_js():
    order = ["core.js", "charts.js"]
    sec_dir = os.path.join(SRC, "sections")
    for fn in sorted(os.listdir(sec_dir)):
        if fn.endswith(".js"):
            order.append(os.path.join("sections", fn))
    order.append("app.js")
    parts = []
    for rel in order:
        js = read(os.path.join(SRC, rel))
        parts.append(f"<!-- app:{rel} -->\n<script>{js}\n</script>")
        print(f"  js: {rel} ({len(js)/1024:.1f} KB)")
    return "\n".join(parts)


def build_data():
    gz = read(DATASET_GZ, "rb")
    b64 = base64.b64encode(gz).decode("ascii")
    print(f"  data: dataset.json.gz {len(gz)/1024/1024:.2f} MB -> base64 {len(b64)/1024/1024:.2f} MB")
    out = f'<script id="dataset" type="application/gzip-base64">{b64}</script>'
    if os.path.exists(ENRICH_GZ):
        egz = read(ENRICH_GZ, "rb")
        eb64 = base64.b64encode(egz).decode("ascii")
        print(f"  data: enrichment.json.gz {len(egz)/1024:.0f} KB -> base64 {len(eb64)/1024:.0f} KB")
        out += f'\n<script id="enrichment" type="application/gzip-base64">{eb64}</script>'
    else:
        print("  data: enrichment.json.gz not found — building without enrichment")
    return out


def main():
    global OUT, DATASET_GZ, ENRICH_GZ
    ap = argparse.ArgumentParser(description="Inline everything into a single self-contained soundprint.html")
    ap.add_argument("--data-dir", default=HERE,
                    help="folder holding dataset.json.gz (+ optional enrichment.json.gz)")
    ap.add_argument("--out", default=OUT, help="output HTML file path")
    args = ap.parse_args()
    DATASET_GZ = os.path.join(args.data_dir, "dataset.json.gz")
    ENRICH_GZ = os.path.join(args.data_dir, "enrichment.json.gz")
    OUT = args.out

    if not os.path.exists(DATASET_GZ):
        raise SystemExit(f"ERROR: {DATASET_GZ} not found — run build_dataset.py first.")
    out_parent = os.path.dirname(os.path.abspath(OUT))
    os.makedirs(out_parent, exist_ok=True)

    print("Building soundprint.html ...")
    html = read(os.path.join(SRC, "index.html"))

    replacements = {
        "<!-- INLINE:fonts -->": build_fonts_css(),
        "<!-- INLINE:styles -->": build_styles(),
        "<!-- INLINE:vendor -->": build_vendor(),
        "<!-- INLINE:js -->": build_js(),
        "<!-- INLINE:data -->": build_data(),
    }
    for marker, content in replacements.items():
        if marker not in html:
            print(f"  WARNING: marker {marker} not found in index.html", file=sys.stderr)
        html = html.replace(marker, content)

    # sanity: assert no external network refs remain
    leaks = re.findall(r'(?:src|href)\s*=\s*["\']https?://[^"\']+', html)
    leaks = [l for l in leaks if "www.w3.org" not in l]  # svg xmlns is fine
    if leaks:
        print("  WARNING: external references remain:", file=sys.stderr)
        for l in leaks[:10]:
            print("   ", l, file=sys.stderr)

    with open(OUT, "w") as f:
        f.write(html)
    size = os.path.getsize(OUT)
    print(f"Done -> {OUT}")
    print(f"Total size: {size/1024/1024:.2f} MB ({size:,} bytes)")


if __name__ == "__main__":
    main()
