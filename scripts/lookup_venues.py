#!/usr/bin/env python3
"""Look up where papers of the index were published, for papers whose venue nobody has checked.

Asks OpenAlex (by exact title match) and, when OpenAlex finds nothing, Semantic Scholar (by arXiv id),
slowly: one OpenAlex request a second and one Semantic Scholar request every few seconds, backing off when
told to. Repositories (arXiv, Zenodo, SSRN...) do not count as a venue. Results go to
data/venues_lookup.json, marked with their source; build.py shows them as "<venue> · OpenAlex" so they stay
apart from venues checked against the paper. Resumable: papers already looked up are skipped.

    python3 scripts/lookup_venues.py            # needs network; about one paper a second
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "venues_lookup.json"
UA = {"User-Agent": "agent-memory-atlas/0.1 (venue lookup)"}
REPOSITORIES = re.compile(r"arxiv|zenodo|ssrn|research square|preprints\.org|techrxiv|biorxiv|medrxiv|openreview|papers with code|hal |repository|figshare|github", re.I)
# common venues, long name -> short tag
SHORT = [
    (r"neural information processing systems|neurips", "NeurIPS"), (r"international conference on learning representations|\biclr\b", "ICLR"),
    (r"international conference on machine learning|\bicml\b", "ICML"), (r"findings of the association for computational linguistics", "Findings"),
    (r"annual meeting of the association for computational linguistics|\bacl\b", "ACL"), (r"empirical methods in natural language processing|\bemnlp\b", "EMNLP"),
    (r"north american chapter|\bnaacl\b", "NAACL"), (r"\bcoling\b|computational linguistics \(coling\)", "COLING"),
    (r"aaai conference on artificial intelligence|\baaai\b", "AAAI"), (r"international joint conference on artificial intelligence|\bijcai\b", "IJCAI"),
    (r"knowledge discovery and data mining|\bkdd\b", "KDD"), (r"the web conference|world wide web|\bwww\b", "WWW"),
    (r"information and knowledge management|\bcikm\b", "CIKM"), (r"research and development in information retrieval|\bsigir\b", "SIGIR"),
    (r"computer vision and pattern recognition|\bcvpr\b", "CVPR"), (r"international conference on computer vision|\biccv\b", "ICCV"),
    (r"european conference on computer vision|\beccv\b", "ECCV"), (r"transactions of the association for computational linguistics", "TACL"),
    (r"transactions on machine learning research", "TMLR"), (r"conference on language modeling|\bcolm\b", "COLM"),
    (r"user interface software and technology|\buist\b", "UIST"), (r"human factors in computing systems|\bchi\b", "CHI"),
]


def get(url, tries=4, wait=5):
    for i in range(tries):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < tries - 1:
                time.sleep(wait * (2 ** i) * 6)  # told to slow down: wait 30 s, 60 s, 120 s
                continue
            if e.code == 404:
                return None
            raise
        except Exception:
            if i < tries - 1:
                time.sleep(wait)
                continue
            raise


def norm(t):
    return re.sub(r"[^a-z0-9]", "", (t or "").lower())


def short(name):
    for pat, tag in SHORT:
        if re.search(pat, name, re.I):
            return tag
    return name if len(name) <= 28 else name[:26] + "…"


def track_of(name, kind):
    low = name.lower()
    if "findings" in low:
        return "findings"
    if "workshop" in low:
        return "workshop"
    if kind == "journal" and not re.search(r"proceedings|conference", low):
        return "journal"
    return "main"


def openalex(title):
    q = urllib.parse.quote(title[:250])
    d = get(f"https://api.openalex.org/works?search={q}&per-page=5")
    for w in (d or {}).get("results", []):
        if norm(w.get("title")) != norm(title):
            continue
        for loc in w.get("locations", []):
            src = loc.get("source") or {}
            name = src.get("display_name") or ""
            if name and not REPOSITORIES.search(name):
                return {"name": name, "kind": src.get("type"), "year": w.get("publication_year"), "url": w.get("id")}
    return None


def semantic_scholar(arxiv):
    d = get(f"https://api.semanticscholar.org/graph/v1/paper/arXiv:{arxiv}?fields=venue,year,publicationVenue,url", wait=6)
    if not d:
        return None
    pv = d.get("publicationVenue") or {}
    name = pv.get("name") or d.get("venue") or ""
    if name and not REPOSITORIES.search(name):
        return {"name": name, "kind": pv.get("type"), "year": d.get("year"), "url": d.get("url")}
    return None


def main():
    papers = json.loads((ROOT / "data" / "papers.json").read_text())["papers"]
    fams = json.loads((ROOT / "data" / "paper_families.json").read_text())
    hidden = {f["id"] for g in json.loads((ROOT / "data" / "taxonomy.json").read_text())["groups"] for f in g["families"] if f.get("hidden")}
    checked = {s["paper"]["arxiv"] for s in (json.loads(f.read_text()) for f in (ROOT / "data" / "systems").glob("*.json")) if (s.get("paper") or {}).get("arxiv")}
    todo = [p for p in papers if fams.get(p["id"], {}).get("family") not in hidden and p.get("arxiv") not in checked and p["kind"] not in ("product", "tutorial", "article", "workshop")]
    out = json.loads(OUT.read_text()) if OUT.exists() else {}
    done = found = 0
    for p in todo:
        if p["id"] in out:
            continue
        hit, source = None, None
        try:
            hit = openalex(p["title"]); source = "OpenAlex"
            time.sleep(1)
            if not hit and p.get("arxiv"):
                hit = semantic_scholar(p["arxiv"]); source = "Semantic Scholar"
                time.sleep(6)
        except Exception as e:
            print(f"  {p['id']}: {e}", file=sys.stderr)
            continue  # left out so a later run tries again
        out[p["id"]] = ({"venue": short(hit["name"]), "venue_full": hit["name"], "year": hit["year"],
                         "track": track_of(hit["name"], hit["kind"]), "source": source, "url": hit["url"]} if hit else None)
        done += 1; found += bool(hit)
        if done % 20 == 0:
            OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
            print(f"{done} looked up, {found} with a venue", file=sys.stderr)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"done: {len(out)} papers, {sum(1 for v in out.values() if v)} with a venue", file=sys.stderr)


if __name__ == "__main__":
    main()
