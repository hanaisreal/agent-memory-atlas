# Data schema

Three kinds of record. Everything is JSON so the site can load it without a build step beyond
`scripts/build.py`, which merges and validates.

## 1. System — `data/systems/<id>.json`

One file per memory system that is annotated in depth.

```json
{
  "id": "mem0",                       // lowercase, [a-z0-9-]
  "name": "Mem0",
  "paper": {
    "title": "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory",
    "arxiv": "2504.19413",            // null if none
    "url": "https://arxiv.org/abs/2504.19413",
    "venue": "ECAI 2025",             // display string
    "venue_short": "ECAI",            // venue name used for sorting and filtering ("arXiv" for preprints)
    "track": "main",                  // main | short | findings | workshop | journal | preprint
    "year": 2025,
    "code": "https://github.com/mem0ai/mem0"   // null if none
  },
  "design": {                        // grouped by pipeline stage; short phrases; null = the paper does not say
    "construction": {                 // writing memory
      "unit": "fact",                 // what one stored item is
      "kept_as": "extracted",         // how faithful the stored text is to the conversation
      "processing": "LLM extracts salient facts from each message pair plus a running summary",
      "trigger": "every-exchange",    // vocab: when writing happens
      "writer": "backbone LLM (GPT-4o-mini)"   // which model or component writes
    },
    "organization": {                 // how stored items relate
      "structure": "flat (+ entity graph in Mem0^g)",
      "stores": "one vector store (+ Neo4j graph)",   // tiers or typed stores
      "index": "dense embeddings"
    },
    "management": {                   // changing memory after it is written
      "operations": "ADD / UPDATE / DELETE / NOOP chosen per fact",
      "conflicts": "LLM compares a new fact with the 10 most similar memories",
      "forgetting": null,
      "timing": "online"              // vocab
    },
    "retrieval": {                    // reading memory for a question
      "query": "question used as is",
      "candidates": "dense similarity search",
      "selection": "top-k by similarity",
      "budget": null
    },
    "use": {                          // answering with what was read
      "context": "retrieved memories with timestamps, both speakers",
      "reasoning": "single answer call"
    },
    "control": {                      // who decides, per stage (vocab)
      "construction": "prompted-llm",
      "management": "prompted-llm",
      "retrieval": "fixed-rule"
    }
  },
  "classify": {                       // single-valued placement for the Map view: one value per level
    "structure": "flat",              // none | flat | linked notes | graph | hierarchy | tiers | typed stores | agent-defined
    "index": "vector",                // none | vector | lexical | vector and lexical | exact match | not stated
    "management": "update in place",  // append-only | update in place | consolidate | evict | not stated
    "candidates": "dense",            // read everything | dense | lexical | hybrid | graph walk | agent searches | LLM routing
    "decides": "top-k rule",          // reads everything | top-k rule | reranker | LLM decides
    "note": null                      // why, when the call was close
  },
  "tags": {                           // controlled vocabularies (see below) — used for filtering
    "fidelity": "extracted",
    "structure": ["flat", "graph"],
    "write_time": ["extract", "consolidate"],
    "selection": ["dense"],
    "memory_type": ["semantic"],
    "learning": "training-free",
    "domain": ["conversation"]
  },
  "stages": {                         // one or two sentences each; "" when the paper contributes nothing there
    "ingestion": "",
    "construction": "",
    "organization": "",
    "update": "",
    "retrieval": "",
    "answer": "",
    "learning": ""
  },
  "summary": "one sentence: what is new in this system",
  "verified": false,                  // true only after a human checked every field against the paper
  "notes": ""
}
```

### Controlled vocabularies

Design fields with a fixed vocabulary:

| Field | Allowed values |
|---|---|
| `construction.trigger` | `every-turn`, `every-exchange`, `session-end`, `buffer-full`, `agent-decides`, `offline-batch`, `other` |
| `management.timing` | `online`, `offline`, `both`, `none` |
| `control.*` | `none`, `fixed-rule`, `prompted-llm`, `agent-tool-calls`, `learned-rl`, `learned-sft`, `feedback-optimized` |

