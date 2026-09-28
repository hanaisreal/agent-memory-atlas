#!/usr/bin/env python3
"""Fetch abstracts for the paper index, as the source text for classifying papers on the Taxonomy axes.

Abstracts are cached locally and not committed (they are the papers' text, not ours); what is committed
is the classification in data/paper_axes.json, which cites the kind of source it was made from.

    python3 scripts/fetch_abstracts.py --out .cache/abstracts.json   # needs network; resumable

Sources, in order: arXiv API (by arXiv id), ACL Anthology page, OpenReview API. Papers with none of these
keep the list's own description when it has one, else only the title.
"""

import argparse
import html
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "agent-memory-atlas/0.1 (abstract fetch for classification)"}
ATOM = "{http://www.w3.org/2005/Atom}"


def get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")


def clean(t):
    return re.sub(r"\s+", " ", html.unescape(t or "")).strip()


def arxiv_batch(ids):
    q = "https://export.arxiv.org/api/query?max_results=200&id_list=" + ",".join(ids)
    root = ET.fromstring(get(q))
    out = {}
    for e in root.iter(ATOM + "entry"):
        m = re.search(r"abs/(\d{4}\.\d{4,5})", e.findtext(ATOM + "id") or "")
        if m:
            out[m.group(1)] = clean(e.findtext(ATOM + "summary"))
    return out


def acl(url):
    m = re.search(r'acl-abstract[^>]*>\s*(?:<h5[^>]*>.*?</h5>)?\s*<span>(.*?)</span>', get(url), re.S)
    return clean(re.sub(r"<[^>]+>", "", m.group(1))) if m else None


def openreview(url):
    m = re.search(r"id=([\w-]+)", url)
    if not m:
        return None
    d = json.loads(get(f"https://api2.openreview.net/notes?id={m.group(1)}"))
    notes = d.get("notes") or []
    if not notes:
        return None
    a = notes[0].get("content", {}).get("abstract")
    return clean(a.get("value") if isinstance(a, dict) else a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / ".cache" / "abstracts.json"))
    ap.add_argument("--kinds", default="method,product")
    args = ap.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cache = json.loads(out.read_text()) if out.exists() else {}
    kinds = set(args.kinds.split(","))
    papers = [p for p in json.loads((ROOT / "data" / "papers.json").read_text())["papers"] if p["kind"] in kinds]

    todo = [p["arxiv"] for p in papers if p["arxiv"] and p["id"] not in cache]
    for i in range(0, len(todo), 100):
        got = arxiv_batch(todo[i:i + 100])
        for p in papers:
            if p["arxiv"] in got:
                cache[p["id"]] = {"basis": "abstract", "text": got[p["arxiv"]]}
        print(f"arXiv {min(i + 100, len(todo))}/{len(todo)}", file=sys.stderr)
        out.write_text(json.dumps(cache, ensure_ascii=False, indent=0))
        time.sleep(3)  # arXiv API asks for one request every 3 seconds

    for p in papers:
        if p["id"] in cache:
            continue
        url, text = p.get("url") or "", None
        try:
            if "aclanthology.org" in url:
                text = acl(url)
            elif "openreview.net" in url:
                text = openreview(url)
        except Exception as e:  # a dead link just falls back to the description or title
            print(f"  {p['id']}: {e}", file=sys.stderr)
        if text:
            cache[p["id"]] = {"basis": "abstract", "text": text}
            time.sleep(1)
        elif p.get("description"):
            cache[p["id"]] = {"basis": "list description", "text": p["description"]}
        else:
            cache[p["id"]] = {"basis": "title only", "text": ""}
    out.write_text(json.dumps(cache, ensure_ascii=False, indent=0))
    n = {}
    for v in cache.values():
        n[v["basis"]] = n.get(v["basis"], 0) + 1
    print(f"{len(cache)} papers: {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
