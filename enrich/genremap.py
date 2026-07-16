#!/usr/bin/env python3
"""Subgenre-label -> umbrella rollup, driven by the standalone data file
enrich/genre_umbrella_map.json. Reusable by build + reports."""
import os, re, json

_MAP = None
def _load(path=None):
    global _MAP
    if _MAP is None:
        p = path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "genre_umbrella_map.json")
        with open(p, encoding="utf-8") as f:
            _MAP = json.load(f)
    return _MAP

def norm_label(s):
    s = s.lower().strip()
    s = re.sub(r"[‐‑‒–—―−]", "-", s)
    s = re.sub(r"\s+", " ", s)
    return s

def umbrella_of(label, path=None):
    """Return the umbrella for one raw subgenre label (or 'other')."""
    m = _load(path)
    n = norm_label(label)
    if n in m["exact"]:
        return m["exact"][n]
    for kw, umb in m["keywords"]:
        if kw in n:
            return umb
    return "other"

def umbrellas(path=None):
    return _load(path)["umbrellas"]

def primary_umbrella(labels, deezer_genre=None, path=None):
    """Pick a primary umbrella from a list of subgenre labels (+ optional Deezer
    coarse genre). Majority vote; tie broken by first label order then Deezer."""
    votes = {}
    order = []
    for lab in labels:
        u = umbrella_of(lab, path)
        if u not in votes:
            order.append(u)
        votes[u] = votes.get(u, 0) + 1
    if deezer_genre:
        u = umbrella_of(deezer_genre, path)
        if u not in votes:
            order.append(u)
        votes[u] = votes.get(u, 0) + 0.5  # tie-break weight only
    if not votes:
        return None
    best = max(order, key=lambda u: (votes[u], -order.index(u)))
    return best
