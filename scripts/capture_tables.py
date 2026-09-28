"""Capture images of the source tables that result rows cite, so readers can check each number.

For every results file, the reporter's arXiv id is matched to a PDF in --pdf-dir (any file whose name
contains the id). For each table a row cites in `location` ("Table 2", "Table 6 (App. A.3)", ...) the
script finds the caption on its page, finds the table next to it, and renders caption + table to
site/tables/<reporter-id>/table-<n>.png. When the table body cannot be located, the whole page is
rendered instead, so the image always shows the source. data/table_images.json records what was
captured (page number, crop or full page, PDF file) and build.py attaches it to the rows.

    pip install pymupdf
    python3 scripts/capture_tables.py --pdf-dir ~/papers        # PDFs are not committed

PDFs stay out of the repository; only the crops are committed.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import pymupdf as fitz

ROOT = Path(__file__).resolve().parent.parent
TABLE_REF = re.compile(r"Table\s*(\d+)", re.I)
ZOOM = 2.2
MARGIN = 6


def caption_blocks(page, n):
    """Text blocks that start with a caption for table n (not in-text references)."""
    pat = re.compile(rf"^\s*Table\s*{n}\s*[:.|]", re.I)
    out = []
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, text = b[:5]
        if pat.match(text):
            out.append(fitz.Rect(x0, y0, x1, y1))
    return out


def table_near(page, cap):
    """The detected table closest to the caption (above or below it) that overlaps it horizontally."""
    try:
        tables = page.find_tables().tables
    except Exception:
        return None
    best, best_d = None, 1e9
    for t in tables:
        r = fitz.Rect(t.bbox)
        if r.width < 80 or r.height < 25:
            continue
        if min(r.x1, cap.x1) - max(r.x0, cap.x0) < 0.3 * min(r.width, cap.width):
            continue
        d = cap.y0 - r.y1 if r.y1 <= cap.y0 + 2 else r.y0 - cap.y1
        if -2 <= d < best_d and d < 140:
            best, best_d = r, d
    return best


def rules(page):
    """Horizontal rules drawn on the page (booktabs \\toprule/\\midrule/\\bottomrule and \\hline)."""
    out = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.height <= 2.5 and r.width >= 60:
            out.append(fitz.Rect(r))
    return sorted(out, key=lambda r: r.y0)


def table_by_rules(page, cap):
    """Walk from the caption along a run of horizontal rules; the run spans the table body.

    Tries both directions (captions sit above or below their table depending on the venue), rejects a
    run when another table caption lies between it and this caption, and keeps the closer run.
    """
    rs = [r for r in rules(page) if min(r.x1, cap.x1) - max(r.x0, cap.x0) > 0.3 * min(r.width, cap.width)]
    other_caps = [fitz.Rect(b[:4]) for b in page.get_text("blocks")
                  if re.match(r"^\s*Table\s*\d+\s*[:.|]", b[4]) and fitz.Rect(b[:4]) != cap]
    best = None
    for down in (True, False):
        near = [r for r in rs if 0 <= ((r.y0 - cap.y1) if down else (cap.y0 - r.y1)) < 45]
        if not near:
            continue
        cur = min(near, key=lambda r: r.y0) if down else max(near, key=lambda r: r.y1)
        lo, hi = (cap.y1, cur.y0) if down else (cur.y1, cap.y0)
        if any(lo - 1 <= c.y0 <= hi + 1 or lo - 1 <= c.y1 <= hi + 1 for c in other_caps):
            continue
        run = [cur]
        seq = sorted((r for r in rs if (r.y0 > cur.y0 if down else r.y1 < cur.y1)), key=lambda r: r.y0, reverse=not down)
        for r in seq:
            gap = (r.y0 - run[-1].y1) if down else (run[-1].y0 - r.y1)
            if gap > 260 or any((run[-1].y1 < c.y0 < r.y0) if down else (r.y1 < c.y1 < run[-1].y0) for c in other_caps):
                break
            run.append(r)
        if len(run) < 2:
            continue
        # rules have zero height, which PyMuPDF treats as empty rects; take the bounds by hand
        box = fitz.Rect(min(r.x0 for r in run), min(r.y0 for r in run), max(r.x1 for r in run), max(r.y1 for r in run))
        dist = (cur.y0 - cap.y1) if down else (cap.y0 - cur.y1)
        if best is None or dist < best[0]:
            best = (dist, box)
    return best[1] if best else None


def find_table(doc, n):
    """Return (page_index, rect or None). Prefers pages where the caption sits next to a detected table."""
    fallback = None
    for i, page in enumerate(doc):
        for cap in caption_blocks(page, n):
            t = table_by_rules(page, cap) or table_near(page, cap)
            if t:
                return i, fitz.Rect(min(t.x0, cap.x0), min(t.y0, cap.y0), max(t.x1, cap.x1), max(t.y1, cap.y1))
            if fallback is None:
                fallback = (i, None)
    return fallback


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", required=True)
    args = ap.parse_args()
    pdfs = list(Path(args.pdf_dir).expanduser().rglob("*.pdf"))
    manifest_path = ROOT / "data" / "table_images.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    for rf in sorted((ROOT / "data" / "results").glob("*.json")):
        doc_json = json.loads(rf.read_text())
        rid = doc_json["reporter"]["id"]
        arxiv = rid.rsplit("-", 1)[-1]
        pdf = next((p for p in pdfs if arxiv in p.name), None)
        if not pdf:
            print(f"skip {rid}: no PDF with '{arxiv}' in its name", file=sys.stderr)
            continue
        tables = sorted({int(m.group(1)) for r in doc_json["rows"] for m in [TABLE_REF.search(r.get("location") or "")] if m})
        doc = fitz.open(pdf)
        out_dir = ROOT / "site" / "tables" / rid
        out_dir.mkdir(parents=True, exist_ok=True)
        for n in tables:
            hit = find_table(doc, n)
            if not hit:
                print(f"  {rid} Table {n}: caption not found", file=sys.stderr)
                continue
            i, rect = hit
            page = doc[i]
            clip = page.rect if rect is None else fitz.Rect(
                max(0, rect.x0 - MARGIN), max(0, rect.y0 - MARGIN),
                min(page.rect.x1, rect.x1 + MARGIN), min(page.rect.y1, rect.y1 + MARGIN))
            pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), clip=clip)
            name = f"table-{n}.png"
            pix.save(out_dir / name)
            manifest.setdefault(rid, {})[str(n)] = {
                "img": f"tables/{rid}/{name}", "page": i + 1,
                "crop": rect is not None, "pdf": pdf.name,
            }
            print(f"  {rid} Table {n}: page {i + 1}, {'crop' if rect else 'full page'}", file=sys.stderr)
    manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
