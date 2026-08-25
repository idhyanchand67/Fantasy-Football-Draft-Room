"""
Shared name normalization for matching players across ADP, projection,
news, and live-status sources despite differing name formatting
(suffixes, punctuation, known aliases).
"""
import re

SUFFIX = {"jr", "sr", "ii", "iii", "iv", "v"}
ALIAS = {"hollywood brown": "marquise brown", "kenny gainwell": "kenneth gainwell"}


def norm(name):
    s = name.lower().replace(".", "").replace("'", "").replace("-", " ")
    s = re.sub(r"[^a-z ]", " ", s)
    parts = [p for p in s.split() if p and p not in SUFFIX]
    s = " ".join(parts)
    return ALIAS.get(s, s)
