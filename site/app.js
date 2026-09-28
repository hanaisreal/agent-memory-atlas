"use strict";

const VIEWS = ["map", "systems", "pipeline", "results", "papers", "method"];
const STAGE_LABEL = {
  ingestion: ["Ingestion", "segmenting the stream"],
  construction: ["Construction", "what gets written"],
  organization: ["Organization", "how units relate"],
  update: ["Update", "merge, overwrite, forget"],
  retrieval: ["Retrieval", "choosing what to read"],
  answer: ["Answer", "using what was read"],
  learning: ["Learning", "trained memory policy"],
};
const TAG_LABEL = {
  fidelity: "Text kept as", structure: "Organisation", write_time: "Write-time processing",
  selection: "Selection", memory_type: "Memory type", learning: "Learning", domain: "Domain",
};
/* The grouped design description, by pipeline stage. Order here is column order in the Systems table. */
const DESIGN = [
  ["construction", "Construction", "writing memory", [["unit", "Memory unit"], ["kept_as", "Text kept as"], ["processing", "Write-time processing"], ["trigger", "Write trigger"], ["writer", "Writer"]]],
  ["organization", "Organization", "how items relate", [["structure", "Structure"], ["stores", "Stores / tiers"], ["index", "Index"]]],
  ["management", "Management", "changing memory", [["operations", "Operations"], ["conflicts", "Conflict handling"], ["forgetting", "Forgetting"], ["timing", "Timing"]]],
  ["retrieval", "Retrieval", "reading memory", [["query", "Query processing"], ["candidates", "Candidates"], ["selection", "Selection"], ["budget", "Budget"]]],
  ["use", "Use", "answering with it", [["context", "Prompt context"], ["reasoning", "Reasoning"]]],
  ["control", "Control", "who decides", [["construction", "Construction"], ["management", "Management"], ["retrieval", "Retrieval"]]],
];
const VOCAB_FIELDS = new Set(["construction.trigger", "management.timing", "control.construction", "control.management", "control.retrieval"]);
let shownGroups;
try { shownGroups = new Set(JSON.parse(localStorage.getItem("atlas.groups") || "null") || DESIGN.map(g => g[0])); }
catch (_) { shownGroups = new Set(DESIGN.map(g => g[0])); }
function designCell(s, g, f, first) {
  const v = s.design?.[g]?.[f];
  const cls = first ? " gstart" : "";
  if (v == null || v === "") return `<td class="nd${cls}" title="Not stated in the paper">–</td>`;
  if (VOCAB_FIELDS.has(`${g}.${f}`)) return `<td class="${cls}"><span class="tag${v === "none" ? " dim" : ""}">${esc(v)}</span></td>`;
  return `<td class="${cls}">${esc(v)}</td>`;
}
function figureLink(s) {
  return s.figure ? ` <a class="src" href="${esc(s.figure)}" target="_blank" rel="noopener" data-img="${esc(s.figure)}" data-label="${esc(s.name)} system figure">figure<span aria-hidden="true"> ↗</span></a>` : "";
}
const RUN_MARK = { self: "s", rerun: "r", copied: "c" };
const RUN_TEXT = { self: "run by the system's authors", rerun: "re-run by the reporting paper", copied: "copied from another paper" };
const PAPER_FACETS = [
  ["kind", "Entry type", p => [p.kind]],
  ["year", "Year", p => (p.venue?.year ? [String(p.venue.year)] : p.date ? [p.date.slice(0, 4)] : [])],
  ["venue", "Venue (as listed)", p => (p.venue ? [p.venue.venue] : ["not listed"])],
  ["track", "Track (as listed)", p => (p.venue ? [p.venue.track] : ["not listed"])],
  ["source", "Listed in", p => [...new Set(p.sources.map(s => SOURCE_NAME[s.list] || s.list))]],
  ["liu_function", "Function (Liu et al.)", p => p.facets.liu_function || []],
  ["liu_form", "Form (Liu et al.)", p => p.facets.liu_form || []],
  ["teleai_section", "Section (TeleAI)", p => p.facets.teleai_section || []],
  ["teleai_subsection", "Subsection (TeleAI)", p => p.facets.teleai_subsection || []],
  ["deep_stage", "Graph-memory stage (DEEP-PolyU)", p => p.facets.deep_stage || []],
  ["yyy_tags", "Tags (yyyujintang)", p => p.facets.yyy_tags || []],
];
const SOURCE_NAME = { liu: "Liu et al.", teleai: "TeleAI", deep: "DEEP-PolyU", yyy: "yyyujintang" };

let A = null;             // atlas.json
const sysById = new Map();
const S = {               // UI state
  view: "map", mapStage: "retrieval", mapMore: false, mapOpen: null, mapHi: null,
  meta: {}, sort: "name", psort: "new",
  q: "", tags: {},        // systems/pipeline filters
  stage: null,
  bench: null, cat: "overall", metric: null, version: "all", copied: true, col: null,
  cmpA: null, cmpB: null,
  pq: "", pf: {}, annotatedOnly: false, pshown: 60,
};

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const venueYear = p => (p?.venue || "") + (p?.year && !String(p?.venue || "").includes(p.year) ? (p?.venue ? " · " : "") + p.year : "");
const fmt = x => (Math.round(x * 100) / 100).toFixed(2).replace(/\.?0+$/, m => (m.startsWith(".") ? "" : m));

function sysName(id, variant) {
  const s = sysById.get(id);
  const base = s ? s.name : id;
  return variant ? `${base} (${variant})` : base;
}

/* ---------------- boot ---------------- */
fetch("atlas.json").then(r => r.json()).then(data => {
  A = data;
  for (const s of A.systems) sysById.set(s.id, { ...s, annotated: true });
  for (const s of A.extra_systems) if (!sysById.has(s.id)) sysById.set(s.id, { ...s, annotated: false });
  const benches = [...new Set(A.results.map(r => r.benchmark))];
  S.bench = benches.includes("locomo") ? "locomo" : benches[0] || null;
  const h = location.hash.slice(1);
  if (VIEWS.includes(h)) S.view = h;
  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("button[data-view]");
    if (b) go(b.dataset.view);
  });
  window.addEventListener("hashchange", () => {
    const v = location.hash.slice(1);
    if (VIEWS.includes(v) && v !== S.view) { S.view = v; render(); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { hideTip(); closeDrawer(); } });
  render();
}).catch(err => {
  $("#main").innerHTML = `<p class="empty-state">Could not load atlas.json (${esc(err.message)}). Run <code>python3 scripts/build.py</code> and serve the <code>site/</code> folder over HTTP.</p>`;
});

function go(v) {
  S.view = v;
  try { history.replaceState(null, "", "#" + v); } catch (_) { /* sandboxed */ }
  render();
  window.scrollTo(0, 0);
}

function render() {
  const counts = {
    map: "", systems: A.systems.length, pipeline: A.systems.length,
    results: A.results.length, papers: A.papers.length, method: "",
  };
  $("#tabs").innerHTML = [["map", "Map"], ["systems", "Systems"], ["pipeline", "Pipeline"], ["results", "Results"], ["papers", "Papers"], ["method", "Method"]]
    .map(([v, l]) => `<button role="tab" data-view="${v}" aria-selected="${S.view === v}">${l}${counts[v] !== "" ? `<span class="n">${counts[v]}</span>` : ""}</button>`).join("");
  const main = $("#main");
  ({ map: viewMap, systems: viewSystems, pipeline: viewPipeline, results: viewResults, papers: viewPapers, method: viewMethod })[S.view](main);
}

/* ---------------- shared system filtering ---------------- */
function tagVals(s, k) { const v = (s.tags || {})[k]; return v == null ? [] : Array.isArray(v) ? v : [v]; }

