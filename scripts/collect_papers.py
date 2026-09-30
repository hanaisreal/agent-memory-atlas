#!/usr/bin/env python3
"""Keep the paper text the annotation agents read, so later questions about a paper need no re-download.

Finds PDFs under the given folders (the agents' scratch folders), works out which annotated system (or, failing that,
which paper of the index) each one is (an arXiv id on its first pages, else its title), and stores it as
    .cache/papers/<system id>/paper.pdf   the PDF as read
    .cache/papers/<system id>/paper.txt   its text (pdftotext, reading order)
    .cache/papers/<system id>/meta.json   title, arXiv id, where the PDF came from
When several PDFs match one system (arXiv and proceedings versions), the one with the most text is kept and
the others are listed in meta.json. .cache/ is not committed: the papers stay on this machine.

    python3 scripts/collect_papers.py <folder> [<folder> ...]
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".cache" / "papers"
SKIP = re.compile(r"(_code|code|-code|legacy|letta|site-packages|node_modules)(/|$)")


def text_of(pdf, first=None):
    args = ["pdftotext", "-q"] + (["-l", str(first)] if first else []) + [str(pdf), "-"]
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=120).stdout
    except Exception:
        return ""


def norm(t):
    return re.sub(r"[^a-z0-9]", "", (t or "").lower())


def main(folders):
    systems = [json.loads(p.read_text()) for p in sorted((ROOT / "data" / "systems").glob("*.json"))]
    by_arxiv = {s["paper"]["arxiv"]: s for s in systems if (s.get("paper") or {}).get("arxiv")}
    titles = [(norm(s["paper"]["title"])[:60], s) for s in systems if (s.get("paper") or {}).get("title")]
    # papers of the index without a system record yet are kept too, under their index id
    for q in json.loads((ROOT / "data" / "papers.json").read_text())["papers"]:
        entry = {"id": re.sub(r"[^A-Za-z0-9._-]", "_", q["id"]), "paper": {"title": q["title"], "arxiv": q.get("arxiv"), "venue": None}}
        if q.get("arxiv") and q["arxiv"] not in by_arxiv:
            by_arxiv[q["arxiv"]] = entry
        titles.append((norm(q["title"])[:60], entry))
    known = {s["id"]: s for s in systems}
    found = {}
    pdfs = [p for f in folders for p in Path(f).rglob("*.pdf") if not SKIP.search(str(p.relative_to(f)))]
    unmatched = []
    for pdf in pdfs:
        head = text_of(pdf, 2)
        s = None
        for m in re.finditer(r"(\d{4}\.\d{4,5})(v\d+)?", head):
            if m.group(1) in by_arxiv:
                s = by_arxiv[m.group(1)]
                break
        if not s:
            h = norm(head[:3000])
            s = next((sys_ for t, sys_ in titles if len(t) >= 20 and t in h), None)
        if not s:
            unmatched.append(str(pdf))
            continue
        full = text_of(pdf)
        found.setdefault(s["id"], []).append((len(full), pdf, full))
        known.setdefault(s["id"], s)
    for sid, cands in sorted(found.items()):
        cands.sort(key=lambda c: -c[0])
        _, pdf, full = cands[0]
        d = OUT / sid
        d.mkdir(parents=True, exist_ok=True)
        shutil.copy2(pdf, d / "paper.pdf")
        (d / "paper.txt").write_text(full)
        s = known[sid]
        (d / "meta.json").write_text(json.dumps({
            "system": sid if (ROOT / "data" / "systems" / f"{sid}.json").exists() else None, "title": s["paper"].get("title"), "arxiv": s["paper"].get("arxiv"),
            "venue": s["paper"].get("venue"), "from": str(pdf), "chars": len(full),
            "other_copies": [str(c[1]) for c in cands[1:]],
        }, indent=1, ensure_ascii=False) + "\n")
    missing = sorted(s["id"] for s in systems if s["id"] not in found and not (OUT / s["id"] / "paper.txt").exists())
    print(f"{len(found)} papers stored in {OUT.relative_to(ROOT)}; {len(unmatched)} PDFs not matched to a system", file=sys.stderr)
    if missing:
        print(f"systems with no PDF found: {', '.join(missing)}", file=sys.stderr)
    for u in unmatched:
        print(f"  unmatched: {u}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1:] or [str(ROOT / ".cache")])
