# Agent Memory Atlas

A browsable database of LLM-agent memory systems whose main contribution is **keeping every reported
benchmark score together with the setting it was measured under**, so you can see which numbers can be
compared and which cannot.

The same system routinely appears with very different scores in different papers. On LoCoMo (overall,
LLM-judge), the scores recorded here for Mem0 range from 43.3 to 66.9 across 11 settings, and EverMemOS
appears as 92.3, 93.05 and 94.48 depending on who reports it. None of those differences comes from the
memory system. They come from the answering model, the judge, the judge prompt, the benchmark version
and which questions were kept, which most papers report only partly.

## What is in it

| View | What it shows |
|---|---|
| **Systems** | Annotated systems on five shared axes (unit, text kept as, write-time processing, organisation, selection), filterable by controlled tags |
| **Pipeline** | The same systems by pipeline stage: ingestion, construction, organization, update, retrieval, answer, learning |
| **Results** | Every score, one column per evaluation setting; spread of each system across settings; head-to-head comparison restricted to shared settings |
| **Papers** | 684 entries merged from four community lists, keeping each list's own axis as a filter |
| **Method** | Comparability rules and the known traps of each benchmark |

Paper index sources (pinned in `scripts/import_lists.py`):
[Shichun-Liu/Agent-Memory-Paper-List](https://github.com/Shichun-Liu/Agent-Memory-Paper-List) (function × form),
[TeleAI-UAGI/Awesome-Agent-Memory](https://github.com/TeleAI-UAGI/Awesome-Agent-Memory) (substrate, products, benchmarks),
[DEEP-PolyU/Awesome-GraphMemory](https://github.com/DEEP-PolyU/Awesome-GraphMemory) (pipeline stage, graph memory),
[yyyujintang/Awesome-Agent-Memory-Papers](https://github.com/yyyujintang/Awesome-Agent-Memory-Papers) (storage / learning / memory-type tags).

## Layout

```
data/systems/<id>.json        one annotated system (axes, tags, pipeline stages)
data/results/<reporter>.json  every score from one paper, with its settings and table reference
data/benchmarks.json          benchmark registry with versions and pitfalls
data/extra_systems.json       baselines that appear in results but are not annotated yet
data/papers.json              generated paper index (do not edit by hand)
data/table_images.json        which table images exist, and their page numbers (generated)
schema/SCHEMA.md              field definitions, controlled vocabularies, comparability rule
scripts/import_lists.py       regenerate data/papers.json from the upstream lists
scripts/build.py              validate data/ and write site/atlas.json
scripts/capture_tables.py     crop the cited tables out of paper PDFs into site/tables/
site/                         static site (index.html, app.js, style.css, atlas.json)
```

## Run it

```bash
python3 scripts/build.py                  # validate + write site/atlas.json
python3 -m http.server 8000 -d site       # open http://localhost:8000
python3 scripts/import_lists.py           # refresh the paper index (needs network)
```

The site is plain HTML/JS with no build step, so `site/` can be served from GitHub Pages as is.

## Checking a number against its source

Every table reference in the site ("Table 2 ↗") links to the paper, opening the arXiv PDF at the right
page when it is known. Hovering or focusing the link shows an image of the table as printed in the
paper, so any score can be checked without leaving the page.

The images are cropped from the PDFs by `scripts/capture_tables.py`. PDFs are not committed; put them in
any folder (file names must contain the arXiv id) and run:

```bash
pip install pymupdf
python3 scripts/capture_tables.py --pdf-dir ~/papers
python3 scripts/build.py
```

The script finds each cited table's caption, follows the table's horizontal rules to its edges, and
falls back to the whole page when it cannot, so an image never shows the wrong table silently.
Tables captured so far: EverMemOS, H-Mem and CueMem. The other papers link to the PDF without a preview
until their PDFs are added.

## Adding a system or a paper's results

1. Read `schema/SCHEMA.md`.
2. Add `data/systems/<id>.json` and/or `data/results/<system-id>-<arxiv-id>.json`.
3. Record **every** row of the paper's results tables, baselines included, with the table reference in
   `location`. A setting the paper does not state is `null`, never a guess.
4. Run `python3 scripts/build.py --check`.
5. Leave `"verified": false` unless you checked every field against the paper yourself.

## Status

All 20 system annotations and all result rows are **drafts**: they were extracted from the papers and
spot-checked, but no one has yet checked them line by line. Every row points to its table so it can be checked.

## License

Code (scripts, site): MIT, see `LICENSE`. Annotations and result records in `data/`: CC BY 4.0, see
`data/LICENSE`. Upstream lists keep their own licenses.
