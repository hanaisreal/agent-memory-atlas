#!/usr/bin/env python3
"""Find where papers were accepted from arXiv's own records: the author comment ("Accepted to ACL 2025
Findings", "NeurIPS 2024 camera-ready") and the journal reference. No key needed; the arXiv API is asked for
100 papers at a time with a few seconds between requests.

A comment only counts when it says the paper was accepted or published (accepted, to appear, camera-ready,
published, or a venue with its year and no "submitted" / "under review" / "rejected"). Results go to
data/venues_lookup.json with source "arXiv comment", next to anything scripts/lookup_venues.py found;
build.py shows them as "<venue> · arXiv comment" so they stay apart from venues checked against the paper.

    python3 scripts/venues_from_arxiv.py
"""

import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lookup_venues import SHORT  # noqa: E402  long venue name -> short tag

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "venues_lookup.json"
NS = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}
# venues memory papers go to that SHORT does not already name
MORE = [(r"\bacm mm\b|acm multimedia", "ACM MM"), (r"\becai\b", "ECAI"), (r"\bicra\b", "ICRA"), (r"\biros\b", "IROS"),
        (r"\bcorl\b", "CoRL"), (r"\brss\b|robotics: science and systems", "RSS"), (r"\beacl\b", "EACL"), (r"\baacl\b", "AACL"),
        (r"\bwsdm\b", "WSDM"), (r"\brecsys\b", "RecSys"), (r"\bicde\b", "ICDE"), (r"\bvldb\b", "VLDB"), (r"\bsigmod\b", "SIGMOD"),
        (r"\bmlsys\b", "MLSys"), (r"\bosdi\b", "OSDI"), (r"\bsosp\b", "SOSP"), (r"\bcogsci\b", "CogSci"), (r"\bconll\b", "CoNLL"),
        (r"\bneurips\b|\bnips\b", "NeurIPS"), (r"\baamas\b", "AAMAS"), (r"\bijcnlp\b", "IJCNLP"), (r"\bsigdial\b", "SIGDIAL"),
        (r"\bnature\b", "Nature"), (r"\btpami\b", "TPAMI"), (r"\btkde\b", "TKDE"), (r"\bjmlr\b", "JMLR"), (r"\btois\b", "TOIS")]
ACCEPTED = re.compile(r"accepted|to appear|camera[- ]ready|published|proceedings of|oral|spotlight|poster|main conference", re.I)
NOT_YET = re.compile(r"submitted|under review|in submission|preprint version|rejected|withdrawn", re.I)


def tag(text):
    # "Findings of the ACL: EMNLP 2025" is EMNLP's Findings: name the conference, the track says findings
    pats = [(p, t) for p, t in SHORT if t != "Findings"] if re.search(r"findings", text, re.I) else SHORT
    for pat, t in pats + MORE:
        if re.search(pat, text, re.I):
            return t
    return None


def track(text):
    low = text.lower()
    return ("findings" if "findings" in low else "workshop" if "workshop" in low
            else "workshop" if "late-breaking" in low
            else "journal" if re.search(r"\bjournal\b|transactions|\btpami\b|\btkde\b|\bjmlr\b|\btois\b|\bnature\b", low) else "main")


def year(text, fallback):
    m = re.search(r"(?<!\d)(20[12]\d)(?!\d)", text)
    if m:
        return int(m.group(1))
    m = re.search(r"['\u2019-]([12]\d)\b", text)  # AAAI-24, ICLR'24
    return 2000 + int(m.group(1)) if m else fallback


def venue_of(comment, jref, pub_year):
    """(venue, track, year, evidence) or None."""
    if jref and (t := tag(jref)):
        return t, track(jref), year(jref, pub_year), jref
    if not comment or NOT_YET.search(comment):
        return None
    t = tag(comment)
    # a venue name alone ("ACL 2025") counts when it carries a year; "to ACL" without a word of acceptance does not
    if t and (ACCEPTED.search(comment) or re.search(r"(?<!\d)20[12]\d(?!\d)|['\u2019-][12]\d\b", comment)):
        return t, track(comment), year(comment, pub_year), comment
    return None


def fetch(ids):
    url = "http://export.arxiv.org/api/query?id_list=" + ",".join(ids) + f"&max_results={len(ids)}"
    req = urllib.request.Request(url, headers={"User-Agent": "agent-memory-atlas/0.1 (venue lookup)"})
    for i in range(4):
        try:
            return ET.fromstring(urllib.request.urlopen(req, timeout=60).read())
        except Exception as e:
            print(f"  retry after {e}", file=sys.stderr)
            time.sleep(10 * (i + 1))
    raise RuntimeError("arXiv API did not answer")


def main():
    papers = [p for p in json.loads((ROOT / "data" / "papers.json").read_text())["papers"] if p.get("arxiv")]
    out = json.loads(OUT.read_text()) if OUT.exists() else {}
    by_arxiv = {p["arxiv"]: p for p in papers}
    found = 0
    ids = list(by_arxiv)
    for k in range(0, len(ids), 100):
        root = fetch(ids[k:k + 100])
        for e in root.findall("a:entry", NS):
            aid = re.sub(r"v\d+$", "", e.findtext("a:id", "", NS).rsplit("/abs/", 1)[-1])
            p = by_arxiv.get(aid)
            if not p:
                continue
            comment = " ".join((e.findtext("x:comment", "", NS) or "").split())
            jref = " ".join((e.findtext("x:journal_ref", "", NS) or "").split())
            pub = int((e.findtext("a:published", "", NS) or "0000")[:4]) or None
            hit = venue_of(comment, jref, pub)
            if hit:
                v, tr, y, ev = hit
                out[p["id"]] = {"venue": v, "venue_full": ev, "year": y, "track": tr, "source": "arXiv comment",
                                "url": f"https://arxiv.org/abs/{aid}"}
                found += 1
        print(f"{min(k + 100, len(ids))}/{len(ids)} asked, {found} with a venue", file=sys.stderr)
        time.sleep(4)
    OUT.write_text(json.dumps(dict(sorted(out.items())), indent=1, ensure_ascii=False) + "\n")
    print(f"done: {found} venues from arXiv comments; {len(out)} entries in {OUT.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
