"use strict";

const VIEWS = ["taxonomy", "map", "compare", "systems", "pipeline", "results", "papers", "method"];
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
  view: "taxonomy", mapStage: "retrieval", mapMore: false, mapOpen: null, mapHi: null,
  taxQ: "", taxLearn: null, taxLow: true, tz: null, tzPaper: null, tzAllRows: false, tzMode: (() => { try { return localStorage.getItem("atlas.tzMode") || "iso"; } catch (_) { return "iso"; } })(),
  cmpBench: null, cmpMetric: null, cmpAnswer: "any", cmpSort: { key: "median", dir: -1 }, cmpOpen: null, cmpScored: true, cmpBaselines: false, cmpColsOpen: false,
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
  // papers the taxonomy marks as hidden (not about memory, theory) are dropped from every view
  const hidden = hiddenFams();
  A.papers = A.papers.filter(p => !(p.tax && hidden.has(p.tax.family)));
  for (const s of A.systems) sysById.set(s.id, { ...s, annotated: true });
  for (const s of A.extra_systems) if (!sysById.has(s.id)) sysById.set(s.id, { ...s, annotated: false });
  const benches = [...new Set(A.results.map(r => r.benchmark))];
  S.bench = benches.includes("locomo") ? "locomo" : benches[0] || null;
  const h = location.hash.slice(1).split("/");
  if (VIEWS.includes(h[0])) S.view = h[0];
  if (h[0] === "taxonomy") tzFromHash(h.slice(1));
  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("button[data-view]");
    if (b) go(b.dataset.view);
  });
  window.addEventListener("hashchange", () => {
    const parts = location.hash.slice(1).split("/"), v = parts[0];
    if (v === "taxonomy") { tzFromHash(parts.slice(1)); S.view = v; render(); }
    else if (VIEWS.includes(v) && v !== S.view) { S.view = v; render(); }
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
    taxonomy: A.papers.filter(p => p.tax).length, map: "", compare: "", systems: A.systems.length, pipeline: A.systems.length,
    results: A.results.length, papers: A.papers.length, method: "",
  };
  $("#tabs").innerHTML = [["taxonomy", "Taxonomy"], ["map", "Map"], ["compare", "Compare"], ["systems", "Systems"], ["pipeline", "Pipeline"], ["results", "Results"], ["papers", "Papers"], ["method", "Method"]]
    .map(([v, l]) => `<button role="tab" data-view="${v}" aria-selected="${S.view === v}">${l}${counts[v] !== "" ? `<span class="n">${counts[v]}</span>` : ""}</button>`).join("");
  const main = $("#main");
  ({ taxonomy: viewTaxonomy, map: viewMap, compare: viewCompare, systems: viewSystems, pipeline: viewPipeline, results: viewResults, papers: viewPapers, method: viewMethod })[S.view](main);
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
  const parts = [`<div><h4 class="t-label">Search</h4><input id="sq" class="search" type="search" placeholder="Name, mechanism…" value="${esc(S.q)}"></div>`];
  for (const [k, label, get] of META) {
    const pool = filteredSystems("m:" + k);
    const set = S.meta[k] || new Set();
    const cnt = new Map();
    for (const x of pool) for (const v of get(x)) cnt.set(v, (cnt.get(v) || 0) + 1);
    const vals = metaSort([...new Set([...cnt.keys(), ...set])], k);
    if (vals.length) parts.push(`<div><h4 class="t-label">${label}</h4><div class="facet">${vals.map(v => `<button class="chip" data-k="m:${k}" data-v="${esc(v)}" aria-pressed="${set.has(v)}">${esc(v)}<span class="c">${cnt.get(v) || 0}</span></button>`).join("")}</div></div>`);
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
    if (chips) parts.push(`<div><h4 class="t-label">${TAG_LABEL[k]}</h4><div class="facet">${chips}</div></div>`);
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

/* ---------------- Taxonomy ----------------
   The atlas's own families (data/taxonomy.json). Each paper sits in exactly one family, its main
   contribution; families it also touches are shown by highlighting, never by listing it twice.
   Every entry says what it stores and how, written from its abstract, so a paper is recognisable
   without opening it. */
const CONF_TEXT = { high: "mechanism stated in the source", medium: "partly inferred", low: "title only or ambiguous" };
const FORMS = ["token", "parametric", "latent"];
const LEARN_BADGE = { experience: "exp", sft: "SFT", rl: "RL", "model-training": "trained" };
const LEARN_ORDER = ["none", "experience", "sft", "rl", "model-training"];
const learnKey = t => (t.learning === "experience" && (t.learning_also || []).includes("rl") ? "experience-reward" : t.learning || "unlabelled");
const paperYear = p => p.venue?.year || (p.date ? +p.date.slice(0, 4) : null);
const famById = () => new Map(A.taxonomy.groups.flatMap(g => g.families.map(f => [f.id, { ...f, group: g }])));
const hiddenFams = () => new Set(A.taxonomy.groups.flatMap(g => g.families.filter(f => f.hidden).map(f => f.id)));
const rowOfPaper = p => (p.tax.function || [])[0] || "unspecified";

function learnBadge(t) {
  if (!t.learning || t.learning === "none") return "";
  const k = learnKey(t);
  return `<span class="lb lb-${esc(t.learning)}" title="${esc(k === "experience-reward" ? "learns from experience with a reward signal, no weights trained" : (A.taxonomy.learning.find(l => l.id === t.learning)?.name || ""))}">${esc(LEARN_BADGE[t.learning])}${k === "experience-reward" ? "·reward" : ""}</span>`;
}
/* stacked bar of how the papers in a set learn */
function learnMix(list) {
  const n = list.length || 1;
  const c = k => list.filter(p => (p.tax.learning || "none") === k).length;
  return `<span class="lmix" aria-label="${esc(LEARN_ORDER.map(k => `${c(k)} ${k}`).join(", "))}">${LEARN_ORDER.map(k => c(k) ? `<i class="lm-${k}" style="width:${c(k) / n * 100}%" title="${c(k)} ${esc(A.taxonomy.learning.find(l => l.id === k)?.name || k)}"></i>` : "").join("")}</span>`;
}

/* Taxonomy zoom state lives in the hash so the browser's back button zooms out:
   #taxonomy · #taxonomy/c/<form>/<row> · #taxonomy/f/<form>/<row>/<family> · #taxonomy/b/<group> · #taxonomy/bf/<group>/<family> */
function tzFromHash(parts) {
  const [kind, ...r] = parts;
  S.tz = kind === "c" ? { level: 1, form: r[0], row: r[1] }
    : kind === "f" ? { level: 2, form: r[0], row: r[1], fam: r[2] }
    : kind === "b" ? { level: 1, band: r[0] }
    : kind === "bf" ? { level: 2, band: r[0], fam: r[1] }
    : { level: 0 };
  S.tzPaper = null;
}
function tzHash(z) {
  return z.level === 0 ? "taxonomy"
    : z.band ? (z.level === 1 ? `taxonomy/b/${z.band}` : `taxonomy/bf/${z.band}/${z.fam}`)
    : z.level === 1 ? `taxonomy/c/${z.form}/${z.row}` : `taxonomy/f/${z.form}/${z.row}/${z.fam}`;
}
/* zoom: the clicked box and the new view share a view-transition name, so the box grows into the view */
function tzGo(z, from) {
  const apply = () => {
    S.tz = z; S.tzPaper = null; S.taxQ = ""; S.tzAllRows = false;
    try { history.pushState(null, "", "#" + tzHash(z)); } catch (_) { /* sandboxed */ }
    render(); window.scrollTo(0, 0);
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduce || !from) return apply();
  // the name must be unique in the old page: take it off the current level before giving it to the box
  document.querySelectorAll(".tzlevel").forEach(el => { el.style.viewTransitionName = "none"; });
  // SVG shapes cannot carry a transition name, so a box laid over the block stands in for it
  let ghost = null;
  if (from instanceof SVGElement) {
    const r = from.getBoundingClientRect();
    ghost = Object.assign(document.createElement("div"), { className: "tzghost" });
    Object.assign(ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", viewTransitionName: "tz-zoom" });
    document.body.append(ghost);
  } else from.style.viewTransitionName = "tz-zoom";
  hideTip();
  const t = document.startViewTransition(() => { ghost?.remove(); apply(); });
  t.ready.catch(() => {}); t.finished.catch(() => {});
}

function tzPapers() {
  const hidden = hiddenFams();
  return A.papers.filter(p => p.tax && !hidden.has(p.tax.family) && (S.taxLow || p.tax.confidence !== "low"));
}

function tzCrumbs(fams) {
  const z = S.tz, G = id => A.taxonomy.groups.find(g => g.id === id);
  const rowName = r => A.taxonomy.functions.find(f => f.id === r)?.name || "Not stated";
  const items = [["Overview", { level: 0 }]];
  if (z.band) {
    items.push([G(z.band).name, { level: 1, band: z.band }]);
    if (z.level === 2 && G(z.band).families.filter(f => !f.hidden).length > 1) items.push([fams.get(z.fam)?.name, z]);
    else if (z.level === 2) items[items.length - 1] = [G(z.band).name, z];
  } else if (z.level >= 1) {
    items.push([`${G(z.form).name} · ${rowName(z.row)}`, { level: 1, form: z.form, row: z.row }]);
    if (z.level === 2) items.push([fams.get(z.fam)?.name, z]);
  }
  return `<nav class="tzcrumbs" aria-label="Zoom level">${items.map(([l, t], i) => i === items.length - 1
    ? `<span aria-current="page">${esc(l)}</span>` : `<button class="crumb" data-tz='${esc(JSON.stringify(t))}'>${esc(l)}</button><span aria-hidden="true">›</span>`).join("")}
    <span class="tzmode" role="group" aria-label="How to show the map">
      <button class="chip" data-mode="iso" aria-pressed="${S.tzMode === "iso"}">Isometric</button><button class="chip" data-mode="plain" aria-pressed="${S.tzMode === "plain"}">Plain text</button></span>
    <label class="check" for="txl"><input id="txl" type="checkbox" ${S.taxLow ? "checked" : ""}> include low-confidence placements</label></nav>`;
}

/* level 0: the whole map on one screen, as an isometric floor. Columns run along one edge (where memory
   lives), rows along the other (what it is for); each cell is a block whose height grows with its paper count.
   Descriptions appear on hover so the picture stays readable. */
const cellInfo = (f, r) => A.taxonomy.cells?.[`${f}|${r}`] || { text: "", note: "" };
const cellText = (f, r) => [cellInfo(f, r).text, cellInfo(f, r).note].filter(Boolean).join(" ");
function tzOverview(papers, fams) {
  const T = A.taxonomy, G = id => T.groups.find(g => g.id === id);
  const rows = [...T.functions.map(f => ({ id: f.id, name: f.name, def: f.def })), { id: "unspecified", name: "Not stated", def: "The source does not say what the memory is for." }]
    .filter(r => r.id !== "unspecified" || papers.some(p => FORMS.includes(fams.get(p.tax.family)?.group.id) && rowOfPaper(p) === "unspecified"));
  const inCell = (f, r) => papers.filter(p => fams.get(p.tax.family)?.group.id === f && rowOfPaper(p) === r);
  const famList = list => {
    const by = new Map();
    for (const p of list) by.set(p.tax.family, (by.get(p.tax.family) || 0) + 1);
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  };

  // isometric projection
  const C = 118, cx = Math.cos(Math.PI / 6) * C, cy = Math.sin(Math.PI / 6) * C;
  const nI = FORMS.length, nJ = rows.length, maxN = Math.max(...FORMS.flatMap(f => rows.map(r => inCell(f, r.id).length)), 1);
  const ox = nJ * cx + 40, oy = 150;
  const P = (i, j, z = 0) => [ox + (i - j) * cx, oy + (i + j) * cy - z];
  const pts = a => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const W = (nI + nJ) * cx + 120, H = oy + (nI + nJ) * cy + 70, g = 0.09;
  const height = n => (n ? 14 + 86 * Math.sqrt(n / maxN) : 2);
  const cells = [];
  FORMS.forEach((f, i) => rows.forEach((r, j) => cells.push({ f, i, r, j, list: inCell(f, r.id) })));
  cells.sort((a, b) => a.i + a.j - (b.i + b.j) || a.i - b.i);
  const blocks = cells.map(({ f, i, r, j, list }) => {
    const n = list.length, z = height(n);
    const i0 = i + g, i1 = i + 1 - g, j0 = j + g, j1 = j + 1 - g;
    const top = [P(i0, j0, z), P(i1, j0, z), P(i1, j1, z), P(i0, j1, z)];
    const label = `${G(f).name} · ${r.name}`;
    if (!n) return `<g class="blk empty" tabindex="0" data-info="cell|${f}|${r.id}"><polygon class="tp" points="${pts(top)}"/></g>`;
    const right = [P(i1, j0, z), P(i1, j1, z), P(i1, j1, 0), P(i1, j0, 0)];
    const left = [P(i0, j1, z), P(i1, j1, z), P(i1, j1, 0), P(i0, j1, 0)];
    return `<g class="blk f-${f}${r.id === "unspecified" ? " ns" : ""}" tabindex="0" role="button" aria-label="${esc(`${label}, ${n} papers`)}" data-go='${esc(JSON.stringify({ level: 1, form: f, row: r.id }))}' data-info="cell|${f}|${r.id}">
      <polygon class="sl" points="${pts(left)}"/><polygon class="sr" points="${pts(right)}"/><polygon class="tp" points="${pts(top)}"/></g>`;
  }).join("");
  // labels on their own layer above every block, so a front block never hides the numbers behind it
  const labels = cells.filter(c => c.list.length).map(({ f, i, r, j, list }) => {
    const [tx, ty] = P(i + 0.5, j + 0.5, height(list.length));
    const fl = famList(list).slice(0, 2);
    return `<g class="bl" data-for="${f}|${r.id}" transform="translate(${tx.toFixed(1)},${(ty - 8).toFixed(1)})">
      <text class="bn" text-anchor="middle" y="-${fl.length ? 30 : 6}">${list.length}</text>
      ${fl.map(([id, k], x) => `<text class="bf" text-anchor="middle" y="${-12 + x * 14}">${esc(fams.get(id)?.name.replace(/ store$| memory$/i, "") || id)} ${k}</text>`).join("")}</g>`;
  }).join("");
  const floor = FORMS.map((f, i) => `<polygon class="fl f-${f}" points="${pts([P(i, 0), P(i + 1, 0), P(i + 1, nJ), P(i, nJ)])}"/>`).join("")
    + Array.from({ length: nJ + 1 }, (_, j) => `<line class="gl" x1="${P(0, j)[0]}" y1="${P(0, j)[1]}" x2="${P(nI, j)[0]}" y2="${P(nI, j)[1]}"/>`).join("")
    + Array.from({ length: nI + 1 }, (_, i) => `<line class="gl" x1="${P(i, 0)[0]}" y1="${P(i, 0)[1]}" x2="${P(i, nJ)[0]}" y2="${P(i, nJ)[1]}"/>`).join("");
  const formLabels = FORMS.map((f, i) => { const [x, y] = P(i + 0.5, nJ); const list = papers.filter(p => fams.get(p.tax.family)?.group.id === f);
    return `<g class="axl f-${f}" tabindex="0" data-info="form|${f}"><rect x="${x - 78}" y="${y + 16}" width="156" height="30" rx="15"/><text x="${x}" y="${y + 36}" text-anchor="middle">${esc(G(f).name)}</text></g>`; }).join("");
  const rowLabels = rows.map((r, j) => { const [x, y] = P(nI, j + 0.5);
    return `<g class="axl row" tabindex="0" data-info="row|${r.id}"><text x="${x + 22}" y="${y + 24}">${esc(r.name)}</text></g>`; }).join("");
  const bandBox = gid => {
    const gr = G(gid), list = papers.filter(p => fams.get(p.tax.family)?.group.id === gid);
    return `<button class="obox band" data-go='${esc(JSON.stringify({ level: 1, band: gid }))}' data-info="band|${gid}">
      <span class="oh"><b>${esc(gr.name)}</b><span class="bc">${list.length}</span></span>
      <span class="ofams">${famList(list).slice(0, 4).map(([id, k]) => `<span>${esc(fams.get(id)?.name || id)} <b>${k}</b></span>`).join("")}</span></button>`;
  };
  S.tzRows = rows;
  return `<div class="ov3">
    <div class="iso"><svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="Isometric map of memory papers: ${FORMS.map(f => G(f).name).join(", ")} across; ${rows.map(r => r.name).join(", ")} along the side">
      <g class="floor">${floor}</g>${blocks}<g class="labels">${labels}</g>${formLabels}${rowLabels}</svg>
      <div class="ovbands">${bandBox("surveys")}${bandBox("benchmark")}${bandBox("other")}</div></div>
    <aside class="ovpanel" aria-live="polite">${tzPanel(null)}</aside>
  </div>`;
}

/* the panel beside levels 0 and 1: what the hovered block, edge or family is. Details on demand, never covering the map */
function tzPanelPapers() {
  const fams = famById(), papers = tzPapers(), z = S.tz || { level: 0 };
  if (z.level !== 1) return { fams, papers, scope: papers };
  const scope = z.band ? papers.filter(p => fams.get(p.tax.family)?.group.id === z.band)
    : papers.filter(p => fams.get(p.tax.family)?.group.id === z.form && rowOfPaper(p) === z.row);
  return { fams, papers, scope };
}
function tzPanel(info) {
  const T = A.taxonomy, G = id => T.groups.find(g => g.id === id), z = S.tz || { level: 0 };
  const { fams, papers, scope } = tzPanelPapers();
  const rows = S.tzRows || [];
  // a subsection: flush heading, indented body
  const sec = (title, inner) => `<section class="t-sec"><h3 class="t-h3">${esc(title)}</h3><div class="t-indent">${inner}</div></section>`;
  const bars = list => {
    const by = new Map();
    for (const p of list) by.set(p.tax.family, (by.get(p.tax.family) || 0) + 1);
    const max = Math.max(...by.values(), 1);
    return sec("Families", `<ul class="pbars">${[...by.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `<li><span>${esc(fams.get(id)?.name || id)}</span><i style="width:${n / max * 100}%"></i><b>${n}</b></li>`).join("")}</ul>`);
  };
  const learn = list => list.some(p => p.tax.learning) ? sec("How they learn", `${learnMix(list)}<p class="lmleg t-meta">${LEARN_ORDER.map(k => { const n = list.filter(p => (p.tax.learning || "none") === k).length; return n ? `<span><i class="lm-${k}"></i>${esc(T.learning.find(l => l.id === k)?.name || k)} ${n}</span>` : ""; }).join("")}</p>`) : "";
  const head = (title, n, text) => `<h2 class="t-h2">${esc(title)}</h2><p class="t-meta">${n} paper${n === 1 ? "" : "s"}</p><p class="t-body ptext">${esc(text)}</p>`;
  if (!info && z.level === 1) {
    const title = z.band ? G(z.band).name : `${G(z.form).name} · ${T.functions.find(f => f.id === z.row)?.name || "Not stated"}`;
    return head(title, scope.length, z.band ? G(z.band).def : cellText(z.form, z.row)) + bars(scope) + learn(scope);
  }
  if (!info) {
    return `<h2 class="t-h2">Reading the map</h2>
      ${sec("Left edge: where the memory lives", FORMS.map(f => `<p class="t-body"><b>${esc(G(f).name)}</b>. ${esc(G(f).def)}</p>`).join(""))}
      ${sec("Right edge: what it is for", rows.filter(r => r.id !== "unspecified").map(r => `<p class="t-body"><b>${esc(r.name)}</b>: ${esc(r.def || "")}</p>`).join(""))}
      <p class="t-meta ptail">Block height follows the number of papers.</p>`;
  }
  const [kind, a, b] = info.split("|");
  if (kind === "cell") {
    const r = rows.find(x => x.id === b) || {}, list = papers.filter(p => fams.get(p.tax.family)?.group.id === a && rowOfPaper(p) === b);
    return head(`${G(a).name} · ${r.name || b}`, list.length, cellInfo(a, b).text)
      + (cellInfo(a, b).note ? `<p class="pnote t-body">${esc(cellInfo(a, b).note)}</p>` : "") + (list.length ? bars(list) + learn(list) : "");
  }
  if (kind === "form") { const list = papers.filter(p => fams.get(p.tax.family)?.group.id === a); return head(G(a).name, list.length, G(a).def) + bars(list) + learn(list); }
  if (kind === "row") {
    const r = rows.find(x => x.id === a) || {}, list = papers.filter(p => FORMS.includes(fams.get(p.tax.family)?.group.id) && rowOfPaper(p) === a);
    return head(r.name || a, list.length, r.def || "") + bars(list) + learn(list);
  }
  if (kind === "band") { const list = papers.filter(p => fams.get(p.tax.family)?.group.id === a); return head(G(a).name, list.length, G(a).def) + bars(list); }
  // a family inside the zoomed cell
  const f = fams.get(a), list = scope.filter(p => p.tax.family === a);
  const ex = [...list].sort((x, y) => (y.tax.confidence === "high") - (x.tax.confidence === "high") || (paperYear(y) || 0) - (paperYear(x) || 0)).slice(0, 6);
  return head(f.name, list.length, f.def)
    + (f.axes ? sec("Split next by", `<dl class="pax">${f.axes.map(x => `<dt>${esc(x.name)}</dt><dd>${esc(x.def)}</dd>`).join("")}</dl>`) : "")
    + learn(list)
    + sec("Examples", `<ul class="pex">${ex.map(p => `<li><b>${esc(p.tax.name)}</b>${paperYear(p) ? ` <span class="t-meta">${paperYear(p)}</span>` : ""}</li>`).join("")}${list.length > ex.length ? `<li class="t-meta">and ${list.length - ex.length} more</li>` : ""}</ul>`);
}

/* level 1: one cell (or band) opened into its families, drawn as a row of blocks on the same isometric floor.
   Block height follows the family's paper count; hover tells what the family is and how it is split next. */
function tzCell(papers, fams) {
  const z = S.tz, G = id => A.taxonomy.groups.find(g => g.id === id);
  const group = G(z.band || z.form);
  const list = z.band ? papers.filter(p => fams.get(p.tax.family)?.group.id === z.band)
    : papers.filter(p => fams.get(p.tax.family)?.group.id === z.form && rowOfPaper(p) === z.row);
  const fs = group.families.filter(f => !f.hidden).map(f => ({ f, l: list.filter(p => p.tax.family === f.id) }))
    .filter(x => x.l.length).sort((a, b) => b.l.length - a.l.length);
  const head = z.band ? `<h1 class="t-h1">${esc(group.name)}</h1><p class="tzd t-body">${esc(group.def)}</p>`
    : `<h1 class="t-h1">${esc(group.name)} · ${esc(A.taxonomy.functions.find(f => f.id === z.row)?.name || "Not stated")}</h1><p class="tzd t-body">${esc(cellText(z.form, z.row))}</p>`;
  if (!fs.length) return `<div class="tzlevel" style="view-transition-name:tz-zoom">${head}<p class="empty-state">No papers with these filters.</p></div>`;

  // one row of blocks; long rows wrap into a second row so the blocks stay large
  const n = fs.length, perRow = n > 4 ? Math.ceil(n / 2) : n, nRows = Math.ceil(n / perRow);
  const C = n > 4 ? 150 : 170, cx = Math.cos(Math.PI / 6) * C, cy = Math.sin(Math.PI / 6) * C;
  const maxN = Math.max(...fs.map(x => x.l.length));
  const ox = nRows * cx + 40, oy = 190;
  const P = (i, j, zz = 0) => [ox + (i - j) * cx, oy + (i + j) * cy - zz];
  const pts = a => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const W = (perRow + nRows) * cx + 80, H = oy + (perRow + nRows) * cy + 30, g = 0.1;
  const height = k => 18 + 130 * Math.sqrt(k / maxN);
  const form = z.form || "token";
  const cells = fs.map((x, k) => ({ ...x, i: k % perRow, j: Math.floor(k / perRow) })).sort((a, b) => a.i + a.j - (b.i + b.j) || a.i - b.i);
  const blocks = cells.map(({ f, l, i, j }) => {
    const zz = height(l.length), i0 = i + g, i1 = i + 1 - g, j0 = j + g, j1 = j + 1 - g;
    const top = [P(i0, j0, zz), P(i1, j0, zz), P(i1, j1, zz), P(i0, j1, zz)];
    const right = [P(i1, j0, zz), P(i1, j1, zz), P(i1, j1, 0), P(i1, j0, 0)];
    const left = [P(i0, j1, zz), P(i1, j1, zz), P(i1, j1, 0), P(i0, j1, 0)];
    return `<g class="blk f-${form}" tabindex="0" role="button" aria-label="${esc(`${f.name}, ${l.length} papers`)}" data-go='${esc(JSON.stringify({ ...z, level: 2, fam: f.id }))}' data-info="fam|${f.id}">
      <polygon class="sl" points="${pts(left)}"/><polygon class="sr" points="${pts(right)}"/><polygon class="tp" points="${pts(top)}"/></g>`;
  }).join("");
  // family names wrap onto two lines at the nearest space to the middle
  const wrap = t => { if (t.length < 18) return [t]; const m = t.length / 2; let k = -1, best = 1e9;
    for (let x = 0; x < t.length; x++) if (t[x] === " " && Math.abs(x - m) < best) { best = Math.abs(x - m); k = x; }
    return k < 0 ? [t] : [t.slice(0, k), t.slice(k + 1)]; };
  const labels = cells.map(({ f, l, i, j }) => {
    const [tx, ty] = P(i + 0.5, j + 0.5, height(l.length)), lines = wrap(f.name);
    return `<g class="bl" data-for="${f.id}" transform="translate(${tx.toFixed(1)},${(ty - 10).toFixed(1)})">
      <text class="bn bn2" text-anchor="middle" y="${-22 - lines.length * 20}">${l.length}</text>
      ${lines.map((t, x) => `<text class="bf bf2" text-anchor="middle" y="${-8 - (lines.length - 1 - x) * 20}">${esc(t)}</text>`).join("")}</g>`;
  }).join("");
  const floor = `<polygon class="fl f-${form}" points="${pts([P(0, 0), P(perRow, 0), P(perRow, nRows), P(0, nRows)])}"/>`
    + Array.from({ length: nRows + 1 }, (_, j) => `<line class="gl" x1="${P(0, j)[0]}" y1="${P(0, j)[1]}" x2="${P(perRow, j)[0]}" y2="${P(perRow, j)[1]}"/>`).join("")
    + Array.from({ length: perRow + 1 }, (_, i) => `<line class="gl" x1="${P(i, 0)[0]}" y1="${P(i, 0)[1]}" x2="${P(i, nRows)[0]}" y2="${P(i, nRows)[1]}"/>`).join("");
  return `<div class="tzlevel" style="view-transition-name:tz-zoom">${head}
    <div class="ov3"><div class="iso iso2"><svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="${esc(`${fs.length} families: ${fs.map(x => `${x.f.name} ${x.l.length}`).join(", ")}`)}">
      <g class="floor">${floor}</g>${blocks}<g class="labels">${labels}</g></svg></div>
    <aside class="ovpanel" aria-live="polite">${tzPanel(null)}</aside></div></div>`;
}

/* Plain-text versions of levels 0 and 1: the same grid and families as cards with every description
   written out, for reading rather than scanning. Chosen with the switch in the breadcrumb bar. */
function tzFamiliesText(list, fams) {
  const by = new Map();
  for (const p of list) by.set(p.tax.family, (by.get(p.tax.family) || 0) + 1);
  return `<ul class="plfams">${[...by.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `<li><span>${esc(fams.get(id)?.name || id)}</span><b>${n}</b></li>`).join("")}</ul>`;
}
function tzOverviewPlain(papers, fams) {
  const T = A.taxonomy, G = id => T.groups.find(g => g.id === id);
  const rows = [...T.functions.map(f => ({ id: f.id, name: f.name, def: f.def })), { id: "unspecified", name: "Not stated", def: "The source does not say what the memory is for." }]
    .filter(r => r.id !== "unspecified" || papers.some(p => FORMS.includes(fams.get(p.tax.family)?.group.id) && rowOfPaper(p) === "unspecified"));
  const inCell = (f, r) => papers.filter(p => fams.get(p.tax.family)?.group.id === f && rowOfPaper(p) === r);
  const card = (f, r) => {
    const list = inCell(f, r.id), c = cellInfo(f, r.id);
    const body = `<h3 class="t-h3">${esc(G(f).name.replace(/ memory$/, ""))} · ${esc(r.name)}</h3>
      <p class="t-meta">${list.length} paper${list.length === 1 ? "" : "s"}</p>
      <p class="t-body">${esc(c.text)}</p>${c.note ? `<p class="t-body plnote">${esc(c.note)}</p>` : ""}
      ${list.length ? `${tzFamiliesText(list, fams)}${learnMix(list)}` : ""}`;
    return list.length ? `<button class="plcard f-${f}" data-go='${esc(JSON.stringify({ level: 1, form: f, row: r.id }))}'>${body}</button>` : `<div class="plcard empty">${body}</div>`;
  };
  const band = gid => { const list = papers.filter(p => fams.get(p.tax.family)?.group.id === gid);
    return `<button class="plcard" data-go='${esc(JSON.stringify({ level: 1, band: gid }))}'><h3 class="t-h3">${esc(G(gid).name)}</h3><p class="t-meta">${list.length} papers</p><p class="t-body">${esc(G(gid).def)}</p>${tzFamiliesText(list, fams)}</button>`; };
  return `<div class="plgrid" style="--cols:${FORMS.length}">
      <div></div>${FORMS.map(f => `<div class="plcol"><h2 class="t-h2">${esc(G(f).name)}</h2><p class="t-body">${esc(G(f).def)}</p></div>`).join("")}
      ${rows.map(r => `<div class="plrow"><h2 class="t-h2">${esc(r.name)}</h2><p class="t-body">${esc(r.def || "")}</p></div>${FORMS.map(f => card(f, r)).join("")}`).join("")}
    </div>
    <h2 class="t-h2 plother">Not on the grid</h2>
    <div class="plbands">${band("surveys")}${band("benchmark")}${band("other")}</div>
    <p class="t-meta plleg">How the papers learn: ${LEARN_ORDER.map(k => `<span><i class="lm-${k}"></i>${esc(A.taxonomy.learning.find(l => l.id === k)?.name || k)}</span>`).join(" ")}</p>`;
}
function tzCellPlain(papers, fams) {
  const z = S.tz, G = id => A.taxonomy.groups.find(g => g.id === id);
  const group = G(z.band || z.form);
  const list = z.band ? papers.filter(p => fams.get(p.tax.family)?.group.id === z.band)
    : papers.filter(p => fams.get(p.tax.family)?.group.id === z.form && rowOfPaper(p) === z.row);
  const fs = group.families.filter(f => !f.hidden).map(f => ({ f, l: list.filter(p => p.tax.family === f.id) })).filter(x => x.l.length).sort((a, b) => b.l.length - a.l.length);
  const head = z.band ? `<h1 class="t-h1">${esc(group.name)}</h1><p class="tzd t-body">${esc(group.def)}</p>`
    : `<h1 class="t-h1">${esc(group.name)} · ${esc(A.taxonomy.functions.find(f => f.id === z.row)?.name || "Not stated")}</h1><p class="tzd t-body">${esc(cellText(z.form, z.row))}</p>`;
  const learnLine = l => LEARN_ORDER.map(k => [k, l.filter(p => (p.tax.learning || "none") === k).length]).filter(([, n]) => n)
    .map(([k, n]) => `<span><i class="lm-${k}"></i>${esc(A.taxonomy.learning.find(x => x.id === k)?.name || k)} ${n}</span>`).join("");
  return `<div class="tzlevel" style="view-transition-name:tz-zoom">${head}
    <div class="plfgrid">${fs.map(({ f, l }) => {
      const ex = [...l].sort((a, b) => (b.tax.confidence === "high") - (a.tax.confidence === "high") || (paperYear(b) || 0) - (paperYear(a) || 0)).slice(0, 5);
      return `<button class="plcard f-${z.form || "token"}" data-go='${esc(JSON.stringify({ ...z, level: 2, fam: f.id }))}'>
        <h2 class="t-h2">${esc(f.name)}</h2><p class="t-meta">${l.length} paper${l.length === 1 ? "" : "s"}</p>
        <p class="t-body">${esc(f.def)}</p>
        ${f.axes ? `<section class="t-sec"><h3 class="t-h3">Split next by</h3><div class="t-indent">${f.axes.map(x => `<p class="t-body"><b>${esc(x.name)}</b>: ${esc(x.def)}</p>`).join("")}</div></section>` : ""}
        ${l.some(p => p.tax.learning) ? `<section class="t-sec"><h3 class="t-h3">How they learn</h3><div class="t-indent">${learnMix(l)}<p class="lmleg t-meta">${learnLine(l)}</p></div></section>` : ""}
        <section class="t-sec"><h3 class="t-h3">Examples</h3><div class="t-indent"><p class="t-body">${ex.map(p => esc(p.tax.name)).join(", ")}${l.length > ex.length ? ` <span class="t-meta">and ${l.length - ex.length} more</span>` : ""}</p></div></section>
      </button>`; }).join("")}</div></div>`;
}

/* level 2: a family's papers on the family's own two axes; a paper opens its details beside the grid */
function tzFamily(papers, fams) {
  const z = S.tz, f = fams.get(z.fam);
  if (!f) return `<p class="empty-state">Unknown family.</p>`;
  const q = S.taxQ.trim().toLowerCase();
  let list = papers.filter(p => p.tax.family === f.id);
  const otherRows = z.band ? 0 : list.filter(p => rowOfPaper(p) !== z.row).length;
  if (!z.band && !S.tzAllRows) list = list.filter(p => rowOfPaper(p) === z.row);
  if (S.taxLearn) list = list.filter(p => learnKey(p.tax) === S.taxLearn || (S.taxLearn === "experience" && learnKey(p.tax) === "experience-reward"));
  if (q) list = list.filter(p => [p.title, p.tax.name, p.tax.what, p.tax.unique, p.tax.learns_what].join(" ").toLowerCase().includes(q));
  const ax = f.axes;
  const card = p => `<button class="pcard${S.tzPaper === p.id ? " sel" : ""}" data-paper="${esc(p.id)}" aria-pressed="${S.tzPaper === p.id}">
    <span class="ph"><b>${esc(p.tax.name || p.title)}</b><span class="lv">${esc(p.venue ? venueTag(p.venue) : paperYear(p) || "")}</span>${learnBadge(p.tax)}<span class="conf c-${esc(p.tax.confidence)}" title="${esc(CONF_TEXT[p.tax.confidence] || "")}"></span></span>
    <span class="pu">${esc(p.tax.unique || p.tax.what || p.title)}</span></button>`;
  const sortP = l => [...l].sort((a, b) => (paperYear(b) || 0) - (paperYear(a) || 0) || (a.tax.name || "").localeCompare(b.tax.name || ""));
  let grid;
  if (ax) {
    const xs = ax[0].values.filter(v => list.some(p => p.tax.x === v.id)), ys = ax[1].values.filter(v => list.some(p => p.tax.y === v.id));
    const unplaced = list.filter(p => !ax[0].values.some(v => v.id === p.tax.x) || !ax[1].values.some(v => v.id === p.tax.y));
    grid = `<div class="pgrid" style="--cols:${xs.length}">
      <div class="pcorner"><span>${esc(ax[0].name)} →</span><span>${esc(ax[1].name)} ↓</span></div>
      ${xs.map(v => `<div class="pcol" title="${esc(v.def)}"><b>${esc(v.name)}</b><span>${esc(v.def)}</span></div>`).join("")}
      ${ys.map(yv => `<div class="prow" title="${esc(yv.def)}"><b>${esc(yv.name)}</b><span>${esc(yv.def)}</span></div>
        ${xs.map(xv => { const l = sortP(list.filter(p => p.tax.x === xv.id && p.tax.y === yv.id));
          return `<div class="pcell${l.length ? "" : " empty"}"><span class="pxy">${esc(xv.name)} · ${esc(yv.name)}</span>${l.map(card).join("")}</div>`; }).join("")}`).join("")}
    </div>${unplaced.length ? `<div class="punplaced"><h3 class="t-h3">Not yet placed on this family's axes</h3>${sortP(unplaced).map(card).join("")}</div>` : ""}`;
  } else grid = `<div class="plist">${sortP(list).map(card).join("")}</div>`;
  const sel = list.find(p => p.id === S.tzPaper) || papers.find(p => p.id === S.tzPaper);
  return `<div class="tzlevel" style="view-transition-name:tz-zoom">
    <h1 class="t-h1">${esc(f.name)}</h1><p class="t-meta">${list.length} paper${list.length === 1 ? "" : "s"}</p><p class="tzd t-body">${esc(f.def)}</p>
    ${ax ? `<section class="t-sec tzaxes"><h2 class="t-h2">Split by two axes</h2><div class="tzaxgrid">${ax.map((x, i) => `<div><h3 class="t-h3">${i ? "Rows" : "Columns"}: ${esc(x.name)}</h3><p class="t-body">${esc(x.def)}</p></div>`).join("")}</div></section>` : ""}
    <div class="cmpbar">
      <label class="search" for="txq"><input id="txq" type="search" placeholder="Search in this family" value="${esc(S.taxQ)}"></label>
      <span class="mblabel">Learns by</span>
      <button class="chip" data-learn="" aria-pressed="${!S.taxLearn}">all</button>
      ${["experience", "experience-reward", "sft", "rl", "model-training", "none"].map(k => `<button class="chip" data-learn="${k}" aria-pressed="${S.taxLearn === k}">${k === "none" ? "does not learn" : k === "experience-reward" ? '<span class="lb lb-experience">exp·reward</span>' : `<span class="lb lb-${k}">${LEARN_BADGE[k]}</span>`}</button>`).join("")}
      ${otherRows ? `<label class="check" for="tzall"><input id="tzall" type="checkbox" ${S.tzAllRows ? "checked" : ""}> include ${otherRows} papers of this family from other rows</label>` : ""}
    </div>
    <div class="pwrap${sel ? " withd" : ""}">
      <div class="pmain">${list.length ? grid : `<p class="empty-state">No paper with these filters.</p>`}</div>
      ${sel ? `<aside class="pdetail" aria-label="Paper details">${tzDetail(sel, fams)}</aside>` : ""}
    </div></div>`;
}

function tzDetail(p, fams) {
  const t = p.tax, f = fams.get(t.family), ax = f?.axes;
  const lname = id => A.taxonomy.learning.find(l => l.id === id)?.name || id;
  const val = (i, id) => ax?.[i].values.find(v => v.id === id);
  const sys = p.system && A.systems.find(s => s.id === p.system);
  const sec = (title, inner) => `<section class="t-sec"><h3 class="t-h3">${esc(title)}</h3><div class="t-indent">${inner}</div></section>`;
  return `<button class="dclose" data-close aria-label="Close details">×</button>
    <h2 class="t-h2">${esc(t.name || p.title)} ${learnBadge(t)}</h2>
    <p class="t-meta">${esc([p.venue ? venueTag(p.venue) : null, paperYear(p)].filter(Boolean).join(" · "))}</p>
    <p class="t-body pdtitle">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)} ↗</a>` : esc(p.title)}${p.code ? ` · <a href="${esc(p.code)}" target="_blank" rel="noopener">code ↗</a>` : ""}</p>
    ${t.unique ? sec("What sets it apart", `<p class="t-body">${esc(t.unique)}</p>`) : ""}
    ${t.what ? sec("How it works", `<p class="t-body">${esc(t.what)}</p>`) : ""}
    ${ax ? sec("Where it sits in this family", `<p class="t-body"><b>${esc(ax[0].name)}</b>: ${esc(val(0, t.x)?.name || "not placed")}</p><p class="t-body"><b>${esc(ax[1].name)}</b>: ${esc(val(1, t.y)?.name || "not placed")}</p>`) : ""}
    ${t.learning ? sec("How it learns", `<p class="t-body">${esc(lname(t.learning))}${t.learning_also?.length ? ` + ${esc(t.learning_also.map(lname).join(", "))}` : ""}${t.learns_what ? `: ${esc(t.learns_what)}` : ""}</p>`) : ""}
    ${sec("Where it is filed", `<p class="t-body"><b>Family</b>: ${esc(f?.name || t.family)}${t.also?.length ? `; also ${esc(t.also.map(a => fams.get(a)?.name || a).join(", "))}` : ""}</p>${t.function?.length ? `<p class="t-body"><b>Function</b>: ${esc(t.function.join(", "))}</p>` : ""}
      <p class="t-meta">Placed from its ${esc(t.basis)} · confidence ${esc(t.confidence)}${t.checked ? " · checked by hand" : ""}</p>${t.fit ? `<p class="t-meta">Fits loosely: ${esc(t.fit)}</p>` : ""}`)}
    ${sec("How the source lists file it", `<ul class="txlists">${p.sources.map(s => `<li class="t-body"><span class="t-meta">${esc(SOURCE_NAME[s.list] || s.list)}</span> ${esc(s.section)}</li>`).join("")}</ul>`)}
    ${sys ? `<div class="pdsys"><h3 class="t-h3">Annotated in depth</h3>${sys.mechanism ? mechanismHTML(sys) : `<p class="t-body">${esc(sys.summary || "")}</p>`}<button class="jump" data-profile="${esc(sys.id)}">Open full profile</button></div>` : ""}`;
}

function viewTaxonomy(main) {
  const fams = famById();
  if (!S.tz) S.tz = { level: 0 };
  const papers = tzPapers();
  const z = S.tz;
  main.innerHTML = `${z.level === 0 ? `<p class="lede t-body">Every memory paper in the index, by <b>where the memory lives</b> and <b>what it is for</b>. ${S.tzMode === "plain" ? "Click a card to zoom in." : "Hover a block for what it means; click to zoom in."}</p>` : ""}
    ${tzCrumbs(fams)}
    ${z.level === 0 ? (S.tzMode === "plain" ? tzOverviewPlain(papers, fams) : tzOverview(papers, fams))
      : z.level === 1 ? (S.tzMode === "plain" ? tzCellPlain(papers, fams) : tzCell(papers, fams)) : tzFamily(papers, fams)}`;

  const panel = $(".ovpanel", main);
  if (panel) {
    let cur = null;
    const show = info => { if (info !== cur) { cur = info; panel.innerHTML = tzPanel(info); } };
    main.querySelectorAll("[data-info]").forEach(el => { el.addEventListener("mouseenter", () => show(el.dataset.info)); el.addEventListener("focus", () => show(el.dataset.info)); });
    main.querySelectorAll(".iso svg, .ovbands").forEach(el => el.addEventListener("mouseleave", () => show(null)));
  }
  main.querySelectorAll(".blk[data-go]").forEach(b => {
    const t = JSON.parse(b.dataset.go);
    const lab = main.querySelector(`.bl[data-for="${t.level === 2 ? t.fam : `${t.form}|${t.row}`}"]`);
    const on = () => lab?.classList.add("up"), off = () => lab?.classList.remove("up");
    b.addEventListener("mouseenter", on); b.addEventListener("mouseleave", off); b.addEventListener("focus", on); b.addEventListener("blur", off);
  });
  main.querySelectorAll("g[data-go]").forEach(b => b.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.dispatchEvent(new Event("click")); } }));
  main.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => {
    const t = JSON.parse(b.dataset.go);
    // a band with one family (surveys) opens straight to its papers
    const g = t.band && A.taxonomy.groups.find(x => x.id === t.band);
    const vis = g ? g.families.filter(f => !f.hidden) : [];
    tzGo(t.level === 1 && vis.length === 1 ? { level: 2, band: t.band, fam: vis[0].id } : t, b);
  }));
  main.querySelectorAll("[data-tz]").forEach(b => b.addEventListener("click", () => tzGo(JSON.parse(b.dataset.tz), null)));
  main.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => {
    S.tzMode = b.dataset.mode;
    try { localStorage.setItem("atlas.tzMode", S.tzMode); } catch (_) { /* private mode */ }
    render();
  }));
  $("#txl", main).addEventListener("change", e => { S.taxLow = e.target.checked; render(); });
  const q = $("#txq", main);
  q?.addEventListener("input", () => { S.taxQ = q.value; const pos = q.selectionStart; render(); const n = $("#txq"); n.focus(); n.setSelectionRange(pos, pos); });
  main.querySelectorAll("[data-learn]").forEach(b => b.addEventListener("click", () => { S.taxLearn = b.dataset.learn || null; render(); }));
  $("#tzall", main)?.addEventListener("change", e => { S.tzAllRows = e.target.checked; render(); });
  main.querySelectorAll("[data-paper]").forEach(b => b.addEventListener("click", () => {
    S.tzPaper = S.tzPaper === b.dataset.paper ? null : b.dataset.paper; render();
    if (S.tzPaper && innerWidth < 1100) $(".pdetail")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }));
  main.querySelector("[data-close]")?.addEventListener("click", () => { S.tzPaper = null; render(); });
  main.querySelectorAll("[data-profile]").forEach(b => b.addEventListener("click", () => openSystem(b.dataset.profile)));
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
    <div class="dhead"><h2 class="t-h2">${esc(s.name)}</h2>
      <span class="dim">${esc([p.venue_short && p.venue_short !== "arXiv" ? p.venue_short : null, p.track, p.year].filter(Boolean).join(" · "))}</span>
      ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">paper ↗</a>` : ""}${p.code ? `<a href="${esc(p.code)}" target="_blank" rel="noopener">code ↗</a>` : ""}</div>
    ${s.summary ? `<p class="dsum">${esc(s.summary)}</p>` : ""}
    <div class="dgrid">
      <div>
        <h3 class="t-h3">${esc(st.title)}</h3>
        ${g ? `<dl class="kv">${g[3].map(([f, l]) => { const v = s.design?.[g[0]]?.[f]; return `<dt>${l}</dt><dd>${v == null || v === "" ? '<span class="dim">not stated</span>' : esc(v)}</dd>`; }).join("")}</dl>`
            : `<p>${esc(st.note(s) || "")}</p>`}
        ${s.classify?.note && ["organization", "management", "retrieval"].includes(st.id) ? `<p class="dnote">Placement: ${esc(s.classify.note)}</p>` : ""}
      </div>
      <div>
        <h3 class="t-h3">Where it sits at every stage</h3>
        <ol class="dpath">${MAP_STAGES.map(x => `<li><button class="jump${x.id === st.id ? " cur" : ""}" data-jump="${x.id}">${x.n} ${esc(x.title)}</button> ${pathOf(s, x).map(esc).join(" → ")}</li>`).join("")}</ol>
      </div>
    </div>
    ${s.figure ? `<a class="dfig" href="${esc(s.figure)}" target="_blank" rel="noopener"><img src="${esc(s.figure)}" alt="${esc(s.name)} system figure from the paper"></a>` : ""}
    <h3 class="t-h3">Reported results, overall <span class="t-meta">(${rows.length} of ${nAll} recorded; per-category scores are in Results)</span></h5>
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

  // DEEP-PolyU papers whose first stage in that list is this one (so each shows once), minus annotated systems
  const trackSet = S.meta.track;
  const deep = st.deep ? A.papers.filter(p => (p.facets.deep_stage || [])[0] === st.deep && !p.system
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
    <h1 class="t-h1 page-title">Pipeline map</h1><p class="lede t-body">Pick a stage of the memory pipeline. It spans out in two steps, and <b>each system sits in exactly one place per stage</b>. Click a system to open its details right there; its path through every other stage is listed so you can jump between stages. Highlight a feature to see every system that uses it, wherever it sits.</p>
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
          <h2 class="t-h2 fantitle">${esc(st.title)}</h2>
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
          ${S.mapMore ? [...deepGroups.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, ps]) => `<div class="dgroup"><h3 class="t-h3">${esc(k)} <span class="t-meta">${ps.length}</span></h3>
            <div class="leaves">${orderPapers(ps).map(p => `<a class="leaf paper" href="${esc(p.url || "#")}" target="_blank" rel="noopener" title="${esc(p.title)}">${esc(short(p.title))}${p.venue ? `<span class="lv">${esc(venueTag(p.venue))}</span>` : ""}${p.facets.deep_stage.length > 1 ? `<span class="lv">also ${esc(p.facets.deep_stage.slice(1).join(", "))}</span>` : ""}</a>`).join("")}</div></div>`).join("") : ""}
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

/* ---------------- Compare ----------------
   One row per system, scored on one benchmark at a time. The benchmark, metric and answer model are
   chosen, so the table never mixes incomparable numbers into one column by accident. Design columns
   are chosen by the reader. A row opens the scores behind its numbers, for this benchmark only. */
const CMP_COLS = [
  ["venue", "Venue", s => venueTag(sysVenue(s))],
  ["year", "Year", s => s.paper?.year],
  ["write", "Who writes", s => s.design?.control?.construction],
  ["change", "Who changes", s => s.design?.control?.management],
  ["read", "Who reads", s => s.design?.control?.retrieval],
  ["structure", "Structure", s => s.classify?.structure],
  ["index", "Index", s => s.classify?.index],
  ["management", "Management", s => s.classify?.management],
  ["candidates", "Candidates", s => s.classify?.candidates],
  ["decides", "Final set by", s => s.classify?.decides],
  ["memory_type", "Memory type", s => tagVals(s, "memory_type").join(", ")],
  ["domain", "Scenario", s => tagVals(s, "domain").join(", ")],
  ["learning", "Training", s => s.tags?.learning],
  ["summary", "What is new", s => s.summary],
  ["answer_sees", "Answer sees", s => s.mechanism?.answer_context?.sees ?? s.design?.use?.context],
  ["context_kept", "Context vs dialogue", s => { const c = s.mechanism?.compression?.find(x => x.kept != null); return c ? `${pct(c.kept, c.of)}% (${amount(c)})` : null; }],
];
const CMP_DEFAULT = ["venue", "structure", "candidates", "decides", "answer_sees"];
let cmpCols;
try { cmpCols = new Set(JSON.parse(localStorage.getItem("atlas.cmpCols") || "null") || CMP_DEFAULT); }
catch (_) { cmpCols = new Set(CMP_DEFAULT); }
const median = xs => { const v = [...xs].sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

function cmpRows() {
  const all = A.results.filter(r => (r.category || "overall") === "overall" && r.benchmark === S.cmpBench);
  const metrics = [...new Set(all.map(r => r.metric))].sort((a, b) => all.filter(r => r.metric === b).length - all.filter(r => r.metric === a).length);
  if (!metrics.includes(S.cmpMetric)) S.cmpMetric = metrics[0] || null;
  const inMetric = all.filter(r => r.metric === S.cmpMetric);
  const answers = [...new Set(inMetric.map(r => r.answer_model || "not stated"))].sort((a, b) => inMetric.filter(r => (r.answer_model || "not stated") === b).length - inMetric.filter(r => (r.answer_model || "not stated") === a).length);
  if (S.cmpAnswer !== "any" && !answers.includes(S.cmpAnswer)) S.cmpAnswer = "any";
  const rows = inMetric.filter(r => S.cmpAnswer === "any" || (r.answer_model || "not stated") === S.cmpAnswer);
  return { metrics, answers, rows };
}

function viewCompare(main) {
  const benches = A.benchmarks.filter(b => A.results.some(r => r.benchmark === b.id && (r.category || "overall") === "overall"));
  if (!benches.some(b => b.id === S.cmpBench)) S.cmpBench = benches.some(b => b.id === "locomo") ? "locomo" : benches[0]?.id;
  const { metrics, answers, rows } = cmpRows();
  const byS = new Map();
  for (const r of rows) (byS.get(r.system) || byS.set(r.system, []).get(r.system)).push(r);
  const tset = S.meta.track || new Set();
  const pool = [...A.systems.map(s => sysById.get(s.id)), ...(S.cmpBaselines ? [...sysById.values()].filter(s => !s.annotated) : [])]
    .filter(s => !tset.size || tset.has(s.paper?.track))
    .filter(s => !S.cmpScored || byS.has(s.id));
  const stat = s => {
    const rs = byS.get(s.id) || [], xs = rs.map(r => r.score), own = rs.filter(r => r.run_by === "self").map(r => r.score);
    return xs.length ? { own: own.length ? Math.max(...own) : null, median: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length, papers: new Set(rs.map(r => r.reporter)).size } : { own: null, median: null, min: null, max: null, n: 0, papers: 0 };
  };
  const list = pool.map(s => ({ s, st: stat(s) }));
  const cols = CMP_COLS.filter(([k]) => cmpCols.has(k));
  const key = S.cmpSort.key, dir = S.cmpSort.dir;
  const val = x => (["own", "median", "max", "n"].includes(key) ? x.st[key] : key === "name" ? x.s.name : CMP_COLS.find(c => c[0] === key)?.[2](x.s));
  list.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null || va === "") return vb == null || vb === "" ? a.s.name.localeCompare(b.s.name) : 1;
    if (vb == null || vb === "") return -1;
    return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir || a.s.name.localeCompare(b.s.name);
  });
  const bench = A.benchmarks.find(b => b.id === S.cmpBench);
  const th = (k, label, cls = "", title = "") => {
    const on = key === k;
    return `<th class="${cls}" aria-sort="${on ? (dir > 0 ? "ascending" : "descending") : "none"}"${title ? ` title="${esc(title)}"` : ""}><button class="sorth" data-sort="${k}">${esc(label)}<span class="arr" aria-hidden="true">${on ? (dir > 0 ? "▲" : "▼") : "↕"}</span></button></th>`;
  };
  const ncol = 1 + cols.length + 3;
  const tracks = TRACK_ORDER.filter(t => A.systems.some(s => s.paper?.track === t));
  // range bars share one scale: the lowest to highest score in the table, widened to whole tens
  const scored = list.filter(x => x.st.n);
  const lo = Math.floor(Math.min(...scored.map(x => x.st.min), 100) / 10) * 10, hi = Math.ceil(Math.max(...scored.map(x => x.st.max), lo + 10) / 10) * 10;
  const pos = v => (v - lo) / (hi - lo) * 100;

  main.innerHTML = `
    <h1 class="t-h1 page-title">Compare systems on one benchmark</h1><p class="lede t-body">Pick a benchmark and compare systems on it. <b>Median</b> is taken over every setting that reported the system (different answer models, judges and papers), so it is a rough guide. Fix the answer model to narrow it. <b>Own paper</b> is what the system's authors reported. Click a column to sort, and a row to see the scores behind it.</p>
    <div class="cmpbar">
      <label class="sortsel" for="cb">Benchmark <select id="cb">${benches.map(b => `<option value="${b.id}" ${b.id === S.cmpBench ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
      <label class="sortsel" for="cmx">Metric <select id="cmx">${metrics.map(m => `<option ${m === S.cmpMetric ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
      <label class="sortsel" for="cam">Answer model <select id="cam"><option value="any">any (${answers.length})</option>${answers.map(m => `<option ${m === S.cmpAnswer ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
      <label class="check" for="csc"><input id="csc" type="checkbox" ${S.cmpScored ? "checked" : ""}> only systems with a score</label>
      <label class="check" for="cbl"><input id="cbl" type="checkbox" ${S.cmpBaselines ? "checked" : ""}> include baselines not yet annotated</label>
    </div>
    <div class="cmpbar">
      <span class="mblabel">Track</span>
      <button class="chip" data-track="" aria-pressed="${!tset.size}">all</button>
      ${tracks.map(t => `<button class="chip" data-track="${t}" aria-pressed="${tset.has(t)}">${t}</button>`).join("")}
      <details class="colpick"><summary>Columns <span class="dim">${cols.length} shown</span></summary>
        <div class="colopts">${CMP_COLS.map(([k, l]) => `<label class="check"><input type="checkbox" data-col="${k}" ${cmpCols.has(k) ? "checked" : ""}> ${esc(l)}</label>`).join("")}
        <button class="jump" data-colreset>Reset</button></div></details>
      <span class="mblabel">${list.length} systems · ${scored.reduce((n, x) => n + x.st.n, 0)} scores</span>
    </div>
    ${list.length ? `<div class="scroll"><table class="cmp">
      <thead><tr>${th("name", "System", "sticky")}${cols.map(([k, l]) => th(k, l)).join("")}
        ${th("own", "Own paper", "num", "Score reported by the system's own authors (highest, if they reported several)")}
        ${th("median", "Median", "num", "Median over every setting shown")}
        ${th("max", `Range ${fmt(lo)}–${fmt(hi)}`, "rng", "Lowest to highest score across settings; sorts by the highest")}</tr></thead>
      <tbody>${list.map(({ s, st }) => {
        const open = S.cmpOpen === s.id;
        return `<tr class="click${open ? " open" : ""}" data-row="${esc(s.id)}" tabindex="0" aria-expanded="${open}">
          <td class="name sticky">${esc(s.name)}${s.annotated ? "" : ' <span class="tag">baseline</span>'}</td>
          ${cols.map(([k, , f]) => { const v = f(s); return v == null || v === "" ? '<td class="nd">–</td>' : `<td${k === "summary" ? ' class="wide"' : ""}>${k === "write" || k === "change" || k === "read" ? `<span class="tag">${esc(v)}</span>` : esc(v)}</td>`; }).join("")}
          <td class="num">${st.own == null ? '<span class="dim">–</span>' : fmt(st.own)}</td>
          <td class="num"><b>${st.median == null ? '<span class="dim">–</span>' : fmt(st.median)}</b></td>
          <td class="rng">${st.n ? `<span class="bar" aria-hidden="true"><i style="left:${pos(st.min)}%;width:${Math.max(pos(st.max) - pos(st.min), 1.5)}%"></i></span><span class="num">${st.n > 1 ? `${fmt(st.min)}–${fmt(st.max)}` : fmt(st.min)}</span> <span class="dim">${st.n} score${st.n > 1 ? "s" : ""}, ${st.papers} paper${st.papers > 1 ? "s" : ""}</span>` : '<span class="dim">no score</span>'}</td>
        </tr>${open ? `<tr class="cmpdetail"><td colspan="${ncol}">${cmpDetail(s, byS.get(s.id) || [], bench)}</td></tr>` : ""}`;
      }).join("")}</tbody></table></div>` : `<p class="empty-state">No system has a ${esc(S.cmpMetric || "")} score on ${esc(bench?.name || "")} with these filters.</p>`}`;

  $("#cb", main).addEventListener("change", e => { S.cmpBench = e.target.value; S.cmpOpen = null; render(); });
  $("#cmx", main)?.addEventListener("change", e => { S.cmpMetric = e.target.value; render(); });
  $("#cam", main)?.addEventListener("change", e => { S.cmpAnswer = e.target.value; render(); });
  $("#csc", main).addEventListener("change", e => { S.cmpScored = e.target.checked; render(); });
  $("#cbl", main).addEventListener("change", e => { S.cmpBaselines = e.target.checked; render(); });
  main.querySelectorAll("[data-track]").forEach(b => b.addEventListener("click", () => {
    const t = b.dataset.track;
    if (!t) S.meta.track = new Set(); else toggleFacet("m:track", t);
    render();
  }));
  const saveCols = () => { try { localStorage.setItem("atlas.cmpCols", JSON.stringify([...cmpCols])); } catch (_) { /* private mode */ } };
  main.querySelectorAll("[data-col]").forEach(c => c.addEventListener("change", () => {
    c.checked ? cmpCols.add(c.dataset.col) : cmpCols.delete(c.dataset.col); saveCols(); S.cmpColsOpen = true; render();
  }));
  $("[data-colreset]", main)?.addEventListener("click", () => { cmpCols = new Set(CMP_DEFAULT); saveCols(); S.cmpColsOpen = true; render(); });
  const det = $(".colpick", main);
  if (S.cmpColsOpen) det.open = true;
  det.addEventListener("toggle", () => { S.cmpColsOpen = det.open; });
  main.querySelectorAll("[data-sort]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.sort;
    // numbers start high-to-low, text starts A-to-Z
    S.cmpSort = S.cmpSort.key === k ? { key: k, dir: -S.cmpSort.dir } : { key: k, dir: ["own", "median", "max", "year"].includes(k) ? -1 : 1 };
    render();
  }));
  main.querySelectorAll("tr[data-row]").forEach(tr => {
    const t = () => { S.cmpOpen = S.cmpOpen === tr.dataset.row ? null : tr.dataset.row; render(); };
    tr.addEventListener("click", e => { if (!e.target.closest("a, button")) t(); });
    tr.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === tr) t(); });
  });
  main.querySelectorAll("[data-profile]").forEach(b => b.addEventListener("click", () => openSystem(b.dataset.profile)));
}

/* ---------------- mechanism: how one system works, step by step ----------------
   Rendered from the optional "mechanism" block (schema/SCHEMA.md). Every step carries its source,
   paper section or code line, so a reader can check it. */
const KEPT_CLASS = { verbatim: "k-verb", rewritten: "k-rew", summarized: "k-sum", extracted: "k-ext", derived: "k-der" };
const pct = (a, b) => { const x = a / b * 100; return x < 10 ? x.toFixed(1) : Math.round(x); };
/* "2.3k of ~9k tokens" when the unit is "k tokens", else "2.3 of ~9 <unit>" */
const amount = c => { const k = /^k\b/.test(c.unit || ""), rest = k ? c.unit.slice(1).trim() : c.unit || "";
  return `${c.kept}${k ? "k" : ""} of ~${c.of}${k ? "k" : ""}${rest ? " " + rest : ""}`; };
function msrc(o) {
  if (!o?.src) return "";
  return o.url ? `<a class="msrc" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.src)}<span aria-hidden="true"> ↗</span></a>` : `<span class="msrc">${esc(o.src)}</span>`;
}
function mechCompression(m) {
  return (m.compression || []).map(c => c.kept == null
    ? `<div class="mcomp none"><div class="mcl">${esc(c.what)}</div><div class="dim">${esc(c.basis)} ${msrc(c)}</div></div>`
    : `<div class="mcomp"><div class="mcl">${esc(c.what)}</div>
        <div class="meter" role="img" aria-label="${esc(`${amount(c)}, ${pct(c.kept, c.of)} percent`)}"><i style="width:${Math.max(c.kept / c.of * 100, 0.8)}%"></i></div>
        <div class="mcv"><b>${pct(c.kept, c.of)}%</b> <span class="num">${esc(amount(c))}</span></div>
        <div class="dim mcb">${esc(c.basis)} ${msrc(c)}</div></div>`).join("");
}
function mechSteps(steps) {
  let lastRound = null;
  return `<ol class="msteps">${steps.map(st => {
    const round = st.round != null && st.round !== lastRound ? `<li class="mround">Round ${st.round}${st.round > 1 ? " · only when the check says insufficient" : ""}</li>` : "";
    lastRound = st.round ?? lastRound;
    return `${round}<li class="mstep"><div class="msh"><b>${esc(st.step)}</b>${msrc(st)}</div>
      <div>${esc(st.how)}</div>
      ${st.scores ? `<div class="mscore"><span class="dim">matches on</span> ${esc(st.scores)}</div>` : ""}
      ${st.params ? `<div class="mparams">${Object.entries(st.params).map(([k, v]) => `<span class="tag">${esc(k)} ${esc(v)}</span>`).join("")}</div>` : ""}
      ${st.out ? `<div class="mout">→ ${esc(st.out)}</div>` : ""}
      ${st.note ? `<div class="dim">${esc(st.note)}</div>` : ""}</li>`;
  }).join("")}</ol>`;
}
function mechanismHTML(s) {
  const m = s.mechanism;
  if (!m) return "";
  const ac = m.answer_context;
  return `<div class="mech t-noindent">
    ${m.headline?.length ? `<ul class="mhead">${m.headline.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
    <div class="mgrid">
      <section><h3 class="t-h3">What is stored</h3>
        ${(m.units || []).map(u => `<div class="munit"><div class="muh"><b>${esc(u.name)}</b> <span class="dim">${esc(u.role || "")}</span></div>
          ${u.made_by ? `<div class="dim mby">made by ${esc(u.made_by)}</div>` : ""}
          <table class="mfields"><thead><tr><th>Field</th><th>Kept as</th><th>Used for</th></tr></thead><tbody>
          ${u.fields.map(f => `<tr><td><b>${esc(f.name)}</b><div class="dim">${esc(f.what || "")}</div>${msrc(f)}</td>
            <td><span class="kept ${KEPT_CLASS[f.kept_as] || ""}">${esc(f.kept_as)}</span></td>
            <td>${f.used_for?.length ? f.used_for.map(x => `<span class="tag${x === "answer" ? " use-ans" : ""}">${esc(x)}</span>`).join("") : '<span class="tag unused">not used</span>'}</td></tr>`).join("")}
          </tbody></table></div>`).join("")}
      </section>
      <section>
        ${ac ? `<h3 class="t-h3">What the answer model reads</h3>
        <div class="mans"><div class="mansees">${esc(ac.sees)}</div>
          <code class="mfmt">${esc(ac.format)}</code>
          ${ac.excludes?.length ? `<div class="mexcl"><span class="dim">not included:</span> ${ac.excludes.map(x => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}
          ${ac.note ? `<div class="dim">${esc(ac.note)}</div>` : ""}${msrc(ac)}</div>` : ""}
        ${m.compression?.length ? `<h3 class="t-h3">How much is kept</h3>${mechCompression(m)}` : ""}
      </section>
    </div>
    <div class="mgrid">
      ${m.read?.length ? `<section><h3 class="t-h3">Read path: question to answer</h3>${mechSteps(m.read)}</section>` : ""}
      ${m.write?.length ? `<section><h3 class="t-h3">Write path: dialogue to memory</h3>${mechSteps(m.write)}</section>` : ""}
    </div>
    <div class="mgrid three">
      ${m.numbers?.length ? `<section><h3 class="t-h3">Numbers from the paper</h3><table class="mnums"><tbody>${m.numbers.map(n => `<tr><td>${esc(n.label)}</td><td class="num">${esc(n.value)}</td><td class="dim">${esc(n.src || "")}</td></tr>`).join("")}</tbody></table></section>` : ""}
      ${m.paper_vs_code?.length ? `<section><h3 class="t-h3">Paper vs code</h3>${m.paper_vs_code.map(d => `<div class="mdiff"><b>${esc(d.topic)}</b><div><span class="dim">paper</span> ${esc(d.paper)}</div><div><span class="dim">code</span> ${esc(d.code)}</div>${msrc(d)}</div>`).join("")}</section>` : ""}
      ${m.open_questions?.length ? `<section><h3 class="t-h3">Open questions</h3><ul class="mq">${m.open_questions.map(q => `<li>${esc(q)}</li>`).join("")}</ul></section>` : ""}
    </div>
    ${m.sources ? `<p class="dim msources">Sources: ${esc(m.sources.paper || "")}${m.sources.code ? ` · <a href="${esc(m.sources.code)}" target="_blank" rel="noopener">code at the cited commit ↗</a>` : ""}${m.sources.code_note ? `. ${esc(m.sources.code_note)}` : ""}</p>` : ""}
  </div>`;
}

/* The scores behind one row: this benchmark and metric only, grouped by who ran them. */
function cmpDetail(s, rows, bench) {
  const p = s.paper || {};
  const how = s.annotated && !s.mechanism ? [
    ["Writes", s.design?.construction?.processing],
    ["Stores", [s.design?.organization?.structure, s.design?.organization?.stores].filter(Boolean).join("; ")],
    ["Changes", s.design?.management?.operations],
    ["Reads", [s.design?.retrieval?.candidates, s.design?.retrieval?.selection].filter(Boolean).join("; ")],
    ["Answer sees", s.design?.use?.context],
  ].filter(([, v]) => v) : [];
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const versions = new Set(rows.map(r => `${r.benchmark_version}|${r.subset}`)).size > 1;
  return `<div class="cmpd">
    <div class="cmpd-top">
      <div class="cmpd-about">
        <div class="dhead"><h2 class="t-h2">${esc(s.name)}</h2>
          ${p.url || s.url ? `<a href="${esc(p.url || s.url)}" target="_blank" rel="noopener">paper ↗</a>` : ""}${p.code ? `<a href="${esc(p.code)}" target="_blank" rel="noopener">code ↗</a>` : ""}
          ${s.annotated ? `<button class="jump" data-profile="${esc(s.id)}">Full profile</button>` : ""}</div>
        ${s.summary || s.note ? `<p class="dsum">${esc(s.summary || s.note)}</p>` : ""}
        ${how.length ? `<dl class="kv">${how.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
          <p class="dim">Not yet written up step by step with sources.</p>` : ""}
      </div>
      <div class="cmpd-scores">
        <h3 class="t-h3">${esc(bench?.name || "")} · ${esc(S.cmpMetric || "")}${S.cmpAnswer !== "any" ? ` · ${esc(S.cmpAnswer)}` : ""} <span class="t-meta">${rows.length} score${rows.length === 1 ? "" : "s"}</span></h3>
        ${rows.length ? `<table class="mini"><thead><tr><th class="num">Score</th><th>Answer model</th><th>Judge</th>${versions ? "<th>Version</th>" : ""}<th>Run by</th><th>Reported in</th></tr></thead><tbody>
          ${sorted.map(r => `<tr><td class="num"><b>${fmt(r.score)}</b></td><td>${esc(r.answer_model || "not stated")}${r.variant ? ` <span class="tag">${esc(r.variant)}</span>` : ""}</td><td>${esc(r.judge || (r.metric === "llm-judge" ? "not stated" : "–"))}</td>${versions ? `<td>${esc([r.benchmark_version, r.subset].filter(Boolean).join(" · "))}</td>` : ""}<td>${r.run_by === "self" ? "own authors" : r.run_by === "rerun" ? "re-run" : r.run_by === "copied" ? "copied" : "?"}</td><td>${esc(reporterShort(r.reporter))} · ${sourceLink(r)}</td></tr>`).join("")}
        </tbody></table>` : `<p class="dim">No ${esc(S.cmpMetric || "")} score on ${esc(bench?.name || "")} with these filters.</p>`}
      </div>
    </div>
    ${mechanismHTML(s)}
  </div>`;
}

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
    <h1 class="t-h1 page-title">Systems, stage by stage</h1><p class="lede t-body">Each memory system described <b>stage by stage</b>: how memory is written, organised, changed, read and used, and <b>who makes the decision</b> at each stage (a fixed rule, a prompted LLM, an agent's tool calls, a trained policy, or feedback). A dash means the paper does not say. Use the filters to slice by any tag, and hide groups you don't need.</p>
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
    <h1 class="t-h1 page-title">Pipeline</h1><p class="lede t-body">The same systems read along the <b>memory pipeline</b>. Each cell says what that system contributes at that stage; hatched cells mean the paper adds nothing there. Click a stage header to keep only the systems that contribute to it.</p>
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
    <h1 class="t-h1 page-title">Results, with their settings</h1><p class="lede t-body">Every score a paper reports, <b>kept with the setting it was measured under</b>. Each column is one evaluation setting: one paper, one table, one answering model, one judge. Scores inside a column are comparable. Scores in different columns are comparable only when their settings match exactly (marked <span class="flag ok">≡ A</span>). The strip shows how far one system moves across settings: each dot is the same system scored under a different setting.</p>
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
      <h2 class="t-h2">Head-to-head: only where both were scored under one setting</h2>
      <div class="controls">
        <label for="ca">System A<select id="ca">${opt(S.cmpA)}</select></label>
        <label for="cb">System B<select id="cb">${opt(S.cmpB)}</select></label>
      </div>
      <div id="cmpout">${compare(cols, cell)}</div>
    </section>` : ""}
    ${bench?.pitfalls?.length ? `<section class="cmp"><h2 class="t-h2">Before comparing ${esc(bench.name)} numbers</h2><ul class="prose">${bench.pitfalls.map(p => `<li>${esc(p)}</li>`).join("")}</ul></section>` : ""}`;

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
  const rail = [`<div><h4 class="t-label">Search</h4><input id="pq" class="search" type="search" placeholder="Title, arXiv id…" value="${esc(S.pq)}"></div>`,
    `<label class="check" for="pa" style="display:flex;gap:6px;align-items:center;font-size:14px"><input id="pa" type="checkbox" ${S.annotatedOnly ? "checked" : ""}> Only systems with full annotation</label>`];
  for (const [k, label, get] of PAPER_FACETS) {
    const pool = A.papers.filter(p => pass(p, k));
    const cnt = new Map();
    for (const p of pool) for (const v of get(p)) cnt.set(v, (cnt.get(v) || 0) + 1);
    const set = S.pf[k] || new Set();
    let vals = [...new Set([...cnt.keys(), ...set])];
    vals.sort(k === "year" ? (a, b) => b.localeCompare(a) : (a, b) => (cnt.get(b) || 0) - (cnt.get(a) || 0));
    if (!vals.length) continue;
    rail.push(`<div><h4 class="t-label">${label}</h4><div class="facet">${vals.map(v => `<button class="chip" data-k="${k}" data-v="${esc(v)}" aria-pressed="${set.has(v)}">${esc(v)}<span class="c">${cnt.get(v) || 0}</span></button>`).join("")}</div></div>`);
  }
  if (q || S.annotatedOnly || Object.values(S.pf).some(s => s.size)) rail.push(`<button class="clear" id="pclear">Clear all filters</button>`);
  const shown = list.slice(0, S.pshown);
  main.innerHTML = `
    <h1 class="t-h1 page-title">Paper index</h1><p class="lede t-body">Every entry from four community lists, merged by arXiv id. Each list sorts papers along its own axis, and all of those axes are kept as filters: <b>function and form</b> (Liu et al.), <b>substrate and entry type</b> (TeleAI), <b>pipeline stage</b> for graph memory (DEEP-PolyU), and <b>storage, learning and memory-type tags</b> (yyyujintang).</p>
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
  main.innerHTML = `<div class="prose t-flow">
    <h1 class="t-h1 page-title">Method</h1>
    <h2 class="t-h2">Why scores are stored with their settings</h2>
    <p>A memory system's benchmark score depends on more than the memory system. The model that writes the answer, the judge model, the judge's prompt, the benchmark version and which questions are kept can each move a LoCoMo score by several points. The same system routinely appears with very different numbers in different papers, and most papers do not report all of these settings.</p>
    <p>This atlas records each score together with the setting it was measured under and treats a missing setting as unknown, never as a default.</p>
    <h3 class="t-h3">When two scores are comparable</h3>
    <p>Two scores are marked comparable when all of these are stated and equal: ${A.setting_fields.map(f => `<code>${f}</code>`).join(", ")}. The judge fields only count for LLM-judge metrics. Scores from one table of one paper usually satisfy this. Scores from different papers rarely do, and when they do the Results view marks them with a shared letter.</p>
    <h3 class="t-h3">What each record says about who ran it</h3>
    <ul><li><b>s</b>: run by the system's own authors.</li><li><b>r</b>: the reporting paper ran the system itself.</li><li><b>c</b>: the reporting paper copied the number from elsewhere. Copied numbers inherit the original setting, so they often do not match the rest of their table.</li></ul>
    <h3 class="t-h3">Status of the annotations</h3>
    <p>System files marked <span class="flag warn">draft</span> were extracted from the papers and not yet checked line by line by a person. Every score points to the table it came from, so any record can be verified.</p>
    <h3 class="t-h3">Benchmarks and their traps</h3>
    <div class="bench">${A.benchmarks.map(b => `<article><h4>${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a>` : esc(b.name)}</h4><div>${esc(b.what)}</div>${b.pitfalls?.length ? `<ul>${b.pitfalls.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</div>
    <h3 class="t-h3">Paper index sources</h3>
    <ul>${src}</ul>
    <h2 class="t-h2">Why the screens look the way they do</h2>
    <p>Text levels and spacing follow reading research rather than taste. The full record, with each rule next to the paper it comes from, is in <a href="https://github.com/hanaisreal/agent-memory-atlas/blob/main/docs/DESIGN.md" target="_blank" rel="noopener">docs/DESIGN.md</a>.</p>
    <h3 class="t-h3">Heading levels differ mainly in size, by about a third</h3>
    <p>Size is the strongest cue readers use to place a heading in the hierarchy, and steps of about 20% or more between levels are the ones they reliably tell apart; headings are easier to discriminate when they vary on fewer dimensions (Williams &amp; Spyridakis 1992). Each level here is about 1.33 times the one below it (15, 20, 27 and 36 px), and only size and weight change.</p>
    <h3 class="t-h3">All headings are bold</h3>
    <p>Headings with the greatest typographic weight were the easiest to identify, in print and on screen (Timpany 2025).</p>
    <h3 class="t-h3">Content under a subsection is indented a little</h3>
    <p>Indentation helped comprehension at two to four characters and hurt when deeper (Miara et al. 1983, a study of program text). Content under a subsection heading is indented by about two to three characters; headings stay flush, and there is only one level of indentation.</p>
    <h3 class="t-h3">Every block of a panel has its own heading</h3>
    <p>Signals such as headings improve memory for the information they cue (Lorch 1989), and topic headings speed the processing of topic sentences and improve summaries (Hyönä &amp; Lorch 2004). Readers who scan move from heading to heading when headings stand out (Nielsen Norman Group, layer-cake pattern).</p>
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
    <h2 class="t-h2">${esc(s.name)}</h2>
    <div class="sub">${p.title ? `${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}` : "Generic baseline"}${venueYear(p) ? ` · ${esc(venueYear(p))}` : ""}${p.code ? ` · <a href="${esc(p.code)}" target="_blank" rel="noopener">code</a>` : ""}</div>
    ${s.summary ? `<p class="summary">${esc(s.summary)}</p>` : ""}
    ${s.figure ? `<a class="figure" href="${esc(s.figure)}" target="_blank" rel="noopener"><img src="${esc(s.figure)}" alt="${esc(s.name)} system figure from the paper"></a>` : ""}
    ${s.mechanism ? `<h3 class="t-h3">How it works</h3>${mechanismHTML(s)}` : ""}
    ${DESIGN.map(([g, label, sub, fields]) => `<h3 class="t-h3">${label} <span class="t-meta">· ${sub}</span></h3>
    <dl class="kv">${fields.map(([f, l]) => { const v = s.design?.[g]?.[f]; return `<dt>${l}</dt><dd>${v == null || v === "" ? '<span class="dim">not stated</span>' : esc(v)}</dd>`; }).join("")}</dl>`).join("")}
    <h3 class="t-h3">Tags</h3>
    <div>${Object.entries(s.tags || {}).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(x => `<span class="tag" title="${esc(TAG_LABEL[k] || k)}">${esc(x)}</span>`)).join("")}</div>
    <h3 class="t-h3">Pipeline</h3>
    <div class="stages">${A.stages.map(st => { const t = (s.stages || {})[st]; return `<div class="${t ? "on" : ""}"><b>${STAGE_LABEL[st][0]}</b>${t ? esc(t) : "no contribution"}</div>`; }).join("")}</div>
    <h3 class="t-h3">Reported scores, overall (${res.length}${nCat ? `; ${nCat} per-category scores in Results` : ""})</h3>
    ${res.length ? `<div class="scroll"><table class="mini"><thead><tr><th>Benchmark</th><th class="num">Score</th><th>Metric</th><th>Answer model</th><th>Judge</th><th>Reported in</th></tr></thead><tbody>
      ${res.sort((a, b) => a.benchmark.localeCompare(b.benchmark) || b.score - a.score).map(r => `<tr><td>${esc(A.benchmarks.find(b => b.id === r.benchmark)?.name || r.benchmark)}${r.benchmark_version ? ` <span class="dim">${esc(r.benchmark_version)}</span>` : ""}${r.variant ? ` <span class="tag">${esc(r.variant)}</span>` : ""}</td><td class="num">${fmt(r.score)}<sup>${RUN_MARK[r.run_by] || "?"}</sup></td><td>${esc(r.metric)}</td><td>${esc(r.answer_model || "?")}</td><td>${esc(r.judge || (r.metric === "llm-judge" ? "?" : "–"))}</td><td>${esc(reporterShort(r.reporter))}<br>${sourceLink(r)}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="dim">No scores recorded.</p>`}
    ${s.notes ? `<h3 class="t-h3">Notes</h3><div class="note">${esc(s.notes)}</div>` : ""}`;
  document.body.append(scrim, d);
  scrim.addEventListener("click", closeDrawer);
  $("#dx", d).addEventListener("click", closeDrawer);
  $("#dx", d).focus();
}
function closeDrawer() { document.querySelectorAll(".scrim, .drawer").forEach(e => e.remove()); }