/* Venue, year and track: filters shared by Map and Systems, plus sort orders. */
const TRACK_ORDER = ["main", "short", "findings", "journal", "workshop", "preprint"];
const sysVenue = s => (s.paper?.venue_short ? { venue: s.paper.venue_short, year: s.paper.year, track: s.paper.track } : null);
function venueTag(v) {
  if (!v) return "";
  const yy = v.year ? `'${String(v.year).slice(2)}` : "";
  const tr = v.track && v.track !== "main" && v.track !== "preprint" ? ` ${v.track}` : "";
  return `${v.venue}${yy}${tr}`;
}
const META = [
  ["year", "Year", s => (s.paper?.year ? [String(s.paper.year)] : [])],
  ["venue", "Venue", s => (s.paper?.venue_short ? [s.paper.venue_short] : [])],
  ["track", "Track", s => (s.paper?.track ? [s.paper.track] : [])],
];
const SORTS = [["name", "Name"], ["year-new", "Newest first"], ["year-old", "Oldest first"], ["venue", "Venue"]];
/* Venue order: named venues A→Z, then preprints, then entries with no venue. */
function venueCmp(a, b) {
  const rank = v => (!v ? 2 : v.track === "preprint" ? 1 : 0);
  return rank(a) - rank(b) || (a && b ? String(a.venue).localeCompare(String(b.venue)) : 0);
}
function sortSystems(list) {
  const y = s => s.paper?.year || 0;
  const by = {
    "name": (a, b) => a.name.localeCompare(b.name),
    "year-new": (a, b) => y(b) - y(a) || a.name.localeCompare(b.name),
    "year-old": (a, b) => (y(a) || 9999) - (y(b) || 9999) || a.name.localeCompare(b.name),
    "venue": (a, b) => venueCmp(sysVenue(a), sysVenue(b)) || y(b) - y(a) || a.name.localeCompare(b.name),
  }[S.sort] || ((a, b) => a.name.localeCompare(b.name));
  return [...list].sort(by);
}
function sortSelect(id) {
  return `<label class="sortsel" for="${id}">Order by <select id="${id}">${SORTS.map(([v, l]) => `<option value="${v}" ${v === S.sort ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
}
function metaSort(vals, k) {
  return k === "year" ? vals.sort((a, b) => b.localeCompare(a)) : k === "track" ? vals.sort((a, b) => TRACK_ORDER.indexOf(a) - TRACK_ORDER.indexOf(b)) : vals.sort();
}

function filteredSystems(ignoreKey) {
  const q = S.q.trim().toLowerCase();
  return A.systems.filter(s => {
    for (const [k, set] of Object.entries(S.tags)) {
      if (k === ignoreKey || !set.size) continue;
      if (!tagVals(s, k).some(v => set.has(v))) return false;
    }
    for (const [k, , get] of META) {
      const set = S.meta[k];
      if (ignoreKey === "m:" + k || !set || !set.size) continue;
      if (!get(s).some(v => set.has(v))) return false;
    }
    if (S.view === "pipeline" && S.stage && !(s.stages || {})[S.stage]) return false;
    if (q) {
      const hay = [s.name, s.summary, ...Object.values(s.design || {}).flatMap(g => Object.values(g || {})), ...Object.values(s.stages || {})].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function systemRail() {
  const parts = [`<div><h4>Search</h4><input id="sq" class="search" type="search" placeholder="Name, mechanism…" value="${esc(S.q)}"></div>`];
  for (const [k, label, get] of META) {
    const pool = filteredSystems("m:" + k);
    const set = S.meta[k] || new Set();
    const cnt = new Map();
    for (const x of pool) for (const v of get(x)) cnt.set(v, (cnt.get(v) || 0) + 1);
    const vals = metaSort([...new Set([...cnt.keys(), ...set])], k);
    if (vals.length) parts.push(`<div><h4>${label}</h4><div class="facet">${vals.map(v => `<button class="chip" data-k="m:${k}" data-v="${esc(v)}" aria-pressed="${set.has(v)}">${esc(v)}<span class="c">${cnt.get(v) || 0}</span></button>`).join("")}</div></div>`);
  }
  for (const k of Object.keys(TAG_LABEL)) {
    const pool = filteredSystems(k);
    const set = S.tags[k] || new Set();
    const chips = A.vocab[k].map(v => {
      const c = pool.filter(s => tagVals(s, k).includes(v)).length;
      const on = set.has(v);
      if (!c && !on) return "";
      return `<button class="chip" data-k="${k}" data-v="${esc(v)}" aria-pressed="${on}">${esc(v)}<span class="c">${c}</span></button>`;
    }).join("");
    if (chips) parts.push(`<div><h4>${TAG_LABEL[k]}</h4><div class="facet">${chips}</div></div>`);
  }
  const any = S.q || Object.values(S.tags).some(s => s.size) || Object.values(S.meta).some(s => s.size) || S.stage;
  if (any) parts.push(`<button class="clear" id="sclear">Clear all filters</button>`);
  return `<aside class="rail" aria-label="Filters">${parts.join("")}</aside>`;
}

function bindSystemRail(main) {
  const sq = $("#sq", main);
  sq.addEventListener("input", () => { S.q = sq.value; const pos = sq.selectionStart; render(); const n = $("#sq"); n.focus(); n.setSelectionRange(pos, pos); });
  main.querySelectorAll(".rail .chip").forEach(b => b.addEventListener("click", () => toggleFacet(b.dataset.k, b.dataset.v)));
  const c = $("#sclear", main);
  if (c) c.addEventListener("click", () => { S.q = ""; S.tags = {}; S.meta = {}; S.stage = null; render(); });
  $("#ssort", main)?.addEventListener("change", e => { S.sort = e.target.value; render(); });
}
function toggleFacet(k, v) {
  const bag = k.startsWith("m:") ? S.meta : S.tags;
  const key = k.replace(/^m:/, "");
  const set = bag[key] || (bag[key] = new Set());
  set.has(v) ? set.delete(v) : set.add(v);
  render();
}

function resultCount(id) { return A.results.filter(r => r.system === id).length; }
function resultSummary(id) {
  const rows = A.results.filter(r => r.system === id);
  if (!rows.length) return '<span class="dim">none</span>';
  const papers = new Set(rows.map(r => r.reporter)).size;
  return `${rows.length}<small class="dim"> in ${papers} paper${papers > 1 ? "s" : ""}</small>`;
}

/* ---------------- Map ----------------
   A stage on the left spans out into a two-level tree. Both levels are single-valued, so each system sits
   in exactly one place per stage (its path). Multi-valued features are shown by highlighting, not by
   placing a system twice. Clicking a system opens its details in place under its branch. */
const one = v => (v == null || v === "" ? "not stated" : v);
function remembered(s) {
  const t = tagVals(s, "memory_type"), conv = t.includes("episodic") || t.includes("working"), facts = t.includes("semantic");
  return conv && facts ? "conversation and facts" : conv ? "the conversation" : facts ? "facts and knowledge" : "not stated";
}
const MAP_STAGES = [
  { id: "type", n: "00", title: "What is remembered", sub: "memory type", group: null,
    levels: [["What is kept", remembered], ["User profile", s => (tagVals(s, "memory_type").includes("profile") ? "keeps a user profile" : "no user profile")]],
    features: ["Memory type", s => tagVals(s, "memory_type")], note: s => s.summary },
  { id: "construction", n: "01", title: "Construction", sub: "writing memory", group: "construction", deep: "Extraction",
    levels: [["Text kept as", s => one(s.tags?.fidelity)], ["Who writes", s => one(s.design?.control?.construction)]],
    features: ["Write-time processing", s => tagVals(s, "write_time")],
    note: s => [s.design?.construction?.unit, s.design?.construction?.processing].filter(Boolean).join(". ") },
  { id: "organization", n: "02", title: "Organization", sub: "how items relate", group: "organization", deep: "Storage",
    levels: [["Main structure", s => one(s.classify?.structure)], ["Index", s => one(s.classify?.index)]],
    features: ["Also has", s => tagVals(s, "structure")],
    note: s => [s.design?.organization?.structure, s.design?.organization?.stores].filter(Boolean).join(". ") },
  { id: "management", n: "03", title: "Management", sub: "changing memory", group: "management", deep: "Evolution",
    levels: [["What happens", s => one(s.classify?.management)], ["When", s => one(s.design?.management?.timing)]],
    features: ["Who decides", s => [one(s.design?.control?.management)]],
    note: s => [s.design?.management?.operations, s.design?.management?.conflicts].filter(Boolean).join(". ") },
  { id: "retrieval", n: "04", title: "Retrieval", sub: "reading memory", group: "retrieval", deep: "Retrieval",
    levels: [["How candidates are found", s => one(s.classify?.candidates)], ["Who picks the final set", s => one(s.classify?.decides)]],
    features: ["Uses", s => tagVals(s, "selection")],
    note: s => [s.design?.retrieval?.candidates, s.design?.retrieval?.selection].filter(Boolean).join(". ") },
  { id: "learning", n: "05", title: "Learning", sub: "is anything trained?", group: null,
    levels: [["Training", s => one(s.tags?.learning)]], features: null,
    note: s => s.stages?.learning || "No trained component." },
];
const pathOf = (s, st) => st.levels.map(([, f]) => f(s));

function mapSystems() {
  return sortSystems(A.systems.filter(s => {
    for (const [k, , get] of META) { const set = S.meta[k]; if (set && set.size && !get(s).some(v => set.has(v))) return false; }
    return true;
  }));
}

function leafHTML(s, st) {
  const hi = S.mapHi && st.features && st.features[1](s).includes(S.mapHi);
  const dim = S.mapHi && !hi;
  return `<button class="leaf${hi ? " hi" : ""}${dim ? " dimmed" : ""}${S.mapOpen === s.id ? " open" : ""}" data-sys="${esc(s.id)}" aria-expanded="${S.mapOpen === s.id}"
    data-label="${esc(s.name)} · ${esc(st.title.toLowerCase())}" data-note="${esc(st.note(s) || "")}">${esc(s.name)}<span class="lv">${esc(venueTag(sysVenue(s)))}</span></button>`;
}

function detailHTML(s, st) {
  const p = s.paper || {};
  const rows = A.results.filter(r => r.system === s.id && (r.category || "overall") === "overall")
    .sort((a, b) => a.benchmark.localeCompare(b.benchmark) || b.score - a.score);
  const nAll = A.results.filter(r => r.system === s.id).length;
  const g = st.group && DESIGN.find(d => d[0] === st.group);
  return `<div class="detail" role="region" aria-label="${esc(s.name)} details">
    <button class="dclose" data-close aria-label="Close details">×</button>
    <div class="dhead"><b>${esc(s.name)}</b>
      <span class="dim">${esc([p.venue_short && p.venue_short !== "arXiv" ? p.venue_short : null, p.track, p.year].filter(Boolean).join(" · "))}</span>
      ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">paper ↗</a>` : ""}${p.code ? `<a href="${esc(p.code)}" target="_blank" rel="noopener">code ↗</a>` : ""}</div>
    ${s.summary ? `<p class="dsum">${esc(s.summary)}</p>` : ""}
    <div class="dgrid">
      <div>
        <h5>${esc(st.title)}${g ? "" : ""}</h5>
        ${g ? `<dl class="kv">${g[3].map(([f, l]) => { const v = s.design?.[g[0]]?.[f]; return `<dt>${l}</dt><dd>${v == null || v === "" ? '<span class="dim">not stated</span>' : esc(v)}</dd>`; }).join("")}</dl>`
            : `<p>${esc(st.note(s) || "")}</p>`}
        ${s.classify?.note && ["organization", "management", "retrieval"].includes(st.id) ? `<p class="dnote">Placement: ${esc(s.classify.note)}</p>` : ""}
      </div>
      <div>
        <h5>Where it sits at every stage</h5>
        <ol class="dpath">${MAP_STAGES.map(x => `<li><button class="jump${x.id === st.id ? " cur" : ""}" data-jump="${x.id}">${x.n} ${esc(x.title)}</button> ${pathOf(s, x).map(esc).join(" → ")}</li>`).join("")}</ol>
      </div>
    </div>
    ${s.figure ? `<a class="dfig" href="${esc(s.figure)}" target="_blank" rel="noopener"><img src="${esc(s.figure)}" alt="${esc(s.name)} system figure from the paper"></a>` : ""}
    <h5>Reported results, overall <span class="dim">(${rows.length} of ${nAll} recorded; per-category scores are in Results)</span></h5>
    ${rows.length ? `<div class="scroll"><table class="mini"><thead><tr><th>Benchmark</th><th class="num">Score</th><th>Metric</th><th>Answer model</th><th>Judge</th><th>Reported in</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(A.benchmarks.find(b => b.id === r.benchmark)?.name || r.benchmark)}${r.benchmark_version ? ` <span class="dim">${esc(r.benchmark_version)}</span>` : ""}${r.variant ? ` <span class="tag">${esc(r.variant)}</span>` : ""}</td><td class="num">${fmt(r.score)}<sup>${RUN_MARK[r.run_by] || "?"}</sup></td><td>${esc(r.metric)}</td><td>${esc(r.answer_model || "?")}</td><td>${esc(r.judge || (r.metric === "llm-judge" ? "?" : "–"))}</td><td>${esc(reporterShort(r.reporter))}<br>${sourceLink(r)}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="dim">No scores recorded.</p>`}
  </div>`;
}

function viewMap(main) {
  const st = MAP_STAGES.find(x => x.id === S.mapStage) || MAP_STAGES[4];
  const systems = mapSystems();
  // two-level grouping; each system lands in exactly one L1 and one L2 value
  const tree = new Map();
  for (const s of systems) {
    const [a, b] = pathOf(s, st);
    if (!tree.has(a)) tree.set(a, new Map());
    const sub = tree.get(a), k = b ?? "";
    (sub.get(k) || sub.set(k, []).get(k)).push(s);
  }
  const size = m => [...m.values()].reduce((n, l) => n + l.length, 0);
  const l1 = [...tree.entries()].sort((x, y) => (x[0] === "not stated") - (y[0] === "not stated") || size(y[1]) - size(x[1]));
  const feats = st.features ? [...new Set(systems.flatMap(st.features[1]))].sort() : [];
  if (S.mapHi && !feats.includes(S.mapHi)) S.mapHi = null;

  // DEEP-PolyU papers on this stage, minus the ones that are annotated systems
  const known = new Set(A.systems.map(s => s.paper?.arxiv).filter(Boolean));
  const trackSet = S.meta.track;
  const deep = st.deep ? A.papers.filter(p => (p.facets.deep_stage || []).includes(st.deep) && !(p.arxiv && known.has(p.arxiv))
    && (!trackSet || !trackSet.size || (p.venue && trackSet.has(p.venue.track)))) : [];
  const deepGroups = new Map();
  for (const p of deep) { const k = (p.facets.deep_data || ["other"])[0]; (deepGroups.get(k) || deepGroups.set(k, []).get(k)).push(p); }
  const pyear = p => p.venue?.year || (p.date ? +p.date.slice(0, 4) : 0);
  const orderPapers = ps => [...ps].sort(S.sort === "year-old" ? (a, b) => (pyear(a) || 9999) - (pyear(b) || 9999)
    : S.sort === "venue" ? (a, b) => venueCmp(a.venue, b.venue) || pyear(b) - pyear(a)
    : S.sort === "name" ? (a, b) => a.title.localeCompare(b.title) : (a, b) => pyear(b) - pyear(a));
  const short = t => { const x = t.split(/:\s/)[0]; return x.length > 52 ? x.slice(0, 50) + "…" : x; };

  const tracks = TRACK_ORDER.filter(t => A.systems.some(s => s.paper?.track === t));
  const tset = S.meta.track || new Set();

  main.innerHTML = `
    <p class="lede">Pick a stage of the memory pipeline. It spans out in two steps, and <b>each system sits in exactly one place per stage</b>. Click a system to open its details right there; its path through every other stage is listed so you can jump between stages. Highlight a feature to see every system that uses it, wherever it sits.</p>
    <div class="mapbar">
      ${sortSelect("msort")}
      <span class="mblabel">Track</span>
      <button class="chip" data-track="" aria-pressed="${!tset.size}">all</button>
      ${tracks.map(t => `<button class="chip" data-track="${t}" aria-pressed="${tset.has(t)}">${t}<span class="c">${A.systems.filter(s => s.paper?.track === t).length}</span></button>`).join("")}
      <span class="mblabel">${systems.length} of ${A.systems.length} systems</span>
    </div>
    <div class="map" id="map">
      <svg class="wires" aria-hidden="true"></svg>
      <ol class="mstages">${MAP_STAGES.map(x => `<li><button class="mstage" data-stage="${x.id}" aria-pressed="${x.id === st.id}">
        <span class="mn">${x.n}</span><span class="mt">${esc(x.title)}</span><span class="ms">${esc(x.sub)}</span><span class="ma" aria-hidden="true">→</span></button></li>`).join("")}</ol>
      <section class="fan" aria-label="${esc(st.title)}">
        <div class="fanhead">
          <span class="fantitle">${esc(st.title)}</span>
          <span class="levels">${st.levels.map(([l]) => esc(l)).join(' <span aria-hidden="true">→</span> ')}</span>
          ${feats.length ? `<div class="feats"><span class="mblabel">Highlight · ${esc(st.features[0])}</span>${feats.map(f => `<button class="chip" data-hi="${esc(f)}" aria-pressed="${S.mapHi === f}">${esc(f)}<span class="c">${systems.filter(s => st.features[1](s).includes(f)).length}</span></button>`).join("")}</div>` : ""}
        </div>
        ${l1.length ? l1.map(([a, sub]) => `<div class="l1">
          <div class="bnode l1n${a === "not stated" ? " unk" : ""}">${esc(a)}<span class="bc">${size(sub)}</span></div>
          <div class="l2s">${[...sub.entries()].sort((x, y) => y[1].length - x[1].length).map(([b, list]) => {
            const open = list.find(s => s.id === S.mapOpen);
            return `<div class="l2">
              ${b ? `<div class="bnode l2n${b === "not stated" ? " unk" : ""}">${esc(b)}<span class="bc">${list.length}</span></div>` : `<div class="bnode l2n ghost" aria-hidden="true"></div>`}
              <div class="leafbox"><div class="leaves">${list.map(s => leafHTML(s, st)).join("")}</div>${open ? detailHTML(open, st) : ""}</div>
            </div>`; }).join("")}</div>
        </div>`).join("") : `<p class="empty-state">No system matches the track filter.</p>`}
        ${deep.length ? `<div class="deep">
          <label class="check" for="mm"><input id="mm" type="checkbox" ${S.mapMore ? "checked" : ""}> More papers on ${esc(st.title.toLowerCase())}: ${deep.length} from the DEEP-PolyU graph-memory list, in that list's own categories</label>
          ${S.mapMore ? [...deepGroups.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, ps]) => `<div class="dgroup"><h5>${esc(k)} <span class="dim">${ps.length}</span></h5>
            <div class="leaves">${orderPapers(ps).map(p => `<a class="leaf paper" href="${esc(p.url || "#")}" target="_blank" rel="noopener" title="${esc(p.title)}">${esc(short(p.title))}${p.venue ? `<span class="lv">${esc(venueTag(p.venue))}</span>` : ""}</a>`).join("")}</div></div>`).join("") : ""}
        </div>` : ""}
      </section>
    </div>`;

  main.querySelectorAll(".mstage").forEach(b => b.addEventListener("click", () => { S.mapStage = b.dataset.stage; S.mapHi = null; render(); }));
  main.querySelectorAll("[data-hi]").forEach(b => b.addEventListener("click", () => { S.mapHi = S.mapHi === b.dataset.hi ? null : b.dataset.hi; render(); }));
  main.querySelectorAll("[data-track]").forEach(b => b.addEventListener("click", () => {
    const t = b.dataset.track;
    if (!t) S.meta.track = new Set(); else toggleFacet("m:track", t);
    render();
  }));
  $("#msort", main)?.addEventListener("change", e => { S.sort = e.target.value; render(); });
  $("#mm", main)?.addEventListener("change", e => { S.mapMore = e.target.checked; render(); });
  main.querySelectorAll("button.leaf").forEach(b => {
    b.addEventListener("click", () => { hideTip(); S.mapOpen = S.mapOpen === b.dataset.sys ? null : b.dataset.sys; render(); });
    b.addEventListener("mouseenter", () => main.querySelectorAll(`.leaf[data-sys="${CSS.escape(b.dataset.sys)}"]`).forEach(x => x.classList.add("same")));
    b.addEventListener("mouseleave", () => main.querySelectorAll(".leaf.same").forEach(x => x.classList.remove("same")));
  });
  main.querySelector("[data-close]")?.addEventListener("click", () => { S.mapOpen = null; render(); });
  main.querySelectorAll("[data-jump]").forEach(b => b.addEventListener("click", () => {
    S.mapStage = b.dataset.jump; S.mapHi = null; render();
    document.querySelector(".leaf.open")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }));
  requestAnimationFrame(drawWires);
  document.fonts?.ready.then(() => S.view === "map" && drawWires());
}

function drawWires() {
  const root = $("#map");
  if (!root) return;
  const svg = root.querySelector("svg.wires");
  const R = root.getBoundingClientRect();
  svg.setAttribute("width", root.scrollWidth);
  svg.setAttribute("height", root.scrollHeight);
  const from = root.querySelector('.mstage[aria-pressed="true"]');
  if (!from || getComputedStyle(svg).display === "none") { svg.innerHTML = ""; return; }
  const mid = r => r.top + Math.min(r.height, 44) / 2 - R.top;
  const curve = (x1, y1, x2, y2) => { const k = Math.max(24, (x2 - x1) / 2); return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`; };
  const f = from.getBoundingClientRect();
  let d = "";
  root.querySelectorAll(".l1").forEach(block => {
    const a = block.querySelector(".l1n").getBoundingClientRect();
    d += curve(f.right - R.left, f.top + f.height / 2 - R.top, a.left - R.left, mid(a));
    block.querySelectorAll(".l2").forEach(row => {
      const n = row.querySelector(".l2n").getBoundingClientRect(), lv = row.querySelector(".leaves").getBoundingClientRect();
      const ghost = row.querySelector(".l2n.ghost");
      if (!ghost) d += curve(a.right - R.left, mid(a), n.left - R.left, mid(n));
      const sx = ghost ? a.right - R.left : n.right - R.left, sy = ghost ? mid(a) : mid(n);
      d += `M${sx},${sy} L${lv.left - R.left - 3},${sy}`;
    });
  });
  svg.innerHTML = `<path d="${d}" class="w"/>`;
}
window.addEventListener("resize", () => S.view === "map" && drawWires());

/* ---------------- Systems ---------------- */
function viewSystems(main) {
  const list = sortSystems(filteredSystems());
  const groups = DESIGN.filter(g => shownGroups.has(g[0]));
  const nCols = 2 + groups.reduce((n, g) => n + g[3].length, 0);
  const rows = list.map(s => `
    <tr class="click" data-sys="${esc(s.id)}" tabindex="0">
      <td class="name sticky">${esc(s.name)}<small>${esc(venueYear(s.paper))}${s.paper?.track ? ` · ${esc(s.paper.track)}` : ""}${figureLink(s)}</small></td>
      ${groups.map(([g, , , fields]) => fields.map(([f], i) => designCell(s, g, f, i === 0)).join("")).join("")}
      <td class="num">${resultSummary(s.id)}</td>
    </tr>`).join("");
  main.innerHTML = `
    <p class="lede">Each memory system described <b>stage by stage</b>: how memory is written, organised, changed, read and used, and <b>who makes the decision</b> at each stage (a fixed rule, a prompted LLM, an agent's tool calls, a trained policy, or feedback). A dash means the paper does not say. Use the filters to slice by any tag, and hide groups you don't need.</p>
    <div class="cols">${systemRail()}
      <section>
        <div class="meta"><span>${list.length} of ${A.systems.length} systems · ${sortSelect("ssort")}</span><span>All entries are extracted from the papers and not yet checked line by line by a person</span></div>
        <div class="groupbar" role="group" aria-label="Column groups">${DESIGN.map(([g, label]) => `<button class="chip" data-group="${g}" aria-pressed="${shownGroups.has(g)}">${label}</button>`).join("")}</div>
        <div class="scroll"><table class="design">
          <thead>
            <tr><th rowspan="2" class="sticky">System</th>${groups.map(([g, label, sub, fields]) => `<th colspan="${fields.length}" class="grp g-${g}">${label}<span>${sub}</span></th>`).join("")}<th rowspan="2" class="num" title="How many scores are recorded for this system, counting every paper, benchmark, question category and metric. A count, not a performance score.">Recorded<br>results</th></tr>
            <tr>${groups.map(([g, , , fields]) => fields.map(([, l], i) => `<th class="${i === 0 ? "gstart" : ""}">${l}</th>`).join("")).join("")}</tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="${nCols}" class="empty-state">No system matches these filters.</td></tr>`}</tbody>
        </table></div>
      </section>
    </div>`;
  bindSystemRail(main);
  bindRowOpen(main);
  main.querySelectorAll("[data-group]").forEach(b => b.addEventListener("click", () => {
    const g = b.dataset.group;
    if (shownGroups.has(g)) { if (shownGroups.size > 1) shownGroups.delete(g); } else shownGroups.add(g);
    try { localStorage.setItem("atlas.groups", JSON.stringify([...shownGroups])); } catch (_) { /* storage blocked */ }
    render();
  }));
}

function bindRowOpen(main) {
  main.querySelectorAll("[data-sys]").forEach(tr => {
    const open = () => openSystem(tr.dataset.sys);
    tr.addEventListener("click", e => { if (!e.target.closest("a")) open(); });
    tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
  });
}

/* ---------------- Pipeline ---------------- */
function viewPipeline(main) {
  const list = filteredSystems();
  const stages = A.stages;
  const cover = st => A.systems.filter(s => (s.stages || {})[st]).length;
  main.innerHTML = `
    <p class="lede">The same systems read along the <b>memory pipeline</b>. Each cell says what that system contributes at that stage; hatched cells mean the paper adds nothing there. Click a stage header to keep only the systems that contribute to it.</p>
    <div class="stagebar">${stages.map(st => `<div><b>${STAGE_LABEL[st][0]}</b>${STAGE_LABEL[st][1]} · ${cover(st)} systems</div>`).join("")}</div>
    <div class="cols">${systemRail()}
      <section>
        <div class="meta"><span>${list.length} systems${S.stage ? ` contributing to ${STAGE_LABEL[S.stage][0].toLowerCase()}` : ""}</span></div>
        <div class="scroll"><table class="pipe">
          <thead><tr><th>System</th>${stages.map(st => `<th class="stage" data-stage="${st}" aria-pressed="${S.stage === st}" tabindex="0">${STAGE_LABEL[st][0]}</th>`).join("")}</tr></thead>
          <tbody>${list.map(s => `<tr class="click" data-sys="${esc(s.id)}" tabindex="0"><td class="name">${esc(s.name)}</td>${stages.map(st => {
            const t = (s.stages || {})[st];
            return t ? `<td><div class="clamp">${esc(t)}</div></td>` : `<td class="empty" aria-label="no contribution"></td>`;
          }).join("")}</tr>`).join("") || `<tr><td colspan="8" class="empty-state">No system matches these filters.</td></tr>`}</tbody>
        </table></div>
      </section>
    </div>`;
  bindSystemRail(main);
  bindRowOpen(main);
  main.querySelectorAll("th.stage").forEach(th => {
    const t = () => { S.stage = S.stage === th.dataset.stage ? null : th.dataset.stage; render(); };
    th.addEventListener("click", t);
    th.addEventListener("keydown", e => { if (e.key === "Enter") t(); });
  });
}

/* ---------------- Results ---------------- */
function reporterShort(id) {
  const r = A.reporters.find(x => x.id === id);
  if (!r) return id;
  const t = (r.title || id).split(/[:–—]/)[0].trim();
  return t.length > 34 ? t.slice(0, 32) + "…" : t;
}

/* Link to the table a row cites: the arXiv PDF at the captured page when known, else the paper.
   Hover or keyboard focus shows the captured image of the table (see scripts/capture_tables.py). */
function sourceLink(r) {
  const rep = A.reporters.find(x => x.id === r.reporter) || {};
  const base = rep.arxiv ? `https://arxiv.org/pdf/${rep.arxiv}` : rep.url;
  if (!base) return esc(r.location || "");
  const href = base + (rep.arxiv && r.table_page ? `#page=${r.table_page}` : "");
  return `<a class="src" href="${esc(href)}" target="_blank" rel="noopener" data-img="${esc(r.table_img || "")}" data-page="${r.table_page || ""}" data-label="${esc((reporterShort(r.reporter)) + ", " + (r.location || "source"))}">${esc(r.location || "source")}<span aria-hidden="true"> ↗</span></a>`;
}

let tipEl = null;
function showTip(a) {
  hideTip();
  tipEl = document.createElement("div");
  tipEl.className = "tip";
  tipEl.setAttribute("role", "tooltip");
  const img = a.dataset.img;
  tipEl.innerHTML = a.dataset.note != null
    ? `<div class="tipnote"><b>${esc(a.dataset.label || "")}</b>${esc(a.dataset.note || "Not stated in the paper.")}</div>`
    : img
    ? `<img src="${esc(img)}" alt="${esc(a.dataset.label)} as printed in the paper"><div class="tipcap">${esc(a.dataset.label)}${a.dataset.page ? ` · page ${esc(a.dataset.page)} of the PDF. Click to open the paper at that page.` : ". Click to open the full image."}</div>`
    : `<div class="tipcap">${esc(a.dataset.label)}. No image of this table has been captured yet. Click to open the paper.</div>`;
  document.body.append(tipEl);
  const place = () => {
    if (!tipEl) return;
    const b = a.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let top = b.bottom + 8;
    if (top + t.height > vh - 8 && b.top - t.height - 8 > 8) top = b.top - t.height - 8;
    const left = Math.max(8, Math.min(b.left, vw - t.width - 8));
    tipEl.style.top = `${Math.max(8, top)}px`;
    tipEl.style.left = `${left}px`;
  };
  place();
  tipEl.querySelector("img")?.addEventListener("load", place);
}
function hideTip() { tipEl?.remove(); tipEl = null; }
const TIP_SEL = "a.src, [data-note]";
document.addEventListener("mouseover", e => { const a = e.target.closest?.(TIP_SEL); if (a) showTip(a); });
document.addEventListener("mouseout", e => { const a = e.target.closest?.(TIP_SEL); if (a && !a.contains(e.relatedTarget)) hideTip(); });
document.addEventListener("focusin", e => { const a = e.target.closest?.(TIP_SEL); a ? showTip(a) : hideTip(); });
document.addEventListener("click", e => { if (e.target.closest?.("a.src")) { e.stopPropagation(); hideTip(); } }, true);
window.addEventListener("scroll", hideTip, { passive: true });

function resultColumns(rows) {
  const cols = new Map();
  for (const r of rows) {
    const key = [r.reporter, r.setting_key, r.memory_model || "", r.location || ""].join("§");
    if (!cols.has(key)) cols.set(key, { key, reporter: r.reporter, setting: r.setting_key, unknown: r.unknown_settings, sample: r, rows: [] });
    cols.get(key).rows.push(r);
  }
  const list = [...cols.values()];
  // comparable groups: identical, fully known settings across different columns
  const bySetting = new Map();
  for (const c of list) if (!c.unknown.length) (bySetting.get(c.setting) || bySetting.set(c.setting, []).get(c.setting)).push(c);
  let g = 0;
  for (const cs of bySetting.values()) if (cs.length > 1) { const L = String.fromCharCode(65 + g++); cs.forEach(c => (c.group = L)); }
  list.sort((a, b) => (!a.group - !b.group) || (a.group || "").localeCompare(b.group || "") || a.reporter.localeCompare(b.reporter));
  return list;
}

function viewResults(main) {
  if (!A.results.length) { main.innerHTML = `<p class="empty-state">No results recorded yet.</p>`; return; }
  const benches = [...new Set(A.results.map(r => r.benchmark))];
  const inBench = A.results.filter(r => r.benchmark === S.bench);
  const metrics = [...new Set(inBench.map(r => r.metric))];
  if (!metrics.includes(S.metric)) S.metric = metrics.includes("llm-judge") ? "llm-judge" : metrics[0];
  const inMetric = inBench.filter(r => r.metric === S.metric);
  const cats = [...new Set(inMetric.map(r => r.category || "overall"))].sort((a, b) => (a === "overall" ? -1 : b === "overall" ? 1 : a.localeCompare(b)));
  if (!cats.includes(S.cat)) S.cat = cats[0];
  const versions = [...new Set(inMetric.map(r => r.benchmark_version || "unstated"))];
  if (S.version !== "all" && !versions.includes(S.version)) S.version = "all";
  const rows = inMetric.filter(r => (r.category || "overall") === S.cat
    && (S.version === "all" || (r.benchmark_version || "unstated") === S.version)
    && (S.copied || r.run_by !== "copied"));
  const cols = resultColumns(rows);
  const sysKeys = [...new Set(rows.map(r => r.system + "§" + (r.variant || "")))];
  const cell = (c, sk) => c.rows.find(r => r.system + "§" + (r.variant || "") === sk);
  const colBest = new Map(cols.map(c => [c.key, Math.max(...c.rows.map(r => r.score))]));
  const all = rows.map(r => r.score);
  const lo = Math.max(0, Math.floor(Math.min(...all) / 10) * 10), hi = Math.min(100, Math.ceil(Math.max(...all) / 10) * 10 || 100);
  const sel = S.col && cols.find(c => c.key === S.col) ? S.col : null;
  const bench = A.benchmarks.find(b => b.id === S.bench);

  const sysRows = sysKeys.map(sk => {
    const [id, variant] = sk.split("§");
    const pts = cols.map(c => ({ c, r: cell(c, sk) })).filter(x => x.r);
    const scores = pts.map(x => x.r.score);
    return { sk, id, variant, pts, min: Math.min(...scores), max: Math.max(...scores) };
  }).sort((a, b) => b.pts.length - a.pts.length || b.max - a.max);

  const W = 180, X = v => 6 + ((v - lo) / Math.max(1, hi - lo)) * (W - 12);
  const strip = sr => `<svg class="strip" width="${W}" height="22" viewBox="0 0 ${W} 22" role="img" aria-label="${esc(sysName(sr.id, sr.variant))}: ${fmt(sr.min)} to ${fmt(sr.max)} across ${sr.pts.length} settings">
      <line class="axis" x1="6" x2="${W - 6}" y1="17" y2="17"/>
      ${sr.pts.length > 1 ? `<line class="range" x1="${X(sr.min)}" x2="${X(sr.max)}" y1="9" y2="9"/>` : ""}
      ${sr.pts.map(({ c, r }) => `<circle class="dot${c.key === sel ? " hl" : ""}" cx="${X(r.score)}" cy="9" r="${c.key === sel ? 5.5 : 4.5}"><title>${esc(reporterShort(c.reporter))} · ${esc(r.answer_model || "answer model ?")} · judge ${esc(r.judge || "?")}: ${fmt(r.score)}</title></circle>`).join("")}
    </svg>`;

  const head = cols.map(c => {
    const r = c.sample;
    const unk = c.unknown.length ? `<div class="unk">unstated: ${c.unknown.join(", ").replace(/_/g, " ")}</div>` : "";
    return `<th class="set" data-col="${esc(c.key)}" aria-pressed="${c.key === sel}" tabindex="0" title="${esc(c.setting)}">
      <b>${esc(reporterShort(c.reporter))}</b>
      ${esc(r.answer_model || "answer model ?")}${r.metric === "llm-judge" ? ` · judge ${esc(r.judge || "?")}` : ""}
      <div class="dim">${esc([r.benchmark_version, r.subset].filter(Boolean).join(" · "))}</div>
      <div>${sourceLink(r)}</div>
      ${c.group ? `<div class="grp">same setting ≡ ${c.group}</div>` : ""}${unk}</th>`;
  }).join("");
  const body = sysRows.map(sr => `<tr>
      <td class="name">${sysById.get(sr.id)?.annotated ? `<a href="#" data-open="${esc(sr.id)}">${esc(sysName(sr.id, sr.variant))}</a>` : esc(sysName(sr.id, sr.variant))}</td>
      <td>${strip(sr)}<div class="num dim" style="text-align:left">${sr.pts.length > 1 ? `${fmt(sr.min)}–${fmt(sr.max)} · ${sr.pts.length} settings` : `1 setting`}</div></td>
      ${cols.map(c => { const r = cell(c, sr.sk); if (!r) return `<td class="sc dim">·</td>`;
        const best = r.score === colBest.get(c.key) && c.rows.length > 1;
        return `<td class="sc${c.key === sel ? " hl" : ""}" title="${esc(RUN_TEXT[r.run_by] || "who ran it is not stated")}${r.notes ? " — " + esc(r.notes) : ""}"><span class="${best ? "best" : ""}">${fmt(r.score)}</span><sup>${RUN_MARK[r.run_by] || "?"}</sup></td>`; }).join("")}
    </tr>`).join("");

  // comparison
  const cmpIds = sysRows.map(s => s.sk);
  if (!cmpIds.includes(S.cmpA)) S.cmpA = cmpIds[0];
  if (!cmpIds.includes(S.cmpB) || S.cmpB === S.cmpA) S.cmpB = cmpIds.find(x => x !== S.cmpA);
  const opt = cur => cmpIds.map(sk => { const [i, v] = sk.split("§"); return `<option value="${esc(sk)}" ${sk === cur ? "selected" : ""}>${esc(sysName(i, v))}</option>`; }).join("");

  main.innerHTML = `
    <p class="lede">Every score a paper reports, <b>kept with the setting it was measured under</b>. Each column is one evaluation setting: one paper, one table, one answering model, one judge. Scores inside a column are comparable. Scores in different columns are comparable only when their settings match exactly (marked <span class="flag ok">≡ A</span>). The strip shows how far one system moves across settings: each dot is the same system scored under a different setting.</p>
    <div class="controls">
      <label for="rb">Benchmark<select id="rb">${benches.map(b => `<option value="${b}" ${b === S.bench ? "selected" : ""}>${esc(A.benchmarks.find(x => x.id === b)?.name || b)}</option>`).join("")}</select></label>
      <label for="rm">Metric<select id="rm">${metrics.map(m => `<option ${m === S.metric ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      <label for="rc">Question category<select id="rc">${cats.map(c => `<option ${c === S.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      <label for="rv">Benchmark version<select id="rv"><option value="all">all versions</option>${versions.map(v => `<option ${v === S.version ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
      <label class="check" for="rcp"><input id="rcp" type="checkbox" ${S.copied ? "checked" : ""}> Include numbers copied from other papers</label>
    </div>
    <div class="meta"><span>${rows.length} scores · ${sysRows.length} systems · ${cols.length} settings${cols.filter(c => c.unknown.length).length ? ` · <span class="flag warn">${cols.filter(c => c.unknown.length).length} with unstated settings</span>` : ""}</span>
      <span>Click a setting to highlight it in the strips</span></div>
    ${rows.length ? `<div class="scroll"><table class="res">
      <thead><tr><th>System</th><th>Spread across settings (${lo}–${hi})</th>${head}</tr></thead>
      <tbody>${body}</tbody></table></div>` : `<p class="empty-state">No scores for this combination.</p>`}
    <div class="legend">
      <span><sup>s</sup> run by the system's own authors</span>
      <span><sup>r</sup> re-run by the reporting paper</span>
      <span><sup>c</sup> copied from another paper</span>
      <span><b>bold</b> best in its column</span>
      <span><span class="flag warn">unstated</span> the paper does not say, so this column cannot be matched with others</span>
    </div>
    ${cmpIds.length > 1 ? `<section class="cmp">
      <h3>Head-to-head: only where both were scored under one setting</h3>
      <div class="controls">
        <label for="ca">System A<select id="ca">${opt(S.cmpA)}</select></label>
        <label for="cb">System B<select id="cb">${opt(S.cmpB)}</select></label>
      </div>
      <div id="cmpout">${compare(cols, cell)}</div>
    </section>` : ""}
    ${bench?.pitfalls?.length ? `<section class="cmp"><h3>Before comparing ${esc(bench.name)} numbers</h3><ul class="prose">${bench.pitfalls.map(p => `<li>${esc(p)}</li>`).join("")}</ul></section>` : ""}`;

  const on = (id, f) => $(id, main)?.addEventListener("change", e => { f(e.target); render(); });
  on("#rb", t => { S.bench = t.value; S.col = null; S.version = "all"; });
  on("#rm", t => { S.metric = t.value; });
  on("#rc", t => { S.cat = t.value; });
  on("#rv", t => { S.version = t.value; });
  on("#rcp", t => { S.copied = t.checked; });
  on("#ca", t => { S.cmpA = t.value; });
  on("#cb", t => { S.cmpB = t.value; });
  main.querySelectorAll("th.set").forEach(th => {
    const t = () => { S.col = S.col === th.dataset.col ? null : th.dataset.col; render(); };
    th.addEventListener("click", t);
    th.addEventListener("keydown", e => { if (e.key === "Enter") t(); });
  });
  main.querySelectorAll("[data-open]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); openSystem(a.dataset.open); }));
}

function compare(cols, cell) {
  const a = S.cmpA, b = S.cmpB;
  if (!a || !b) return "";
  const [ai, av] = a.split("§"), [bi, bv] = b.split("§");
  const na = sysName(ai, av), nb = sysName(bi, bv);
  const same = cols.map(c => ({ c, x: cell(c, a), y: cell(c, b) })).filter(p => p.x && p.y);
  // same fully-known setting, different papers
  const cross = [];
  for (const c1 of cols) for (const c2 of cols) {
    if (c1 === c2 || !c1.group || c1.group !== c2.group) continue;
    const x = cell(c1, a), y = cell(c2, b);
    if (x && y && !cell(c1, b)) cross.push({ c1, c2, x, y });
  }
  if (!same.length && !cross.length) {
    return `<p class="verdict"><span class="flag warn">no shared setting</span> ${esc(na)} and ${esc(nb)} were never scored under the same setting on this view. Any gap between their numbers mixes the systems with the evaluators.</p>`;
  }
  const win = same.filter(p => p.x.score > p.y.score).length;
  const line = (label, x, y) => {
    const d = x.score - y.score;
    return `<tr><td>${label}</td><td class="num">${fmt(x.score)}</td><td class="num">${fmt(y.score)}</td><td class="num">${d > 0 ? "+" : ""}${fmt(d)}</td></tr>`;
  };
  return `
    ${same.length ? `<p class="verdict"><span class="flag ok">${same.length} shared setting${same.length > 1 ? "s" : ""}</span> ${esc(na)} scores higher in ${win} of ${same.length}.</p>` : ""}
    <div class="scroll"><table class="mini"><thead><tr><th>Setting</th><th class="num">${esc(na)}</th><th class="num">${esc(nb)}</th><th class="num">A − B</th></tr></thead><tbody>
      ${same.map(p => line(`${esc(reporterShort(p.c.reporter))} · ${esc(p.x.answer_model || "?")} · judge ${esc(p.x.judge || "–")}`, p.x, p.y)).join("")}
      ${cross.map(p => line(`<span class="flag acc">≡ ${p.c1.group}</span> ${esc(reporterShort(p.c1.reporter))} vs ${esc(reporterShort(p.c2.reporter))} (same setting, different papers)`, p.x, p.y)).join("")}
    </tbody></table></div>`;
}

/* ---------------- Papers ---------------- */
function viewPapers(main) {
  const q = S.pq.trim().toLowerCase();
  const pass = (p, ignore) => {
    if (S.annotatedOnly && !p.system) return false;
    for (const [k, , get] of PAPER_FACETS) {
      if (k === ignore) continue;
      const set = S.pf[k];
      if (set && set.size && !get(p).some(v => set.has(v))) return false;
    }
    if (q && !(p.title + " " + (p.description || "") + " " + (p.arxiv || "")).toLowerCase().includes(q)) return false;
    return true;
  };
  const pyear = p => p.venue?.year || (p.date ? +p.date.slice(0, 4) : 0);
  const pdate = p => p.date || (p.venue?.year ? String(p.venue.year) : "");
  const psorts = { new: (a, b) => pdate(b).localeCompare(pdate(a)), old: (a, b) => (pdate(a) || "9999").localeCompare(pdate(b) || "9999"),
    venue: (a, b) => venueCmp(a.venue, b.venue) || pyear(b) - pyear(a), title: (a, b) => a.title.localeCompare(b.title) };
  const list = A.papers.filter(p => pass(p)).sort(psorts[S.psort] || psorts.new);
  const rail = [`<div><h4>Search</h4><input id="pq" class="search" type="search" placeholder="Title, arXiv id…" value="${esc(S.pq)}"></div>`,
    `<label class="check" for="pa" style="display:flex;gap:6px;align-items:center;font-size:14px"><input id="pa" type="checkbox" ${S.annotatedOnly ? "checked" : ""}> Only systems with full annotation</label>`];
  for (const [k, label, get] of PAPER_FACETS) {
    const pool = A.papers.filter(p => pass(p, k));
    const cnt = new Map();
    for (const p of pool) for (const v of get(p)) cnt.set(v, (cnt.get(v) || 0) + 1);
    const set = S.pf[k] || new Set();
    let vals = [...new Set([...cnt.keys(), ...set])];
    vals.sort(k === "year" ? (a, b) => b.localeCompare(a) : (a, b) => (cnt.get(b) || 0) - (cnt.get(a) || 0));
    if (!vals.length) continue;
    rail.push(`<div><h4>${label}</h4><div class="facet">${vals.map(v => `<button class="chip" data-k="${k}" data-v="${esc(v)}" aria-pressed="${set.has(v)}">${esc(v)}<span class="c">${cnt.get(v) || 0}</span></button>`).join("")}</div></div>`);
  }
  if (q || S.annotatedOnly || Object.values(S.pf).some(s => s.size)) rail.push(`<button class="clear" id="pclear">Clear all filters</button>`);
  const shown = list.slice(0, S.pshown);
  main.innerHTML = `
    <p class="lede">Every entry from four community lists, merged by arXiv id. Each list sorts papers along its own axis, and all of those axes are kept as filters: <b>function and form</b> (Liu et al.), <b>substrate and entry type</b> (TeleAI), <b>pipeline stage</b> for graph memory (DEEP-PolyU), and <b>storage, learning and memory-type tags</b> (yyyujintang).</p>
    <div class="cols"><aside class="rail" aria-label="Filters">${rail.join("")}</aside>
      <section>
        <div class="meta"><span>${list.length} of ${A.papers.length} entries · <label class="sortsel" for="psort">Order by <select id="psort">${[["new", "Newest first"], ["old", "Oldest first"], ["venue", "Venue"], ["title", "Title"]].map(([v, l]) => `<option value="${v}" ${v === S.psort ? "selected" : ""}>${l}</option>`).join("")}</select></label></span><span>Venues come from the DEEP-PolyU list's tags, or from our own record for annotated systems</span></div>
        <div class="plist">${shown.map(p => `
          <div class="pitem">
            <div class="t">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</div>
            <div class="l">
              <span class="tag">${esc(p.kind)}</span>${p.venue ? `<span class="tag ven${p.venue.track === "preprint" ? " pre" : ""}" title="${p.venue.checked ? "Checked against the paper" : "As listed by DEEP-PolyU"}">${esc(venueTag(p.venue))}${p.venue.track !== "main" && p.venue.track !== "preprint" ? "" : p.venue.track === "main" ? " main" : ""}</span>` : ""}${p.date ? `<span class="num">${esc(p.date)}</span>` : ""}
              ${p.arxiv ? `<span class="num">arXiv ${esc(p.arxiv)}</span>` : ""}
              ${p.code ? `<a href="${esc(p.code)}" target="_blank" rel="noopener">code</a>` : ""}
              ${p.system ? `<a href="#" data-open="${esc(p.system)}"><span class="flag acc">annotated · open</span></a>` : ""}
              <span>${[...new Set(p.sources.map(s => SOURCE_NAME[s.list]))].join(", ")}</span>
            </div>
            ${p.description ? `<div class="d">${esc(p.description)}</div>` : ""}
            <div>${Object.entries(p.facets).flatMap(([k, vs]) => vs.map(v => `<span class="tag" title="${esc(k)}">${esc(v)}</span>`)).join("")}</div>
          </div>`).join("") || `<p class="empty-state">No entry matches these filters.</p>`}</div>
        ${list.length > shown.length ? `<div class="more"><button class="btn" id="pmore">Show ${Math.min(60, list.length - shown.length)} more</button></div>` : ""}
      </section></div>`;
  const pq = $("#pq", main);
  pq.addEventListener("input", () => { S.pq = pq.value; S.pshown = 60; const pos = pq.selectionStart; render(); const n = $("#pq"); n.focus(); n.setSelectionRange(pos, pos); });
  $("#pa", main).addEventListener("change", e => { S.annotatedOnly = e.target.checked; S.pshown = 60; render(); });
  $("#psort", main).addEventListener("change", e => { S.psort = e.target.value; render(); });
  main.querySelectorAll(".rail .chip").forEach(b => b.addEventListener("click", () => {
    const set = S.pf[b.dataset.k] || (S.pf[b.dataset.k] = new Set());
    set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v);
    S.pshown = 60; render();
  }));
  $("#pclear", main)?.addEventListener("click", () => { S.pq = ""; S.pf = {}; S.annotatedOnly = false; render(); });
  $("#pmore", main)?.addEventListener("click", () => { S.pshown += 60; render(); });
  main.querySelectorAll("[data-open]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); openSystem(a.dataset.open); }));
}

/* ---------------- Method ---------------- */
function viewMethod(main) {
  const src = Object.entries(A.sources).map(([k, s]) => `<li><a href="https://github.com/${esc(s.repo)}" target="_blank" rel="noopener">${esc(s.repo)}</a>, ${s.entries} entries, pinned at <code>${esc(s.sha.slice(0, 7))}</code></li>`).join("");
  main.innerHTML = `<div class="prose">
    <h2>Why scores are stored with their settings</h2>
    <p>A memory system's benchmark score depends on more than the memory system. The model that writes the answer, the judge model, the judge's prompt, the benchmark version and which questions are kept can each move a LoCoMo score by several points. The same system routinely appears with very different numbers in different papers, and most papers do not report all of these settings.</p>
    <p>This atlas records each score together with the setting it was measured under and treats a missing setting as unknown, never as a default.</p>
    <h3>When two scores are comparable</h3>
    <p>Two scores are marked comparable when all of these are stated and equal: ${A.setting_fields.map(f => `<code>${f}</code>`).join(", ")}. The judge fields only count for LLM-judge metrics. Scores from one table of one paper usually satisfy this. Scores from different papers rarely do, and when they do the Results view marks them with a shared letter.</p>
    <h3>What each record says about who ran it</h3>
    <ul><li><b>s</b>: run by the system's own authors.</li><li><b>r</b>: the reporting paper ran the system itself.</li><li><b>c</b>: the reporting paper copied the number from elsewhere. Copied numbers inherit the original setting, so they often do not match the rest of their table.</li></ul>
    <h3>Status of the annotations</h3>
    <p>System files marked <span class="flag warn">draft</span> were extracted from the papers and not yet checked line by line by a person. Every score points to the table it came from, so any record can be verified.</p>
    <h3>Benchmarks and their traps</h3>
    <div class="bench">${A.benchmarks.map(b => `<article><h4>${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a>` : esc(b.name)}</h4><div>${esc(b.what)}</div>${b.pitfalls?.length ? `<ul>${b.pitfalls.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</div>
    <h3>Paper index sources</h3>
    <ul>${src}</ul>
  </div>`;
}

/* ---------------- drawer ---------------- */
function openSystem(id) {
  const s = sysById.get(id);
  if (!s) return;
  closeDrawer();
  const res = A.results.filter(r => r.system === id && (r.category || "overall") === "overall");
  const nCat = A.results.filter(r => r.system === id).length - res.length;
  const p = s.paper || {};
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const d = document.createElement("aside");
  d.className = "drawer";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-label", s.name);
  d.innerHTML = `
    <button class="x" id="dx">Close</button>
    <div class="sub">${s.verified ? '<span class="flag ok">checked</span>' : '<span class="flag warn">draft</span>'}</div>
    <h2>${esc(s.name)}</h2>
    <div class="sub">${p.title ? `${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}` : "Generic baseline"}${venueYear(p) ? ` · ${esc(venueYear(p))}` : ""}${p.code ? ` · <a href="${esc(p.code)}" target="_blank" rel="noopener">code</a>` : ""}</div>
    ${s.summary ? `<p class="summary">${esc(s.summary)}</p>` : ""}
    ${s.figure ? `<a class="figure" href="${esc(s.figure)}" target="_blank" rel="noopener"><img src="${esc(s.figure)}" alt="${esc(s.name)} system figure from the paper"></a>` : ""}
    ${DESIGN.map(([g, label, sub, fields]) => `<h3>${label} <span class="dim">· ${sub}</span></h3>
    <dl class="kv">${fields.map(([f, l]) => { const v = s.design?.[g]?.[f]; return `<dt>${l}</dt><dd>${v == null || v === "" ? '<span class="dim">not stated</span>' : esc(v)}</dd>`; }).join("")}</dl>`).join("")}
    <h3>Tags</h3>
    <div>${Object.entries(s.tags || {}).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(x => `<span class="tag" title="${esc(TAG_LABEL[k] || k)}">${esc(x)}</span>`)).join("")}</div>
    <h3>Pipeline</h3>
    <div class="stages">${A.stages.map(st => { const t = (s.stages || {})[st]; return `<div class="${t ? "on" : ""}"><b>${STAGE_LABEL[st][0]}</b>${t ? esc(t) : "no contribution"}</div>`; }).join("")}</div>
    <h3>Reported scores, overall (${res.length}${nCat ? `; ${nCat} per-category scores in Results` : ""})</h3>
    ${res.length ? `<div class="scroll"><table class="mini"><thead><tr><th>Benchmark</th><th class="num">Score</th><th>Metric</th><th>Answer model</th><th>Judge</th><th>Reported in</th></tr></thead><tbody>
      ${res.sort((a, b) => a.benchmark.localeCompare(b.benchmark) || b.score - a.score).map(r => `<tr><td>${esc(A.benchmarks.find(b => b.id === r.benchmark)?.name || r.benchmark)}${r.benchmark_version ? ` <span class="dim">${esc(r.benchmark_version)}</span>` : ""}${r.variant ? ` <span class="tag">${esc(r.variant)}</span>` : ""}</td><td class="num">${fmt(r.score)}<sup>${RUN_MARK[r.run_by] || "?"}</sup></td><td>${esc(r.metric)}</td><td>${esc(r.answer_model || "?")}</td><td>${esc(r.judge || (r.metric === "llm-judge" ? "?" : "–"))}</td><td>${esc(reporterShort(r.reporter))}<br>${sourceLink(r)}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="dim">No scores recorded.</p>`}
    ${s.notes ? `<h3>Notes</h3><div class="note">${esc(s.notes)}</div>` : ""}`;
  document.body.append(scrim, d);
  scrim.addEventListener("click", closeDrawer);
  $("#dx", d).addEventListener("click", closeDrawer);
  $("#dx", d).focus();
}
function closeDrawer() { document.querySelectorAll(".scrim, .drawer").forEach(e => e.remove()); }
