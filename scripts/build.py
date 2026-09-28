"""Validate data/ and merge it into site/atlas.json.

    python3 scripts/build.py          # validate + write site/atlas.json
    python3 scripts/build.py --check  # validate only; exit 1 on errors

Errors (exit 1): invalid JSON, missing required fields, tag values outside the controlled
vocabularies, result rows pointing at unknown benchmarks.
Warnings (printed): result rows for systems that have no system file and are not in
data/extra_systems.json, and settings left null.
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

VOCAB = {
    "fidelity": {"verbatim", "verbatim+derived", "rewritten", "extracted", "compressed", "mixed"},
    "structure": {"none", "flat", "linked-notes", "graph", "tree", "tiered", "typed-stores", "profile", "parametric"},
    "write_time": {"none", "filter", "segment", "summarize", "extract", "link", "consolidate", "agent-chosen", "learned"},
    "selection": {"none", "full-context", "dense", "lexical", "hybrid", "rerank", "graph-expansion", "llm-tool-call", "model-reads", "planner"},
    "memory_type": {"episodic", "semantic", "procedural", "working", "profile"},
    "learning": {"training-free", "sft", "rl", "mixed"},
    "domain": {"conversation", "long-document", "web", "gui", "embodied", "code", "multimodal", "general"},
}
STAGES = ["ingestion", "construction", "organization", "update", "retrieval", "answer", "learning"]
DESIGN = {
    "construction": ["unit", "kept_as", "processing", "trigger", "writer"],
    "organization": ["structure", "stores", "index"],
    "management": ["operations", "conflicts", "forgetting", "timing"],
    "retrieval": ["query", "candidates", "selection", "budget"],
    "use": ["context", "reasoning"],
    "control": ["construction", "management", "retrieval"],
}
CONTROL = {"none", "fixed-rule", "prompted-llm", "agent-tool-calls", "learned-rl", "learned-sft", "feedback-optimized"}
DESIGN_VOCAB = {
    ("construction", "trigger"): {"every-turn", "every-exchange", "session-end", "buffer-full", "agent-decides", "offline-batch", "other"},
    ("management", "timing"): {"online", "offline", "both", "none"},
    ("control", "construction"): CONTROL, ("control", "management"): CONTROL, ("control", "retrieval"): CONTROL,
}
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".svg")
METRICS = {"llm-judge", "f1", "bleu-1", "em", "mc-acc", "rouge-l", "recall@k", "other"}
RUN_BY = {"self", "rerun", "copied", None}
# Fields that must match (and be known) for two rows to be directly comparable.
SETTING_FIELDS = ["benchmark", "benchmark_version", "subset", "category", "metric", "answer_model", "judge", "judge_prompt"]
JUDGE_ONLY = {"judge", "judge_prompt"}
TABLE_REF = re.compile(r"Table\s*(\d+)", re.I)


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"{where}: {msg}")


def load(path, rep):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        rep.err(path.relative_to(ROOT), f"cannot parse ({e})")
        return None


def check_system(s, where, rep):
    for f in ("id", "name", "design", "tags", "stages"):
        if f not in s:
            rep.err(where, f"missing '{f}'")
    if where.stem != s.get("id"):
        rep.err(where, f"file name must equal id '{s.get('id')}'")
    design = s.get("design", {})
    for g in design:
        if g not in DESIGN:
            rep.err(where, f"unknown design group '{g}'")
    for g, fields in DESIGN.items():
        grp = design.get(g) or {}
        for f in grp:
            if f not in fields:
                rep.err(where, f"unknown field design.{g}.{f}")
        for f in fields:
            if f not in grp:
                rep.warn(where, f"design.{g}.{f} missing (use null when the paper does not say)")
            v = grp.get(f)
            allowed = DESIGN_VOCAB.get((g, f))
            if allowed and v is not None and v not in allowed:
                rep.err(where, f"design.{g}.{f}: '{v}' not in {sorted(allowed)}")
    for k, v in s.get("tags", {}).items():
        if k not in VOCAB:
            rep.err(where, f"unknown tag '{k}'")
            continue
        for x in v if isinstance(v, list) else [v]:
            if x not in VOCAB[k]:
                rep.err(where, f"tags.{k}: '{x}' not in {sorted(VOCAB[k])}")
    for st in s.get("stages", {}):
        if st not in STAGES:
            rep.err(where, f"unknown stage '{st}'")


def setting_key(r):
    fields = [f for f in SETTING_FIELDS if r.get("metric") == "llm-judge" or f not in JUDGE_ONLY]
    return "|".join(f"{f}={r.get(f)}" for f in fields), [f for f in fields if r.get(f) in (None, "")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    rep = Report()

    benchmarks = load(DATA / "benchmarks.json", rep) or []
    bench_ids = {b["id"] for b in benchmarks}
    extra = load(DATA / "extra_systems.json", rep) or []
    papers_doc = load(DATA / "papers.json", rep) or {"papers": [], "sources": {}}

    systems = []
    for p in sorted((DATA / "systems").glob("*.json")):
        s = load(p, rep)
        if s:
            check_system(s, p.relative_to(ROOT), rep)
            systems.append(s)
    # One figure per system, captured by hand: site/figures/<system-id>.<png|jpg|webp|svg>
    for s in systems:
        fig = next((f for f in sorted((ROOT / "site" / "figures").glob(f"{s['id']}.*")) if f.suffix.lower() in IMG_EXT), None)
        if fig:
            s["figure"] = f"figures/{fig.name}"
    sys_ids = {s["id"] for s in systems}
    extra_ids = {e["id"] for e in extra}
    dup = sys_ids & extra_ids
    if dup:
        rep.warn("data/extra_systems.json", f"ids also have system files: {sorted(dup)}")

    tables_path = DATA / "table_images.json"
    table_imgs = (load(tables_path, rep) if tables_path.exists() else {}) or {}
    # Hand-captured images count too: site/tables/<reporter-id>/table-<n>.<png|jpg|webp|svg>.
    # A file on disk wins over the manifest; the manifest only adds the page number.
    for img in sorted((ROOT / "site" / "tables").glob("*/table-*")):
        m = re.fullmatch(r"table-(\d+)", img.stem)
        if m and img.suffix.lower() in IMG_EXT:
            entry = table_imgs.setdefault(img.parent.name, {}).setdefault(m.group(1), {})
            entry["img"] = f"tables/{img.parent.name}/{img.name}"

    reporters, rows = [], []
    for p in sorted((DATA / "results").glob("*.json")):
        doc = load(p, rep)
        if not doc:
            continue
        where = p.relative_to(ROOT)
        rid = doc.get("reporter", {}).get("id")
        if rid != p.stem:
            rep.err(where, f"reporter.id must equal file name ('{rid}')")
        arxiv = rid.rsplit("-", 1)[-1] if rid else None
        reporters.append({**doc["reporter"], "arxiv": arxiv if re.fullmatch(r"\d{4}\.\d{4,5}", arxiv or "") else None})
        for i, r in enumerate(doc.get("rows", [])):
            w = f"{where}#{i}"
            for f in ("system", "benchmark", "metric", "score"):
                if r.get(f) is None:
                    rep.err(w, f"missing '{f}'")
            if r.get("benchmark") not in bench_ids:
                rep.err(w, f"unknown benchmark '{r.get('benchmark')}'")
            if r.get("metric") not in METRICS:
                rep.err(w, f"metric '{r.get('metric')}' not in {sorted(METRICS)}")
            if r.get("run_by") not in RUN_BY:
                rep.err(w, f"run_by '{r.get('run_by')}' invalid")
            if r.get("system") not in sys_ids | extra_ids:
                rep.warn(w, f"system '{r.get('system')}' has no system file or extra_systems entry")
            if not isinstance(r.get("score"), (int, float)):
                rep.err(w, "score must be a number")
            key, unknown = setting_key(r)
            source = {}
            m = TABLE_REF.search(r.get("location") or "")
            if m:
                source["table_no"] = int(m.group(1))
                shot = table_imgs.get(rid, {}).get(m.group(1))
                if shot:
                    source["table_img"] = shot["img"]
                    if shot.get("page"):
                        source["table_page"] = shot["page"]
            rows.append({**r, **source, "reporter": rid, "setting_key": key, "unknown_settings": unknown})

    annotated = {s["paper"]["arxiv"]: s["id"] for s in systems if s.get("paper") and s["paper"].get("arxiv")}
    for p in papers_doc["papers"]:
        if p.get("arxiv") in annotated:
            p["system"] = annotated[p["arxiv"]]

    n_unknown = sum(1 for r in rows if r["unknown_settings"])
    for w in rep.warnings:
        print("warning:", w, file=sys.stderr)
    for e in rep.errors:
        print("ERROR:", e, file=sys.stderr)
    print(f"{len(systems)} systems, {len(extra)} extra systems, {len(reporters)} reporters, "
          f"{len(rows)} result rows ({n_unknown} with unknown settings), {len(papers_doc['papers'])} papers; "
          f"{len(rep.errors)} errors, {len(rep.warnings)} warnings", file=sys.stderr)
    if rep.errors:
        sys.exit(1)
    if args.check:
        return

    atlas = {
        "vocab": {k: sorted(v) for k, v in VOCAB.items()},
        "stages": STAGES,
        "setting_fields": SETTING_FIELDS,
        "benchmarks": benchmarks,
        "systems": systems,
        "extra_systems": extra,
        "reporters": reporters,
        "results": rows,
        "sources": papers_doc["sources"],
        "papers": papers_doc["papers"],
    }
    (ROOT / "site" / "atlas.json").write_text(json.dumps(atlas, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
