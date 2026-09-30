#!/usr/bin/env python3
"""Turn the stored papers into what an LLM reads best, and keep the annotators' findings next to them.

For every .cache/papers/<id>/ (filled by scripts/collect_papers.py):
    paper.md   the paper text with "## Page N" headings (pdftotext keeps one form feed per page), so an answer
               can cite the page it comes from
    notes.md   the final report of each annotation agent that worked on this paper: venue check, how the
               figures were drawn, paper-vs-code differences, what could not be found. Taken from the agents'
               transcripts (the folders given on the command line), matched by the data/systems/<id>.json path
               the report names.
The structured record stays in data/systems/<id>.json and data/results/<id>-*.json; meta.json points to them.

    python3 scripts/save_paper_notes.py <agent transcript folder> [...]
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / ".cache" / "papers"
# ids changed after the report was written
RENAMED = {"contextual-experience-replay-c": "cer"}


def reports(folders):
    """(report text, transcript file) for every SubagentHandback in the transcripts."""
    for folder in folders:
        for f in sorted(list(Path(folder).glob("*.output")) + list(Path(folder).glob("*.jsonl"))):
            try:
                lines = f.read_text().splitlines()
            except Exception:
                continue
            for line in lines:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                c = (d.get("message") or {}).get("content")
                if not isinstance(c, list):
                    continue
                for x in c:
                    if x.get("type") == "tool_use" and x.get("name") == "SubagentHandback":
                        yield x["input"].get("message", ""), f.name


def main(folders):
    notes = {}
    for text, src in reports(folders):
        for sid in sorted(set(re.findall(r"data/systems/([a-z0-9._-]+)\.json", text))):
            notes.setdefault(RENAMED.get(sid, sid), []).append((src, text))
    for d in sorted(p for p in PAPERS.iterdir() if p.is_dir()):
        txt = d / "paper.txt"
        if txt.exists():
            pages = txt.read_text().split("\f")
            meta = json.loads((d / "meta.json").read_text()) if (d / "meta.json").exists() else {}
            head = f"# {meta.get('title') or d.name}\n\narXiv {meta.get('arxiv') or '—'} · text extracted with pdftotext from {meta.get('from', 'paper.pdf')}\n"
            body = "\n".join(f"\n## Page {i}\n\n{p.strip()}\n" for i, p in enumerate(pages, 1) if p.strip())
            (d / "paper.md").write_text(head + body)
        if d.name in notes:
            parts = [f"# Annotation notes: {d.name}\n",
                     "Final reports of the agents that read this paper (and its code) to write data/systems/"
                     f"{d.name}.json. A report may cover two papers; the other one's part is kept as written.\n"]
            parts += [f"\n---\n\n_Source: agent transcript {src}_\n\n{t.strip()}\n" for src, t in notes[d.name]]
            (d / "notes.md").write_text("".join(parts))
        if (d / "meta.json").exists():
            meta = json.loads((d / "meta.json").read_text())
            meta["record"] = f"data/systems/{d.name}.json" if (ROOT / "data" / "systems" / f"{d.name}.json").exists() else None
            meta["results"] = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "data" / "results").glob(f"{d.name}-*.json"))
            meta["has_notes"] = (d / "notes.md").exists()
            (d / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n")
    have = [p.name for p in PAPERS.iterdir() if (p / "notes.md").exists()]
    print(f"{sum(1 for p in PAPERS.iterdir() if (p / 'paper.md').exists())} papers as paper.md; notes for {len(have)}", file=sys.stderr)
    systems = {p.stem for p in (ROOT / "data" / "systems").glob("*.json")}
    print("records without notes:", ", ".join(sorted(systems - set(have))), file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1:])
