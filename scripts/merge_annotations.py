#!/usr/bin/env python3
"""Merge the benchmarks and baseline systems that annotation agents defined in side files
(.cache/annot/new_benchmarks_<sys>.json, .cache/annot/new_extra_<sys>.json) into data/benchmarks.json and
data/extra_systems.json. An id already present is kept (a benchmark gains only the version labels it lacks);
when two side files define the same benchmark, their "versions" and "pitfalls" are combined.

    python3 scripts/merge_annotations.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIDE = ROOT / ".cache" / "annot"


def merge(target, pattern):
    path = ROOT / "data" / target
    items = json.loads(path.read_text())
    by_id = {x["id"]: x for x in items}
    new = set()
    has_record = {f.stem for f in (ROOT / "data" / "systems").glob("*.json")} if target == "extra_systems.json" else set()
    items[:] = [x for x in items if x["id"] not in has_record]  # a baseline with its own system file is no longer an extra
    by_id = {x["id"]: x for x in items}
    for f in sorted(SIDE.glob(pattern)):
        for x in json.loads(f.read_text()):
            if x["id"] in has_record:
                continue
            old = by_id.get(x["id"])
            if old is None:
                by_id[x["id"]] = x
                items.append(x)
                new.add(x["id"])
            elif x["id"] in new:  # defined by two agents in this run: combine what each saw
                old.setdefault("versions", {}).update(x.get("versions") or {})
                old["pitfalls"] = old.get("pitfalls", []) + [p for p in x.get("pitfalls", []) if p not in old.get("pitfalls", [])]
            else:  # already known: add version labels it lacks, never change the ones it has
                add = {k: v for k, v in (x.get("versions") or {}).items() if k not in (old.get("versions") or {})}
                if add:
                    old.setdefault("versions", {}).update(add)
                    print(f"  {x['id']}: new versions {', '.join(add)}", file=sys.stderr)
    path.write_text(json.dumps(items, indent=1, ensure_ascii=False) + "\n")
    print(f"{target}: {len(new)} new ({', '.join(sorted(new)) or 'none'})", file=sys.stderr)


if __name__ == "__main__":
    merge("benchmarks.json", "new_benchmarks_*.json")
    merge("extra_systems.json", "new_extra_*.json")
