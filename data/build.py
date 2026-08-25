"""
Merges the raw scraped sources in sources.py into data/players.json:
consensus ADP, projections, bye weeks, camp news, positional tiers.

    python3 data/build.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sources import ADP_A, ADP_B, PROJ, BYES, SCHEDULE, NEWS
from names import norm


def rows(block, n):
    out = []
    for line in block.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        f = [x.strip() for x in line.split("|")]
        if len(f) != n:
            raise SystemExit(f"bad row ({len(f)} fields, want {n}): {line}")
        out.append(f)
    return out


byes = {t: int(w) for t, w in rows(BYES, 2)}

# ---- weekly schedule (team -> 18 opponents, "@" prefix = away, or "BYE") --
schedule = {row[0]: row[1:] for row in rows(SCHEDULE, 19)}
for team, wk in schedule.items():
    bye_weeks = [i + 1 for i, w in enumerate(wk) if w == "BYE"]
    assert bye_weeks == [byes[team]], f"{team} schedule bye ({bye_weeks}) doesn't match BYES ({byes[team]})"

# ---- ADP consensus -------------------------------------------------------
players = {}


def touch(key, name, pos, team):
    if key not in players:
        players[key] = {"name": name, "pos": pos, "team": team, "ranks": []}
    p = players[key]
    # prefer a real team over FA placeholders, and prefer a longer display name
    if team not in ("FA", "Free Agent", ""):
        p["team"] = team
    if len(name) > len(p["name"]):
        p["name"] = name
    return p


for rank, name, pos, team in rows(ADP_A, 4):
    touch(norm(name), name, pos, team)["ranks"].append(int(rank))
for rank, name, pos, team in rows(ADP_B, 4):
    touch(norm(name), name, pos, team)["ranks"].append(int(rank))

for p in players.values():
    p["adp"] = round(sum(p["ranks"]) / len(p["ranks"]), 1)
    p["sources"] = len(p["ranks"])
    del p["ranks"]

# ---- projections ---------------------------------------------------------
projmap = {}
for name, pos, team, pts in rows(PROJ, 4):
    projmap[norm(name)] = (float(pts), pos, team, name)

for key, (pts, pos, team, name) in projmap.items():
    if key in players:
        players[key]["proj"] = pts
    else:
        # projected but undrafted in both ADP lists -> deep sleeper / waiver pool
        players[key] = {
            "name": name,
            "pos": pos,
            "team": team,
            "adp": None,
            "sources": 0,
            "proj": pts,
        }

# ---- fill missing projections -------------------------------------------
DST_TOP = 132.0
for p in players.values():
    if p["pos"] == "DST" and "proj" not in p:
        p["proj"] = None  # assigned below by DST rank

dsts = sorted([p for p in players.values() if p["pos"] == "DST"], key=lambda x: x["adp"] or 999)
for i, p in enumerate(dsts):
    p["proj"] = round(DST_TOP - 2.6 * i, 1)


def interp(pos):
    known = sorted(
        [p for p in players.values() if p["pos"] == pos and p.get("proj") and p["adp"]],
        key=lambda x: x["adp"],
    )
    if len(known) < 2:
        return
    missing = [p for p in players.values() if p["pos"] == pos and not p.get("proj") and p["adp"]]
    for m in missing:
        lo = [k for k in known if k["adp"] <= m["adp"]]
        hi = [k for k in known if k["adp"] > m["adp"]]
        if lo and hi:
            a, b = lo[-1], hi[0]
            span = b["adp"] - a["adp"]
            f = 0 if span == 0 else (m["adp"] - a["adp"]) / span
            m["proj"] = round(a["proj"] + f * (b["proj"] - a["proj"]), 1)
        elif lo:
            tail = known[-2:]
            slope = (tail[1]["proj"] - tail[0]["proj"]) / max(1e-6, tail[1]["adp"] - tail[0]["adp"])
            m["proj"] = round(max(35.0, tail[1]["proj"] + slope * (m["adp"] - tail[1]["adp"])), 1)
        else:
            m["proj"] = known[0]["proj"]


for pos in ["QB", "RB", "WR", "TE", "K", "DST"]:
    interp(pos)

players = {k: v for k, v in players.items() if v.get("proj")}

# ---- byes, news ----------------------------------------------------------
newsmap = {}
for name, tag, note in rows(NEWS, 3):
    newsmap[norm(name)] = {"tag": tag, "note": note}

for key, p in players.items():
    p["bye"] = byes.get(p["team"])
    n = newsmap.get(key)
    if n:
        p["tag"] = n["tag"]
        p["note"] = n["note"]

unmatched = [k for k in newsmap if k not in players]
if unmatched:
    print("NEWS rows not matched to a player:", unmatched)

# ---- live status (optional, auto-refreshed by data/fetch_news.py) --------
# Hand-curated NEWS entries above always win — they're verified prose with
# real nuance. Live status only fills in players nobody has written a note
# for, so a bot run can never silently overwrite a human's judgment call.
live_path = os.path.join(HERE, "live_status.json")
if os.path.exists(live_path):
    with open(live_path) as f:
        live = json.load(f)
    filled = 0
    for key, p in players.items():
        if not p.get("tag") and key in live:
            p["tag"] = live[key]["tag"]
            p["note"] = live[key]["note"]
            filled += 1
    print(f"live status filled {filled} players not covered by manual news")

# ---- photos (optional, auto-refreshed by data/fetch_news.py) -------------
photos_path = os.path.join(HERE, "photos.json")
if os.path.exists(photos_path):
    with open(photos_path) as f:
        photos = json.load(f)
    matched = 0
    for key, p in players.items():
        if key in photos:
            p["photo"] = photos[key]
            matched += 1
    print(f"photos matched for {matched} of {len(players)} players")

# ---- positional rank + tiers --------------------------------------------
# Gap-splitting collapses on smooth curves (it put 27 of 36 QBs in one tier), so
# cluster instead. 1-D k-means on sorted values yields contiguous, balanced tiers.
def kmeans1d(vals, k, iters=100):
    n = len(vals)
    cents = [vals[min(n - 1, int((i + 0.5) * n / k))] for i in range(k)]
    for _ in range(iters):
        groups = [[] for _ in range(k)]
        for v in vals:
            j = min(range(k), key=lambda j: abs(v - cents[j]))
            groups[j].append(v)
        new = [sum(g) / len(g) if g else cents[i] for i, g in enumerate(groups)]
        if all(abs(a - b) < 1e-9 for a, b in zip(cents, new)):
            break
        cents = new
    return cents


# how deep each position stays draft-relevant, and how many tiers to carve there
WINDOW = {"RB": 60, "WR": 72, "TE": 30, "QB": 30, "K": 20, "DST": 16}
TIERS = {"RB": 9, "WR": 9, "TE": 7, "QB": 7, "K": 3, "DST": 3}


def tier_up(pos):
    grp = sorted([p for p in players.values() if p["pos"] == pos], key=lambda x: -x["proj"])
    for i, p in enumerate(grp):
        p["posRank"] = i + 1
    head, tail = grp[: WINDOW[pos]], grp[WINDOW[pos] :]
    k = min(TIERS[pos], len(head))
    if k < 2:
        for p in grp:
            p["tier"] = 1
        return
    cents = kmeans1d([p["proj"] for p in head], k)
    order = sorted(range(k), key=lambda j: -cents[j])
    rank = {j: i + 1 for i, j in enumerate(order)}
    for p in head:
        j = min(range(k), key=lambda j: abs(p["proj"] - cents[j]))
        p["tier"] = rank[j]
    for p in tail:
        p["tier"] = k + 1


for pos in ["QB", "RB", "WR", "TE", "K", "DST"]:
    tier_up(pos)

# tiers must come out contiguous down the ranking, or the labels lie
for pos in ["QB", "RB", "WR", "TE"]:
    seq = [p["tier"] for p in sorted(players.values(), key=lambda x: -x["proj"]) if p["pos"] == pos]
    assert all(b >= a for a, b in zip(seq, seq[1:])), f"{pos} tiers are not monotonic: {seq}"

# ---- emit ----------------------------------------------------------------
out = []
undrafted_adp = 260
for key, p in sorted(players.items(), key=lambda kv: (kv[1]["adp"] is None, kv[1]["adp"] or 999)):
    rec = {
        "id": key.replace(" ", "-"),
        "n": p["name"],
        "p": p["pos"],
        "t": p["team"],
        "adp": p["adp"] if p["adp"] else undrafted_adp,
        "listed": bool(p["adp"]),
        "proj": round(p["proj"], 1),
        "bye": p["bye"],
        "pr": p["posRank"],
        "tier": p["tier"],
    }
    if p.get("tag"):
        rec["tag"] = p["tag"]
        rec["note"] = p["note"]
    if p.get("photo"):
        rec["photo"] = p["photo"]
    out.append(rec)

with open(os.path.join(HERE, "players.json"), "w") as f:
    json.dump(out, f, separators=(",", ":"))

with open(os.path.join(HERE, "schedule.json"), "w") as f:
    json.dump(schedule, f, separators=(",", ":"), sort_keys=True)

from collections import Counter

print("total players:", len(out))
print("by pos:", dict(Counter(r["p"] for r in out)))
print("with news:", sum(1 for r in out if r.get("tag")))
print("missing bye:", [r["n"] for r in out if not r["bye"]][:10])
print("wrote", os.path.join(HERE, "players.json"))
print("wrote", os.path.join(HERE, "schedule.json"), f"({len(schedule)} teams)")
