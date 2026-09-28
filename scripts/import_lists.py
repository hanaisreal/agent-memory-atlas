"""Import the upstream agent-memory paper lists into data/papers.json.

Each upstream list organises papers along its own axis. We keep every one of those axes as a
separate facet instead of forcing them into one taxonomy:

  liu     Shichun-Liu/Agent-Memory-Paper-List   function (factual / experiential / working) x form
                                                 (token-level / parametric / latent)
  teleai  TeleAI-UAGI/Awesome-Agent-Memory       kind (product / survey / benchmark / paper) x
                                                 substrate (text / graph / multimodal / parametric ...)
  deep    DEEP-PolyU/Awesome-GraphMemory         pipeline stage (extraction / storage / retrieval /
                                                 evolution) for graph memory
  yyy     yyyujintang/Awesome-Agent-Memory-Papers tags: storage, learning, memory type, benchmark type

Lists are fetched at pinned commits so the import is reproducible; bump SOURCES to update.

    python3 scripts/import_lists.py            # fetch + write data/papers.json
    python3 scripts/import_lists.py --cache D  # read/write raw READMEs in directory D
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SOURCES = {
    "liu": {
        "repo": "Shichun-Liu/Agent-Memory-Paper-List",
        "sha": "4b451283144ef66150273b51e7702de79a9239f3",
        "start": r"^## .*Paper list", "stop": r"^## .*Citation",
    },
    "teleai": {
        "repo": "TeleAI-UAGI/Awesome-Agent-Memory",
        "sha": "0bea78ce3be552f34f64a3ff09a6224ad70ec216",
        "start": r"^## .*Products", "stop": r"^## .*Citation",
    },
    "deep": {
        "repo": "DEEP-PolyU/Awesome-GraphMemory",
        "sha": "ed4864888de0059654f228bf435201601365295f",
        "start": r"^## .*Related Survey", "stop": r"^## .*Citation",
    },
    "yyy": {
        "repo": "yyyujintang/Awesome-Agent-Memory-Papers",
        "sha": "e2fb9cac9ee0cafc7ad9158e66d76c2ae4332a64",
        "start": r"^## Surveys", "stop": r"^## Tag Legend",
    },
}

ITEM = re.compile(r"^(\s*)(?:[-*]|\d+\.)\s+(.*)$")
HEADING = re.compile(r"^(#{1,4})\s+(.*)$")
LINK = re.compile(r"\[([^\[\]]+)\]\((https?://[^)\s]+)\)")
BRACKET_LINK = re.compile(r"\[\[([^\]]+)\]\]\((https?://[^)\s]+)\)|\[\[([^\]]+)\]\((https?://[^)\s]+)\)\]")
ARXIV = re.compile(r"(?:arxiv\.org/(?:abs|pdf|html)/|arXiv\.)(\d{4}\.\d{4,5})", re.I)
YEAR_HEADING = re.compile(r"(19|20)\d{2}")


def fetch(key, cache):
    src = SOURCES[key]
    if cache:
        p = Path(cache) / f"{key}.md"
        if p.exists():
            return p.read_bytes().decode()
    url = f"https://raw.githubusercontent.com/{src['repo']}/{src['sha']}/README.md"
    text = urllib.request.urlopen(url, timeout=60).read().decode()
    if cache:
        Path(cache).mkdir(parents=True, exist_ok=True)
        (Path(cache) / f"{key}.md").write_text(text)
    return text


def clean_heading(h):
    h = re.sub(r"[^\w\s&/().,+-]", "", h)  # drop emoji
    return re.sub(r"\s+", " ", h).strip()


def entries(text, start, stop):
    """Yield (heading_path, item_line, continuation_lines) for each list item between start and stop."""
    lines = text.replace("\r\n", "\n").replace("\r", " ").split("\n")
    active, path, cur = False, [], None
    for line in lines:
        if re.match(start, line):
            active = True
        if active and re.match(stop, line):
            break
        if not active:
            continue
        h = HEADING.match(line)
        if h:
            if cur:
                yield cur
                cur = None
            level = len(h.group(1))
            path = path[: max(level - 2, 0)] + [clean_heading(h.group(2))]
            continue
        m = ITEM.match(line)
        if m and "](#" not in line:
            if cur:
                yield cur
            cur = (list(path), m.group(2), [])
        elif cur and line.strip():
            cur[2].append(line.strip())
        elif cur and not line.strip():
            yield cur
            cur = None
    if cur:
        yield cur


def parse_title(item, key):
    s = item.strip()
    s = re.sub(r"^\[\d{4}/\d{2}\]\s*", "", s)             # liu: [2026/01]
    s = re.sub(r"^\([^)]*\)\s*", "", s)                    # deep: (arXiv'25)
    s = re.sub(r"^\[[^\]]*\]\s+(?=\*\*)", "", s)         # deep: [ACL'25] **Title**
    m = re.match(r"^\[!\[[^\]]*\]\([^)]*\)\]\((https?://[^)]+)\)\s*([^:]+)", s)  # deep: [![badge](..)](url) Name: desc
    if m:
        return m.group(2).strip(), m.group(1)
    m = re.match(r"^\*\*\[([^\]]+)\]\(([^)]+)\)\*\*", s)   # **[Title](url)**
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"^\[([^\]]+)\]\((https?://[^)]+)\)", s)  # [Title](url)
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"^\*\*([^*]+)\*\*", s)                   # **Title**
    if m:
        return m.group(1), None
    # liu: Title. [[paper](url)]
    t = re.split(r"\s*\[\[", s)[0].rstrip(". ")
    return (t or s), None


def all_links(text):
    out = []
    for m in BRACKET_LINK.finditer(text):
        label = m.group(1) or m.group(3)
        url = m.group(2) or m.group(4)
        out.append((label.strip().lower(), url))
    for m in LINK.finditer(text):
        out.append((m.group(1).strip().lower(), m.group(2)))
    return out


def norm_title(t):
    return re.sub(r"[^a-z0-9]", "", t.lower())


def kind_for(key, path):
    p = " ".join(path).lower()
    if "survey" in p:
        return "survey"
    if "benchmark" in p:
        return "benchmark"
    if "product" in p or "open-source project" in p or "opensource" in p:
        return "product"
    if "tutorial" in p:
        return "tutorial"
    if "article" in p:
        return "article"
    if "workshop" in p:
        return "workshop"
    return "method"


def facets_for(key, path, tags):
    """Map an upstream section path to named facets, keeping the upstream vocabulary."""
    path = [p for p in path if not YEAR_HEADING.fullmatch(p.strip())]
    f = {}
    if key == "liu":
        # path: ["Paper list", "Factual Memory", "Token-level"]
        if len(path) > 1:
            f["liu_function"] = path[1].replace(" Memory", "")
        if len(path) > 2:
            f["liu_form"] = path[2]
    elif key == "teleai":
        top = path[0] if path else ""
        top = re.sub(r"^Papers - ", "", top)
        f["teleai_section"] = top
        if len(path) > 1:
            f["teleai_subsection"] = path[1]
    elif key == "deep":
        stage = next((p for p in path if p.startswith("Memory ")), None)
        if stage:
            f["deep_stage"] = stage.replace("Memory ", "")
        if path and path[-1] != stage and path[-1] not in ("Benchmarks", "Open-source Project"):
            f["deep_data"] = path[-1]
    elif key == "yyy":
        if len(path) > 1:
            f["yyy_section"] = path[1]
        if tags:
            f["yyy_tags"] = tags
    return f


def parse_source(key, text):
    src = SOURCES[key]
    for path, item, cont in entries(text, src["start"], src["stop"]):
        title, url = parse_title(item, key)
        if not title or len(title) < 4:
            continue
        blob = " ".join([item] + cont)
        links = all_links(blob)
        code = next((u for l, u in links if "code" in l or "github" in l), None)
        code = code or next((u for _, u in links if "github.com" in u and u != url), None)
        paper = next((u for l, u in links if l in ("paper", "arxiv", "pdf")), None)
        url = url or paper or (links[0][1] if links else None)
        arx = None
        for u in [url or ""] + [u for _, u in links]:
            m = ARXIV.search(u)
            if m:
                arx = m.group(1)
                break
        date = None
        m = re.match(r"^\[(\d{4})/(\d{2})\]", item.strip())
        if m:
            date = f"{m.group(1)}-{m.group(2)}"
        m = re.search(r"\*(\d{4}-\d{2})-\d{2}\*", blob)
        if m:
            date = m.group(1)
        year = next((int(p[-4:]) for p in path if re.search(r"\b20\d{2}$", p)), None)
        if not date and arx:
            date = f"20{arx[:2]}-{arx[2:4]}"
        if not date and year:
            date = str(year)
        desc = next((c.strip("_") for c in cont if c.startswith("_") and c.endswith("_")), None)
        tags = re.findall(r"`([^`]+)`", blob) if key == "yyy" else []
        yield {
            "title": re.sub(r"\s+", " ", title).strip(),
            "url": url,
            "arxiv": arx,
            "code": code,
            "date": date,
            "kind": kind_for(key, path),
            "description": desc,
            "source": key,
            "section": " / ".join(p for p in path if not YEAR_HEADING.fullmatch(p.strip())),
            "facets": facets_for(key, path, tags),
        }


def merge(records):
    by_key = {}
    order = []
    for r in records:
        k = ("arxiv", r["arxiv"]) if r["arxiv"] else ("title", norm_title(r["title"]))
        if k not in by_key:
            by_key[k] = {
                "id": r["arxiv"] or norm_title(r["title"])[:60],
                "title": r["title"], "url": r["url"], "arxiv": r["arxiv"],
                "code": r["code"], "date": r["date"], "kind": r["kind"],
                "description": r["description"], "sources": [], "facets": {},
            }
            order.append(k)
        m = by_key[k]
        for field in ("url", "code", "date", "description"):
            if not m[field] and r[field]:
                m[field] = r[field]
        # products and benchmarks outrank "method" when lists disagree
        if m["kind"] == "method" and r["kind"] != "method":
            m["kind"] = r["kind"]
        src = {"list": r["source"], "section": r["section"]}
        if src not in m["sources"]:
            m["sources"].append(src)
        for fk, fv in r["facets"].items():
            vals = fv if isinstance(fv, list) else [fv]
            cur = m["facets"].setdefault(fk, [])
            for v in vals:
                if v not in cur:
                    cur.append(v)
    return [by_key[k] for k in order]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()
    records, counts = [], {}
    for key in SOURCES:
        rs = list(parse_source(key, fetch(key, args.cache)))
        counts[key] = len(rs)
        records.extend(rs)
    papers = merge(records)
    papers.sort(key=lambda p: (p["date"] or "0000"), reverse=True)
    out = {
        "sources": {k: {"repo": v["repo"], "sha": v["sha"], "entries": counts[k]} for k, v in SOURCES.items()},
        "papers": papers,
    }
    (ROOT / "data" / "papers.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"entries per list: {counts}; unique papers: {len(papers)}", file=sys.stderr)


if __name__ == "__main__":
    main()
