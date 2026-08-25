"""
Pulls current NFL injury status from Sleeper's free public player API and
writes data/live_status.json — a normalized-name -> {tag, note} map that
data/build.py layers UNDER the hand-curated NEWS block in sources.py (manual
entries always win; this only fills in players nobody has written a note
for). Meant to run on a schedule — see .github/workflows/refresh-news.yml —
not in a loop: Sleeper's /v1/players/nfl is a ~5MB dump of the entire league
and their docs ask that it not be polled more than a few times a day.

    python3 data/fetch_news.py
"""
import json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from names import norm

SLEEPER_URL = "https://api.sleeper.app/v1/players/nfl"
POSITIONS = {"QB", "RB", "WR", "TE", "K"}  # Sleeper has no per-player DST entity

# Sleeper's injury_status vocabulary -> our engine's tag vocabulary (see
# TUNE / RISK in src/template.html). Deliberately conservative: only map
# statuses with a clear equivalent, leave anything ambiguous untagged
# rather than guess at a discount that isn't backed by real signal.
STATUS_TAG = {
    "Questionable": "RISK",
    "Doubtful": "OUT",
    "Out": "OUT",
    "IR": "OUT",
    "PUP": "OUT",
    "NA": "OUT",
    "Sus": "OUT",
}


def note_for(status, body_part):
    known = body_part and body_part.strip().lower() not in ("", "undisclosed", "none", "not injury related")
    where = f" — {body_part}" if known else ""
    return f"{status}{where} (auto, via Sleeper)"


def main():
    req = urllib.request.Request(SLEEPER_URL, headers={"User-Agent": "draft-war-room/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = json.load(resp)

    if len(raw) < 3000:
        # Sleeper's live player dump normally runs 8000+ entries; a short
        # response means a bad or partial fetch, not a quiet injury week.
        raise SystemExit(f"Sleeper returned only {len(raw)} players — refusing to trust this response")

    out = {}
    for p in raw.values():
        pos = p.get("position")
        status = p.get("injury_status")
        name = p.get("full_name")
        if pos not in POSITIONS or not status or not name:
            continue
        tag = STATUS_TAG.get(status)
        if not tag:
            continue
        out[norm(name)] = {"tag": tag, "note": note_for(status, p.get("injury_body_part"))}

    # Sanity cap: a mapping bug would tag an implausible fraction of the
    # league. Real in-season injury slates run a few percent of players.
    if len(out) > 400:
        raise SystemExit(f"{len(out)} players tagged — implausibly high, refusing to write live_status.json")

    with open(os.path.join(HERE, "live_status.json"), "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print(f"wrote {len(out)} live statuses to data/live_status.json")


if __name__ == "__main__":
    main()
