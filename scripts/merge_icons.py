#!/usr/bin/env python3
"""Merge drawn axis diagrams (.cache/icons/out_<x>.json) into data/axis_icons.json.

Each diagram replaces the written definition of one axis value in the Taxonomy's level-3 table headers.
The drawing rules are in .cache/icons/SPEC.md (shapes are the gi-* classes in site/style.css). Diagrams
already in data/axis_icons.json are kept unless a batch redraws the same key.

    python3 scripts/merge_icons.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    path = ROOT / "data" / "axis_icons.json"
    icons = json.loads(path.read_text()) if path.exists() else {}
    added = 0
    for f in sorted((ROOT / ".cache" / "icons").glob("out_*.json")):
        for key, ic in json.loads(f.read_text()).items():
            added += key not in icons
            icons[key] = {"label": ic["label"], "body": ic["body"]}
    path.write_text(json.dumps(dict(sorted(icons.items())), indent=1, ensure_ascii=False) + "\n")
    print(f"{len(icons)} diagrams ({added} new)", file=sys.stderr)


if __name__ == "__main__":
    main()
