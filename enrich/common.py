#!/usr/bin/env python3
"""
Shared utilities for the Spotify dashboard enrichment pipeline.

Everything here is parameterized / reusable: no user-specific values live in
logic. Any user's Extended Streaming History -> enriched dashboard.

Provides:
  * a resumable, on-disk response cache (enrich_raw/cache/<source>/<sha1>.json)
    so interrupted runs resume and reruns are incremental. Only *successful*
    lookups (including legitimate "not found") are cached; transient errors are
    never cached, so they are retried on the next run.
  * HTTP GET helpers that trust the agent-proxy CA bundle (SSL_CERT_FILE is set
    in the environment) and back off on 429/5xx.
  * name / track-title normalization implementing every quirk documented in
    docs/ENRICHMENT_RESEARCH.md section 3.
"""
import os, sys, json, time, hashlib, urllib.parse, urllib.request, urllib.error, re, unicodedata

# ---------------------------------------------------------------- paths
# Location-independent. ENRICH_DIR always resolves to *this* directory (where the
# bundled data files genre_umbrella_map.json / theme_lexicons.json live), so those
# lookups are correct no matter where the tree lives. The work directories default
# to siblings of the repo root but are overridable via env vars, which the
# soundprint.py orchestrator points at a per-build workspace.
ENRICH_DIR = os.path.dirname(os.path.abspath(__file__))          # repo/enrich (code + data)
ROOT       = os.environ.get("SPOTIFY_DASH_ROOT", os.path.dirname(ENRICH_DIR))
ENRICH_RAW = os.environ.get("SPOTIFY_DASH_ENRICH_RAW", os.path.join(ROOT, "enrich_raw"))
CACHE_DIR  = os.path.join(ENRICH_RAW, "cache")
SITE_DIR   = os.environ.get("SPOTIFY_DASH_SITE", os.path.join(ROOT, "site"))
ENRICH_OUT = os.environ.get("SPOTIFY_DASH_ENRICH_OUT", os.path.join(ROOT, "enrich_out"))

UA = "SpotifyDashEnrich/1.0 (https://github.com/SeanSalvador2/a-better-spotify-dashboard)"

# ---------------------------------------------------------------- cache
def _cache_path(source, key):
    d = os.path.join(CACHE_DIR, source)
    os.makedirs(d, exist_ok=True)
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return os.path.join(d, h + ".json")

def cache_get(source, key):
    """Return cached value for key, or None if not cached."""
    p = _cache_path(source, key)
    if os.path.exists(p):
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)["v"]
        except Exception:
            return None
    return None

def cache_put(source, key, value):
    """Persist a *successful* lookup result (may be a 'not found' sentinel)."""
    p = _cache_path(source, key)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"k": key, "v": value}, f, ensure_ascii=False)
    os.replace(tmp, p)

def cache_has(source, key):
    return os.path.exists(_cache_path(source, key))

# ---------------------------------------------------------------- HTTP
class HTTPError(Exception):
    def __init__(self, code, msg=""):
        super().__init__(f"HTTP {code} {msg}")
        self.code = code

def http_get(url, headers=None, timeout=40, retries=4, backoff=2.0,
             retry_on=(429, 500, 502, 503, 504)):
    """GET with retry/backoff on throttle + transient 5xx. Returns raw bytes.
    Raises HTTPError on non-retryable HTTP errors; raises after exhausting retries."""
    h = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        h.update(headers)
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in retry_on and attempt < retries:
                time.sleep(backoff * (2 ** attempt))
                continue
            raise HTTPError(e.code, str(e)[:80])
        except Exception as e:  # URLError, timeout, connection reset, etc
            last = e
            if attempt < retries:
                time.sleep(backoff * (2 ** attempt))
                continue
            raise
    raise last

def http_get_json(url, headers=None, timeout=40, retries=4, backoff=2.0):
    return json.loads(http_get(url, headers, timeout, retries, backoff).decode("utf-8"))

def q(s):
    return urllib.parse.quote(str(s))

# ---------------------------------------------------------------- normalization
_LEET = {}
def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))

def norm_name(name):
    """Normalize an artist name for fuzzy same-name matching / comparison.
    Handles: unicode/non-ASCII hyphens (U+2010 etc), accents, '&'/'and',
    leading 'The', punctuation, casing, whitespace."""
    if not name:
        return ""
    s = unicodedata.normalize("NFKC", name)
    # normalize all dash variants to ascii hyphen
    s = re.sub(r"[‐‑‒–—―−]", "-", s)
    s = strip_accents(s).lower().strip()
    s = s.replace("&", " and ")
    s = re.sub(r"^the\s+", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

_FEAT = re.compile(r"\s*[\(\[]\s*(feat|ft|with)\b[^)\]]*[\)\]]", re.I)
_SUFFIX = re.compile(
    r"\s*-\s*(acoustic|live|remaster(ed)?( \d{4})?|radio edit|single version|"
    r"album version|mono|stereo|demo|edit|bonus track|deluxe|explicit|clean)"
    r"([^-]*)?$", re.I)

def clean_track_title(name):
    """Strip (feat...), (with...), '- Acoustic/Live/Remaster/Radio Edit' etc for
    name-keyed track lookups (iTunes/LRCLIB/Deezer)."""
    if not name:
        return ""
    n = _FEAT.sub("", name)
    n = re.sub(r"\s*\((feat|ft|with)\b[^)]*\)", "", n, flags=re.I)
    prev = None
    while prev != n:
        prev = n
        n = _SUFFIX.sub("", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n or name

# ---------------------------------------------------------------- IO helpers
def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def dump_json(path, obj, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":") if indent is None else None,
                  indent=indent)
    os.replace(tmp, path)

def log(*a):
    print(*a, flush=True)

def eprint(*a):
    print(*a, file=sys.stderr, flush=True)

# ---------------------------------------------------------------- worklists
def load_idmap(path=None):
    return load_json(path or os.path.join(ENRICH_RAW, "idmap.json"))

def track_worklist(idmap):
    """Canonical per-track worklist aligned to dataset.json track indices.
    Returns list of dicts sorted by listening ms desc: {idx,id,name,artist,album,ms,plays}."""
    uri_by_idx = {v: k for k, v in idmap["trackIndexByUri"].items()}
    artists = idmap["artists"]; tArt = idmap["trackArtistIdx"]
    tName = idmap["trackName"]; tAlbum = idmap.get("trackAlbum"); albumName = idmap.get("albumName")
    tMs = idmap["trackMs"]; tPlays = idmap["trackPlays"]
    out = []
    for idx in range(1, idmap["n_tracks"]):  # skip 0 = Unknown sentinel
        out.append({
            "idx": idx,
            "id": uri_by_idx.get(idx),
            "name": tName[idx],
            "artist": artists[tArt[idx]],
            "artistIdx": tArt[idx],
            "album": albumName[tAlbum[idx]] if tAlbum and albumName else None,
            "ms": tMs[idx],
            "plays": tPlays[idx],
        })
    out.sort(key=lambda t: -t["ms"])
    return out

def artist_worklist(idmap):
    """Canonical per-artist worklist. Sorted by ms desc: {idx,name,ms,plays}."""
    artists = idmap["artists"]; aMs = idmap["artistMs"]; aPlays = idmap["artistPlays"]
    out = []
    for idx in range(1, idmap["n_artists"]):  # skip 0 = Unknown sentinel
        out.append({"idx": idx, "name": artists[idx], "ms": aMs[idx], "plays": aPlays[idx]})
    out.sort(key=lambda a: -a["ms"])
    return out
