#!/usr/bin/env python3
"""Merge classification batches into data/paper_families.json.

Pass 1: each batch in .cache/fam/out_<n>.json places papers of the index in one family of data/taxonomy.json,
made from the paper's abstract (or the list's description, or its title) by scripts/fetch_abstracts.py.
Pass 2 (.cache/fam2/reclass_out_<n>.json) moves papers after the taxonomy gained families (security,
out-of-scope, theory); pass 3 (.cache/fam2/learn_out_<n>.json) adds how each method learns; pass 4
(.cache/fam3/out_<n>.json) gives every family two axes of its own (written into data/taxonomy.json) and
places each paper on them ("x", "y") with a line on what makes it unique.
Entries already in data/paper_families.json with "checked": true are kept as they are, so hand
corrections survive a re-run.

    python3 scripts/merge_families.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDS = ["family", "also", "function", "name", "what", "confidence", "basis", "fit"]
LEARN = ["learning", "learning_also", "learns_what", "learning_confidence"]
ZOOM = ["x", "y", "unique"]


def main():
    tax = json.loads((ROOT / "data" / "taxonomy.json").read_text())
    fams = {f["id"] for g in tax["groups"] for f in g["families"]}
    order = [p["id"] for p in json.loads((ROOT / "data" / "papers.json").read_text())["papers"]]
    out_path = ROOT / "data" / "paper_families.json"
    old = json.loads(out_path.read_text()) if out_path.exists() else {}

    basis = {}
    new = {}
    for f in sorted((ROOT / ".cache" / "fam").glob("batch_*.json")):
        for x in json.loads(f.read_text()):
            basis[x["id"]] = x["basis"]
    for f in sorted((ROOT / ".cache" / "fam").glob("out_*.json")):
        for x in json.loads(f.read_text()):
            if x.get("family") not in fams:
                print(f"{f.name}: {x.get('id')}: unknown family '{x.get('family')}', skipped", file=sys.stderr)
                continue
            x["also"] = [a for a in x.get("also", []) if a in fams and a != x["family"]]
            x["basis"] = basis.get(x["id"], "title only")
            new[x["id"]] = {k: x.get(k, "" if k in ("what", "fit") else []) for k in FIELDS}

    learn_ids = {x["id"] for x in tax.get("learning", [])}
    fam2 = ROOT / ".cache" / "fam2"
    for f in sorted(fam2.glob("reclass_out_*.json")):
        for x in json.loads(f.read_text()):
            if x["id"] in new and x.get("family") in fams:
                e = new[x["id"]]
                if e["family"] != x["family"]:
                    e["fit"] = ""  # the new family answers the old misfit note
                e["family"] = x["family"]
                e["also"] = [a for a in x.get("also", []) if a in fams and a != x["family"]]
    for f in sorted(fam2.glob("learn_out_*.json")):
        for x in json.loads(f.read_text()):
            if x["id"] in new and x.get("learning") in learn_ids:
                x["learning_also"] = [a for a in x.get("learning_also", []) if a in learn_ids and a != x["learning"]]
                new[x["id"]].update({k: x.get(k) for k in LEARN})

    fam_axes = {}
    for f in sorted((ROOT / ".cache" / "fam3").glob("out_*.json")):
        for fam in json.loads(f.read_text())["families"]:
            if fam["id"] not in fams:
                continue
            fam_axes[fam["id"]] = fam["axes"]
            for x in fam["papers"]:
                if x["id"] in new:
                    new[x["id"]].update({k: x.get(k) for k in ZOOM})
    if fam_axes:
        for g in tax["groups"]:
            for fam in g["families"]:
                if fam["id"] in fam_axes:
                    fam["axes"] = fam_axes[fam["id"]]
        (ROOT / "data" / "taxonomy.json").write_text(json.dumps(tax, indent=2, ensure_ascii=False) + "\n")

    merged = {}
    for pid in order:
        if old.get(pid, {}).get("checked"):
            merged[pid] = old[pid]
        elif pid in new:
            merged[pid] = new[pid]
        elif pid in old:
            merged[pid] = old[pid]
    out_path.write_text(json.dumps(merged, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(merged)} of {len(order)} papers placed", file=sys.stderr)


if __name__ == "__main__":
    main()
