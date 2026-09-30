#!/usr/bin/env python3
"""Merge drawn paper emblems (.cache/emb/out_<n>.json) into data/paper_emblems.json.

An emblem is one small picture of a paper's main idea, shown at the top of its card in the Taxonomy's
level-3 table. The drawing rules are in .cache/emb/SPEC.md. Emblems already in data/paper_emblems.json are
kept unless a batch redraws the same paper.

    python3 scripts/merge_emblems.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    path = ROOT / "data" / "paper_emblems.json"
    emblems = json.loads(path.read_text()) if path.exists() else {}
    added = 0
    for f in sorted((ROOT / ".cache" / "emb").glob("out_*.json")):
        for pid, em in json.loads(f.read_text()).items():
            added += pid not in emblems
            emblems[pid] = {"label": em["label"], "body": em["body"]}
    path.write_text(json.dumps(dict(sorted(emblems.items())), indent=1, ensure_ascii=False) + "\n")
    print(f"{len(emblems)} emblems ({added} new)", file=sys.stderr)


if __name__ == "__main__":
    main()
