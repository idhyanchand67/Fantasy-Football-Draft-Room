"""
Pulls current NFL player data from Sleeper's free public player API in a
single fetch and writes two files:

  data/live_status.json  normalized-name -> {tag, note}, layered UNDER the
                          hand-curated NEWS block in sources.py by build.py
                          (manual entries always win; this only fills gaps)
  data/photos.json       normalized-name -> Sleeper player_id, used to build
                          headshot URLs (sleepercdn.com/content/nfl/players/
                          {id}.jpg) — no manual equivalent, always used as-is

One fetch feeds both outputs on purpose: Sleeper's /v1/players/nfl is a
~5MB dump of the entire league and their docs ask that it not be polled
more than a few times a day, so there's no reason to hit it twice for two
different derived files. Meant to run on a schedule — see
.github/workflows/refresh-news.yml — not in a loop.

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

    tags = {}
    photos = {}
    for pid, p in raw.items():
        pos = p.get("position")
        name = p.get("full_name")
        if pos not in POSITIONS or not name:
            continue
        key = norm(name)

        # only currently-rostered players, to keep this scoped to who could
        # plausibly be in our draft pool and reduce stale-photo/name-collision risk
        if p.get("team"):
            photos[key] = pid

        status = p.get("injury_status")
        if not status:
            continue
        tag = STATUS_TAG.get(status)
        if not tag:
            continue
        tags[key] = {"tag": tag, "note": note_for(status, p.get("injury_body_part"))}

    # Sanity cap: a mapping bug would tag an implausible fraction of the
    # league. Real in-season injury slates run a few percent of players.
    if len(tags) > 400:
        raise SystemExit(f"{len(tags)} players tagged — implausibly high, refusing to write live_status.json")
    if len(photos) < 1000:
        raise SystemExit(f"only {len(photos)} rostered players found — refusing to trust this response")

    with open(os.path.join(HERE, "live_status.json"), "w") as f:
        json.dump(tags, f, indent=1, sort_keys=True)
    print(f"wrote {len(tags)} live statuses to data/live_status.json")

    with open(os.path.join(HERE, "photos.json"), "w") as f:
        json.dump(photos, f, separators=(",", ":"), sort_keys=True)
    print(f"wrote {len(photos)} player photo ids to data/photos.json")


if __name__ == "__main__":
    main()
