# Asking questions about a paper (design for the LLM backend)

The rule: **every answer comes from the paper's own text, located and checked, never from a summary.**
Our records (data/systems/*.json), the agents' notes (notes.md) and abstracts are summaries. They are
useful for finding where to look, but they have been wrong before, so they are never the evidence.

## Where the text is

`.cache/papers/<system id>/` (built by scripts/collect_papers.py and scripts/save_paper_notes.py; not
committed, the backend keeps its own private copy):

| file | use |
|---|---|
| paper.md | the text, with `## Page N` headings. The only source an answer may rest on. |
| paper.pdf | figures and tables that did not survive text extraction; render the page when a question needs one. |
| code.md | code locations (repo, commit, file, lines) the annotator relied on; check the code at that commit. |
| notes.md, meta.json | hints for where to look. Not evidence. |

## How an answer is produced

1. **Locate.** Search paper.md for the question's terms and their variants (symbols, table and section names).
   Take the matching pages, plus the pages they refer to ("see Table 3", "App. B").
2. **Read and verify.** The model reads those pages and answers only from them. Every claim carries its page
   (and table/section) and a short quote of the sentence it rests on.
3. **Check the quote.** The backend confirms each quote occurs verbatim on the cited page; an answer whose
   quote is not found is rejected and retried, or returned as "could not verify".
4. **Say when the paper is silent.** If the located pages do not answer the question, the reply says so
   rather than filling in from the record or general knowledge.
5. **Numbers from tables.** When a number comes from a table that extraction garbled, render that PDF page
   and read it from the image; cite the table.
6. **Code questions.** Answer from the pinned commit in code.md (file and lines), not from how the record
   describes the code.