`control` records who makes the decision at each stage: a fixed rule written by the designer, an LLM
following a prompt, an agent choosing tool calls, a policy trained with RL or SFT, or a strategy that
the system revises from task feedback. One value per stage, because systems often differ by stage
(Mem0 writes with a prompted LLM but retrieves with a fixed rule).

Filter tags:

| Tag | Allowed values |
|---|---|
| `fidelity` | `verbatim`, `verbatim+derived`, `rewritten`, `extracted`, `compressed`, `mixed` |
| `structure` | `none`, `flat`, `linked-notes`, `graph`, `tree`, `tiered`, `typed-stores`, `profile`, `parametric` |
| `write_time` | `none`, `filter`, `segment`, `summarize`, `extract`, `link`, `consolidate`, `agent-chosen`, `learned` |
| `selection` | `none`, `full-context`, `dense`, `lexical`, `hybrid`, `rerank`, `graph-expansion`, `llm-tool-call`, `model-reads`, `planner` |
| `memory_type` | `episodic`, `semantic`, `procedural`, `working`, `profile` |
| `learning` | `training-free`, `sft`, `rl`, `mixed` |
| `domain` | `conversation`, `long-document`, `web`, `gui`, `embodied`, `code`, `multimodal`, `general` |

## 2. Result — `data/results/<reporter-id>.json`

Results are grouped by **the paper (or run) that reported them**, because one table in one paper is
one evaluation setting. A file is an object with the reporter and a list of rows.

```json
{
  "reporter": {
    "id": "evermemos-2601.02163",
    "title": "EverMemOS: ...",
    "url": "https://arxiv.org/abs/2601.02163"
  },
  "rows": [
    {
      "system": "mem0",               // system id (must exist in data/systems or be listed in data/extra_systems.json)
      "variant": null,                // e.g. "Mem0^g", "graph variant"
      "benchmark": "locomo",          // id in data/benchmarks.json
      "benchmark_version": "original",// e.g. "original", "refined", "S", "M", "oracle", "v2-32k"
      "subset": "cat1-4",             // which questions: "cat1-4", "all", "500q", ...
      "category": "overall",          // "overall" or a category name, e.g. "single-hop", "temporal"
      "metric": "llm-judge",          // llm-judge | f1 | bleu-1 | em | mc-acc | rouge-l | recall@k | other
      "score": 64.20,                 // 0-100 scale
      "answer_model": "gpt-4.1-mini", // model that writes the answer
      "memory_model": "gpt-4.1-mini", // model that builds memory; null if same/none/unknown
      "embedding": null,              // embedding / reranker, if stated
      "judge": "gpt-4o-mini",         // judge model for llm-judge metrics; null otherwise
      "judge_prompt": "mem0",         // whose judge prompt, if stated ("mem0", "locomo-refined", "own", null)
      "run_by": "self",               // self = the system's own authors ran it
                                      // rerun = the reporter ran the system itself
                                      // copied = the reporter copied the number from another paper
      "copied_from": null,            // arXiv id / url when run_by = copied
      "location": "Table 1",          // table / figure / section in the reporter
      "notes": ""
    }
  ]
}
```

**Rule:** never fill a number or a setting from memory. If the paper does not state a setting, write
`null`. Unknown settings make a result non-comparable, and the site shows that.

## 3. Comparability

Two rows are **directly comparable** when all of these match and none is `null`:
`benchmark`, `benchmark_version`, `subset`, `category`, `metric`, `answer_model`, `judge`
(for llm-judge metrics), `judge_prompt` (for llm-judge metrics).
Rows from the same reporter and the same table normally satisfy this; the site groups by it.

## 4. Paper index — `data/papers.json`

Generated by `scripts/import_lists.py` from the upstream lists. Metadata only (title, link, code,
date, and the section each upstream list files it under). Not hand-edited; systems graduate from
here into `data/systems/` when annotated.
