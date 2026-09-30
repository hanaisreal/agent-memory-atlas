"use strict";

// systems, pipeline, results, papers and method are hidden for now (under review); add them back here to show them
const VIEWS = ["taxonomy", "benchmarks"];
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
const SOURCE_NAME = { liu: "Liu et al.", teleai: "TeleAI", deep: "DEEP-PolyU", yyy: "yyyujintang", manual: "Added by hand" };

let A = null;             // atlas.json
const sysById = new Map();
const S = {               // UI state
  view: "taxonomy",
  taxQ: "", taxLearn: null, taxAccepted: true, tz: null, tzPaper: null, tzAllRows: false, tzStep: null, tzMore: false,
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
fetch("atlas.json", { cache: "no-store" }).then(r => r.json()).then(data => {
  A = data;
  // papers the taxonomy marks as hidden (not about memory, theory) are dropped from every view
  const hidden = hiddenFams();
  A.papers = A.papers.filter(p => !(p.tax && hidden.has(p.tax.family)) && !notStated(p));
  for (const s of A.systems) sysById.set(s.id, { ...s, annotated: true });
  for (const s of A.extra_systems) if (!sysById.has(s.id)) sysById.set(s.id, { ...s, annotated: false });
  const benches = [...new Set(A.results.map(r => r.benchmark))];
  S.bench = benches.includes("locomo") ? "locomo" : benches[0] || null;
  const h = location.hash.slice(1).split("/");
  if (VIEWS.includes(h[0])) S.view = h[0];
  if (h[0] === "taxonomy") tzFromHash(h.slice(1));
  if (h[0] === "benchmarks") bmFromHash(h.slice(1));
  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("button[data-view]");
    if (b) go(b.dataset.view);
  });
  window.addEventListener("hashchange", () => {
    const parts = location.hash.slice(1).split("/"), v = parts[0];
    if (v === "taxonomy") { tzFromHash(parts.slice(1)); S.view = v; render(); }
    else if (v === "benchmarks") { bmFromHash(parts.slice(1)); S.view = v; render(); }
    else if (VIEWS.includes(v) && v !== S.view) { S.view = v; render(); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { hideTip(); closeDrawer(); } });
  render();
}).catch(err => {
  $("#main").innerHTML = `<p class="empty-state">Could not load atlas.json (${esc(err.message)}). Run <code>python3 scripts/build.py</code> and serve the <code>site/</code> folder over HTTP.</p>`;
});

function go(v) {
  S.view = v;
  if (v === "benchmarks") S.tz = { level: 1, band: "benchmark" };
  else if (v === "taxonomy" && S.tz?.band === "benchmark") S.tz = { level: 0 };
  try { history.replaceState(null, "", "#" + v); } catch (_) { /* sandboxed */ }
  render();
  window.scrollTo(0, 0);
}

function render() {
  const counts = {
    taxonomy: A.papers.filter(p => FORMS.includes(groupOf(p)) && (!S.taxAccepted || isAccepted(p))).length, benchmarks: A.papers.filter(p => groupOf(p) === "benchmark" && (!S.taxAccepted || isAccepted(p))).length, systems: A.systems.length, pipeline: A.systems.length,
    results: A.results.length, papers: A.papers.length, method: "",
  };
  $("#tabs").innerHTML = [["taxonomy", "Taxonomy"], ["benchmarks", "Benchmarks"], ["systems", "Systems"], ["pipeline", "Pipeline"], ["results", "Results"], ["papers", "Papers"], ["method", "Method"]].filter(([v]) => VIEWS.includes(v))
    .map(([v, l]) => `<button role="tab" data-view="${v}" aria-selected="${S.view === v}">${l}${counts[v] !== "" ? `<span class="n">${counts[v]}</span>` : ""}</button>`).join("");
  const main = $("#main");
  ({ taxonomy: viewTaxonomy, benchmarks: viewBenchmarks, systems: viewSystems, pipeline: viewPipeline, results: viewResults, papers: viewPapers, method: viewMethod })[S.view](main);
}

/* ---------------- shared system filtering ---------------- */
function tagVals(s, k) { const v = (s.tags || {})[k]; return v == null ? [] : Array.isArray(v) ? v : [v]; }

/* Venue, year and track: filters shared by Map and Systems, plus sort orders. */
const TRACK_ORDER = ["main", "short", "findings", "journal", "workshop", "preprint"];
/* A paper's venue, saying where it comes from: checked by us, looked up in a scholarly database, taken from a
   source list, or not known (then only the year, marked "venue unknown"; it is not a claim that the paper is
   unpublished). */
function venueLabel(p) {
  const v = p.venue, y = paperYear(p);
  if (!v) return y ? `${y} · venue unknown` : "venue unknown";
  const tag = venueTag(v);
  return v.checked ? tag : v.source ? `${tag} · ${v.source}` : `${tag} · from list`;
}
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
/* learning labels come from data/taxonomy.json; "experience" with a reward is shown as its own kind */
const learnName = id => A.taxonomy.learning.find(l => l.id === id)?.name || id;
const REWARD_NAME = "Non-parametric: RL";
/* filter keys: a learning id, "experience-reward", or a whole kind ("static", "non-parametric", "parametric") */
function learnMatch(t, key) {
  const k = learnKey(t), kind = A.taxonomy.learning.find(l => l.id === (t.learning || "none"))?.kind || "static";
  if (key === "non-parametric" || key === "parametric" || key === "static") return kind === key;
  if (key === "experience") return k === "experience";
  return k === key;
}
const LEARN_ORDER = ["none", "experience", "sft", "rl", "model-training"];
const learnKey = t => (t.learning === "experience" && (t.learning_also || []).includes("rl") ? "experience-reward" : t.learning || "unlabelled");
const paperYear = p => p.venue?.year || (p.date ? +p.date.slice(0, 4) : null);
const famById = () => new Map(A.taxonomy.groups.flatMap(g => g.families.map(f => [f.id, { ...f, group: g }])));
const hiddenFams = () => new Set(A.taxonomy.groups.flatMap(g => g.families.filter(f => f.hidden).map(f => f.id)));
const rowOfPaper = p => (p.tax.function || [])[0] || "unspecified";

function learnBadge(t) {
  if (!t.learning || t.learning === "none") return "";
  const k = learnKey(t);
  const name = k === "experience-reward" ? REWARD_NAME : learnName(t.learning);
  return `<span class="lb lb-${esc(t.learning)}" title="${esc(k === "experience-reward" ? A.taxonomy.learning_reward?.def || name : A.taxonomy.learning.find(l => l.id === t.learning)?.def || name)}">${esc(name)}</span>`;
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
/* the Benchmarks tab is the taxonomy's benchmark band on its own: #benchmarks · #benchmarks/<family> */
function bmFromHash(parts) {
  S.tz = parts[0] ? { level: 2, band: "benchmark", fam: parts[0] } : { level: 1, band: "benchmark" };
  S.tzPaper = null;
}
function viewBenchmarks(main) {
  if (S.tz?.band !== "benchmark") S.tz = { level: 1, band: "benchmark" };
  viewTaxonomy(main);
}
function groupOf(p) {
  return p.tax && A.taxonomy.groups.find(g => g.families.some(f => f.id === p.tax.family))?.id;
}
function tzHash(z) {
  if (z.band === "benchmark") return z.level === 2 ? `benchmarks/${z.fam}` : "benchmarks";
  return z.level === 0 ? "taxonomy"
    : z.band ? (z.level === 1 ? `taxonomy/b/${z.band}` : `taxonomy/bf/${z.band}/${z.fam}`)
    : z.level === 1 ? `taxonomy/c/${z.form}/${z.row}` : `taxonomy/f/${z.form}/${z.row}/${z.fam}`;
}
/* zoom: the clicked box and the new view share a view-transition name, so the box grows into the view */
function tzGo(z, from) {
  const apply = () => {
    S.tz = z; S.tzPaper = null; S.taxQ = ""; S.tzAllRows = false;
    S.view = z.band === "benchmark" ? "benchmarks" : "taxonomy";
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
  return A.papers.filter(p => p.tax && !hidden.has(p.tax.family) && (!S.taxAccepted || isAccepted(p)));
}
/* accepted = a named venue (conference, journal, findings or workshop); preprints and unknown venues are not */
function isAccepted(p) {
  return !!p.venue && p.venue.track !== "preprint";
}

function tzCrumbs(fams) {
  const z = S.tz, G = id => A.taxonomy.groups.find(g => g.id === id);
  const rowName = r => A.taxonomy.functions.find(f => f.id === r)?.name || "Not stated";
  const items = z.band === "benchmark" ? [] : [["Overview", { level: 0 }]];
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
    <label class="check" for="txa"><input id="txa" type="checkbox" ${S.taxAccepted ? "checked" : ""}> accepted papers only</label></nav>`;
}

/* level 0: the whole map on one screen, as an isometric floor. Columns run along one edge (where memory
   lives), rows along the other (what it is for); each cell is a block whose height grows with its paper count.
   Descriptions appear on hover so the picture stays readable. */
const cellInfo = (f, r) => A.taxonomy.cells?.[`${f}|${r}`] || { text: "", note: "" };
const cellText = (f, r) => [cellInfo(f, r).text, cellInfo(f, r).note].filter(Boolean).join(" ");
/* Overview edge diagrams: where the memory lives (form) and what it holds (function), drawn with the
   gi-* shapes of the axis icons, 120×60. */
const OV_PICS = {
  token: '<rect class="gi-ev" x="6" y="10" width="22" height="28" rx="2"/><line class="gi-t" x1="10" y1="17" x2="24" y2="17"/><line class="gi-t" x1="10" y1="23" x2="24" y2="23"/><line class="gi-t" x1="10" y1="29" x2="20" y2="29"/><rect class="gi-ev" x="14" y="22" width="22" height="28" rx="2"/><line class="gi-t" x1="18" y1="29" x2="32" y2="29"/><line class="gi-t" x1="18" y1="35" x2="32" y2="35"/><line class="gi-t" x1="18" y1="41" x2="28" y2="41"/><path class="gi-a" d="M42 32 L70 32"/><polygon class="gi-ah" points="70,35.5 76,32 70,28.5"/><rect class="gi-llm" x="80" y="20" width="34" height="24" rx="4"/><text class="gi-lbl" x="97" y="36" text-anchor="middle">LLM</text>',
  parametric: '<rect class="gi-llm" x="22" y="6" width="76" height="48" rx="6"/><text class="gi-lbl" x="60" y="18" text-anchor="middle">LLM</text>' + [0, 1, 2, 3, 4, 5, 6, 7].flatMap(c => [0, 1, 2].map(r => `<rect class="gi-w" x="${32 + c * 7}" y="${24 + r * 7}" width="6" height="6"/>`)).join(""),
  latent: [0, 1, 2, 3].map(r => [0, 1, 2].map(c => `<rect class="gi-v" x="${8 + c * 9}" y="${12 + r * 9}" width="8" height="8"/>`).join("")).join("") + '<path class="gi-a" d="M42 30 L70 30"/><polygon class="gi-ah" points="70,33.5 76,30 70,26.5"/><rect class="gi-llm" x="80" y="18" width="34" height="24" rx="4"/><text class="gi-lbl" x="97" y="34" text-anchor="middle">LLM</text>',
  factual: '<rect class="gi-ev" x="4" y="6" width="112" height="22" rx="4"/><circle class="gi-n" cx="16" cy="17" r="6"/><text class="gi-lbl" x="28" y="21">user: vegan</text><rect class="gi-ev" x="4" y="33" width="112" height="22" rx="4"/><circle class="gi-v" cx="16" cy="44" r="6"/><text class="gi-lbl" x="28" y="48">Paris ∈ France</text>',
  experiential: '<rect class="gi-ev" x="4" y="8" width="36" height="18" rx="3"/><text class="gi-lbl" x="22" y="21" text-anchor="middle">try 1</text><path class="gi-bad" d="M44 12 L52 22 M52 12 L44 22"/><rect class="gi-ev" x="4" y="34" width="36" height="18" rx="3"/><text class="gi-lbl" x="22" y="47" text-anchor="middle">try 2</text><path class="gi-ok" d="M44 44 L48 49 L54 38"/><path class="gi-a" d="M58 30 L68 30"/><polygon class="gi-ah" points="68,33.5 74,30 68,26.5"/><rect class="gi-hi" x="76" y="12" width="42" height="36" rx="4"/><text class="gi-lbl" x="97" y="27" text-anchor="middle">lesson</text><text class="gi-lbl" x="97" y="40" text-anchor="middle">skill</text>',
  working: '<rect class="gi-ev d" x="2" y="4" width="116" height="52" rx="6"/><text class="gi-lbl" x="8" y="16">this task only</text><rect class="gi-f" x="8" y="24" width="30" height="24" rx="3"/><path class="gi-ok" d="M16 36 L21 41 L30 30"/><rect class="gi-f" x="45" y="24" width="30" height="24" rx="3"/><path class="gi-ok" d="M53 36 L58 41 L67 30"/><rect class="gi-hi" x="82" y="24" width="30" height="24" rx="3"/><text class="gi-lbl" x="97" y="40" text-anchor="middle">now</text>',
};
const OV_AXES = { form: "Location of memory", func: "Purpose of memory" };
const OV_WHERE = { token: "outside the model, as text", parametric: "in the weights", latent: "inside, in hidden states" };
const ovPic = (id, x, y, w) => OV_PICS[id] ? `<svg class="axicon ovpic" x="${x}" y="${y}" width="${w}" height="${w / 2}" viewBox="0 0 120 60">${OV_PICS[id]}</svg>` : "";

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
  const W = (nI + nJ) * cx + 200, H = oy + (nI + nJ) * cy + 110, g = 0.09;
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
    return `<g class="axl f-${f}" tabindex="0" data-info="form|${f}"><rect x="${x - 88}" y="${y + 16}" width="176" height="42" rx="12"/><text x="${x}" y="${y + 34}" text-anchor="middle">${esc(G(f).name)}</text><text class="axw" x="${x}" y="${y + 50}" text-anchor="middle">${esc(OV_WHERE[f] || "")}</text></g>`; }).join("")
    + `<text class="axt" x="${(P(0.5, nJ)[0] - 88).toFixed(1)}" y="${(P(nI - 0.5, nJ)[1] + 82).toFixed(1)}">${OV_AXES.form}</text>`;
  const rowLabels = rows.map((r, j) => { const [x, y] = P(nI, j + 0.5);
    return `<g class="axl row" tabindex="0" data-info="row|${r.id}"><text x="${x + 22}" y="${y + 24}">${esc(r.name)}</text></g>`; }).join("")
    + `<text class="axt" x="${(P(nI, 0)[0] + 22).toFixed(1)}" y="${(P(nI, 0)[1] - 4).toFixed(1)}">${OV_AXES.func}</text>`;
  S.tzRows = rows;
  return `<div class="ov3"><svg class="ovcone" aria-hidden="true"><polygon/></svg>
    <div class="iso"><svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="Isometric map of memory papers: ${FORMS.map(f => G(f).name).join(", ")} across; ${rows.map(r => r.name).join(", ")} along the side">
      <g class="floor">${floor}</g>${blocks}<g class="labels">${labels}</g>${formLabels}${rowLabels}</svg></div>
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
/* Hovering a block on the overview shows pictures, not prose: each family in the block with its paper count
   and the diagrams of its types (the values of its first axis), named. */
function cellPictures(form, row, papers, fams, rows) {
  const G = id => A.taxonomy.groups.find(g => g.id === id), r = rows.find(x => x.id === row) || {};
  const list = papers.filter(p => fams.get(p.tax.family)?.group.id === form && rowOfPaper(p) === row);
  const by = new Map();
  for (const p of list) by.set(p.tax.family, (by.get(p.tax.family) || 0) + 1);
  const famBlock = ([id, n]) => {
    const f = fams.get(id), ax = f?.axes?.[0];
    const vals = ax ? ax.values.filter(v => list.some(p => p.tax.family === id && p.tax.x === v.id)) : [];
    return `<div class="cp-fam"><div class="cp-head"><b>${esc(f?.name || id)}</b><span class="t-meta">${n}</span></div>
      ${vals.length ? `<div class="cp-types">${vals.map(v => `<div class="cp-type">${axisIcon(id, ax.id, v.id) || ""}<span>${esc(v.name)}</span></div>`).join("")}</div>` : ""}</div>`;
  };
  return `<div class="cp"><h2 class="t-h2 cp-title">${esc(G(form).name.replace(/ memory$/, ""))} · ${esc(r.name || row)}</h2>
    ${list.length ? [...by.entries()].sort((x, y) => y[1] - x[1]).map(famBlock).join("") : `<p class="t-meta">No papers</p>`}</div>`;
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
  const learn = list => list.some(p => p.tax.learning) ? sec("How they improve", `${learnMix(list)}<p class="lmleg t-meta">${LEARN_ORDER.map(k => { const n = list.filter(p => (p.tax.learning || "none") === k).length; return n ? `<span><i class="lm-${k}"></i>${esc(T.learning.find(l => l.id === k)?.name || k)} ${n}</span>` : ""; }).join("")}</p>`) : "";
  const bigPic = id => OV_PICS[id] ? `<div class="ovbig">${ovPic(id, 0, 0, 240)}</div>` : "";
  const head = (title, n, text) => `<h2 class="t-h2">${esc(title)}</h2><p class="t-meta">${n} paper${n === 1 ? "" : "s"}</p><p class="t-body ptext">${esc(text)}</p>`;
  if (!info && z.level === 1) {
    const title = z.band ? G(z.band).name : `${G(z.form).name} · ${T.functions.find(f => f.id === z.row)?.name || "Not stated"}`;
    return head(title, scope.length, z.band ? G(z.band).def : cellText(z.form, z.row)) + bars(scope) + learn(scope);
  }
  if (!info) {
    return `<h2 class="t-h2">Reading the map</h2>
      ${sec(`${OV_AXES.form} (left edge)`, FORMS.map(f => `<div class="ovdef">${ovPic(f, 0, 0, 96)}<p class="t-body"><b>${esc(G(f).name)}</b> · <i>${esc(OV_WHERE[f] || "")}</i>. ${esc(G(f).def)}</p></div>`).join(""))}
      ${sec(`${OV_AXES.func} (right edge)`, rows.filter(r => r.id !== "unspecified").map(r => `<div class="ovdef">${ovPic(r.id, 0, 0, 96)}<p class="t-body"><b>${esc(r.name)}</b>: ${esc(r.def || "")}</p></div>`).join(""))}
      <p class="t-meta ptail">Block height follows the number of papers.</p>`;
  }
  const [kind, a, b] = info.split("|");
  if (kind === "cell" && z.level === 0) return cellPictures(a, b, papers, fams, rows);
  if (kind === "cell") {
    const r = rows.find(x => x.id === b) || {}, list = papers.filter(p => fams.get(p.tax.family)?.group.id === a && rowOfPaper(p) === b);
    return head(`${G(a).name} · ${r.name || b}`, list.length, cellInfo(a, b).text)
      + (cellInfo(a, b).note ? `<p class="pnote t-body">${esc(cellInfo(a, b).note)}</p>` : "") + (list.length ? bars(list) + learn(list) : "");
  }
  if (kind === "form") { const list = papers.filter(p => fams.get(p.tax.family)?.group.id === a); return head(G(a).name, list.length, `${OV_WHERE[a] ? `${OV_WHERE[a][0].toUpperCase()}${OV_WHERE[a].slice(1)}. ` : ""}${G(a).def}`) + bigPic(a) + bars(list) + learn(list); }
  if (kind === "row") {
    const r = rows.find(x => x.id === a) || {}, list = papers.filter(p => FORMS.includes(fams.get(p.tax.family)?.group.id) && rowOfPaper(p) === a);
    return head(r.name || a, list.length, r.def ? r.def[0].toUpperCase() + r.def.slice(1) : "") + bigPic(a) + bars(list) + learn(list);
  }
  if (kind === "band") { const list = papers.filter(p => fams.get(p.tax.family)?.group.id === a); return head(G(a).name, list.length, G(a).def) + bars(list); }
  // a family inside the zoomed cell
  const f = fams.get(a), list = scope.filter(p => p.tax.family === a);
  const ex = [...list].sort((x, y) => (y.tax.confidence === "high") - (x.tax.confidence === "high") || (paperYear(y) || 0) - (paperYear(x) || 0)).slice(0, 6);
  // pictures of the family's types on each of its two axes, with how many papers of this cell are of each type
  const axisPics = (ax, key) => {
    const vals = ax.values.map(v => [v, list.filter(p => p.tax[key] === v.id).length]).filter(([, n]) => n).sort((x, y) => y[1] - x[1]);
    return vals.length ? sec(ax.name, `<div class="cp-types">${vals.map(([v, n]) => `<div class="cp-type">${axisIcon(a, ax.id, v.id) || ""}<span>${esc(v.name)} <b class="t-meta">${n}</b></span></div>`).join("")}</div>`) : "";
  };
  return head(f.name, list.length, f.def)
    + (f.axes ? f.axes.map((ax, i) => axisPics(ax, i ? "y" : "x")).join("") : "")
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
    <div class="ov3"><svg class="ovcone" aria-hidden="true"><polygon/></svg><div class="iso iso2"><svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="${esc(`${fs.length} families: ${fs.map(x => `${x.f.name} ${x.l.length}`).join(", ")}`)}">
      <g class="floor">${floor}</g>${blocks}<g class="labels">${labels}</g></svg></div>
    <aside class="ovpanel" aria-live="polite">${tzPanel(null)}</aside></div></div>`;
}

/* Small diagrams that stand in for an axis value's written definition in the level-3 table headers
   (data/axis_icons.json, keyed "<family>|<axis>|<value>"; drawn with the gi-* shapes in style.css).
   A value without a drawing keeps its text definition; "not stated" values share one drawing. */
function axisIcon(fam, axis, value) {
  const d = A.axis_icons?.[`${fam}|${axis}|${value}`]
    || (/^not[-_ ]?stated$/.test(value) ? { label: "Not stated", body: '<rect class="gi-ev d" x="30" y="8" width="60" height="44" rx="8"/><text class="gi-q" x="60" y="38" text-anchor="middle">?</text>' } : null);
  return d ? `<svg class="axicon" viewBox="0 0 120 60" role="img" aria-label="${esc(d.label)}">${d.body}</svg>` : "";
}

/* the grouped "what adapts over time" filter: a chip per kind, and inside each kind a chip per value */
function learnFilter(pool) {
  const T = A.taxonomy, count = key => pool.filter(p => learnMatch(p.tax, key)).length;
  const chip = (key, label, cls = "") => { const n = count(key); return n ? `<button class="chip lchip${cls}" data-learn="${key}" aria-pressed="${S.taxLearn === key}" title="${esc(key === "experience-reward" ? T.learning_reward.def : T.learning.find(l => l.id === key)?.def || T.learning_kinds.find(k => k.id === key)?.def || "")}">${label}<span class="c">${n}</span></button>` : ""; };
  const dot = id => `<i class="lm-${id}"></i>`;
  return `<span class="lgroup">${chip("static", dot("none") + "Static")}</span>
    <span class="lgroup"><span class="lgname">Non-parametric</span>${chip("non-parametric", "all", " lall")}${chip("experience", dot("experience") + "lessons")}${chip("experience-reward", dot("experience") + "RL")}</span>
    <span class="lgroup"><span class="lgname">Parametric</span>${chip("parametric", "all", " lall")}${chip("sft", dot("sft") + "SFT")}${chip("rl", dot("rl") + "RL")}${chip("model-training", dot("model-training") + "trained-in module")}</span>`;
}

/* level 2: a family's papers on the family's own two axes; a paper opens its details beside the grid */
function tzFamily(papers, fams) {
  const z = S.tz, f = fams.get(z.fam);
  if (!f) return `<p class="empty-state">Unknown family.</p>`;
  const q = S.taxQ.trim().toLowerCase();
  let list = papers.filter(p => p.tax.family === f.id);
  const otherRows = z.band ? 0 : list.filter(p => rowOfPaper(p) !== z.row).length;
  if (!z.band && !S.tzAllRows) list = list.filter(p => rowOfPaper(p) === z.row);
  const all = list;
  if (S.taxLearn) list = list.filter(p => learnMatch(p.tax, S.taxLearn));
  if (q) list = list.filter(p => [p.title, p.tax.name, p.tax.what, p.tax.unique, p.tax.learns_what].join(" ").toLowerCase().includes(q));
  const ax = f.axes;
  const card = p => `<button class="pcard${S.tzPaper === p.id ? " sel" : ""}${p.emblem ? " hasem" : ""}" data-paper="${esc(p.id)}" aria-pressed="${S.tzPaper === p.id}">
    ${p.emblem ? `<svg class="axicon emblem" viewBox="0 0 160 90" role="img" aria-label="${esc(p.emblem.label)}">${p.emblem.body}</svg>` : ""}
    <span class="ph"><b>${esc(p.tax.name || p.title)}</b><span class="lv">${esc(venueLabel(p))}</span>${learnBadge(p.tax)}<span class="conf c-${esc(p.tax.confidence)}" title="${esc(CONF_TEXT[p.tax.confidence] || "")}"></span></span>
    <span class="pu">${esc(p.tax.unique || p.tax.what || p.title)}</span></button>`;
  const sortP = l => [...l].sort((a, b) => (paperYear(b) || 0) - (paperYear(a) || 0) || (a.tax.name || "").localeCompare(b.tax.name || ""));
  let grid;
  if (ax) {
    const xs = ax[0].values.filter(v => list.some(p => p.tax.x === v.id)), ys = ax[1].values.filter(v => list.some(p => p.tax.y === v.id));
    const unplaced = list.filter(p => !ax[0].values.some(v => v.id === p.tax.x) || !ax[1].values.some(v => v.id === p.tax.y));
    grid = `<div class="pgrid" style="--cols:${xs.length}">
      <div class="paxcorner" aria-hidden="true"></div>
      <div class="paxx" title="${esc(ax[0].def)}"><b>${esc(ax[0].name)}</b></div>
      <div class="paxy" style="grid-row: 2 / span ${ys.length + 1}" title="${esc(ax[1].def)}"><b>${esc(ax[1].name)}</b></div>
      <div class="pcorner" aria-hidden="true"></div>
      ${xs.map(v => { const icon = axisIcon(f.id, ax[0].id, v.id);
        return `<div class="pcol${icon ? " hasicon" : ""}" title="${esc(v.def)}"><b>${esc(v.name)}</b>${icon || `<span>${esc(v.def)}</span>`}</div>`; }).join("")}
      ${ys.map(yv => { const icon = axisIcon(f.id, ax[1].id, yv.id);
        return `<div class="prow${icon ? " hasicon" : ""}" title="${esc(yv.def)}"><b>${esc(yv.name)}</b>${icon || `<span>${esc(yv.def)}</span>`}</div>
        ${xs.map(xv => { const l = sortP(list.filter(p => p.tax.x === xv.id && p.tax.y === yv.id));
          return `<div class="pcell${l.length ? "" : " empty"}"><span class="pxy">${esc(xv.name)} · ${esc(yv.name)}</span>${l.map(card).join("")}</div>`; }).join("")}`; }).join("")}
    </div>${unplaced.length ? `<div class="punplaced"><h3 class="t-h3">Not yet placed on this family's axes</h3>${sortP(unplaced).map(card).join("")}</div>` : ""}`;
  } else grid = `<div class="plist">${sortP(list).map(card).join("")}</div>`;
  const sel = list.find(p => p.id === S.tzPaper) || papers.find(p => p.id === S.tzPaper);
  // the selected paper opens in a modal; one whose system has figures gets the wide modal so both figures fit
  const selSys = sel?.system && A.systems.find(x => x.id === sel.system), full = !!selSys?.mechanism?.figures;
  return `<div class="tzlevel" style="view-transition-name:tz-zoom">
    <h1 class="t-h1">${esc(f.name)}</h1><p class="t-meta">${list.length} paper${list.length === 1 ? "" : "s"}</p><p class="tzd t-body">${esc(f.def)}</p>

    <div class="cmpbar">
      <label class="search" for="txq"><input id="txq" type="search" placeholder="Search in this family" value="${esc(S.taxQ)}"></label>
      <span class="mblabel">What adapts over time</span>
      <button class="chip" data-learn="" aria-pressed="${!S.taxLearn}">all</button>
      ${learnFilter(all)}
      ${otherRows ? `<label class="check" for="tzall"><input id="tzall" type="checkbox" ${S.tzAllRows ? "checked" : ""}> include ${otherRows} papers of this family from other rows</label>` : ""}
    </div>
    <div class="pwrap">
      <div class="pmain">${list.length ? grid : `<p class="empty-state">No paper with these filters.</p>`}</div>
    </div></div>
    ${sel ? `<div class="pmodal" data-backdrop><div class="pmbox${full ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(sel.tax?.name || sel.title)}" tabindex="-1">
      <aside class="pdetail${full ? " pdfull" : ""}">${tzDetail(sel, fams)}</aside></div></div>` : ""}`;
}

/* The detail panel for an annotated system, in the order memory is used: what one item is, how memory is
   built, how it is read, what happens when the first read is not enough, and what finally reaches the answer
   model, then how much is kept, results, and what is easy to miss. Every claim links to its source. */
/* The read path as one flow, steps 1-10, with the branch at the sufficiency check. Each step says who does it
   (retriever, rule, cross-encoder, LLM), how, what it sees, how many items go in and out, and where in the code. */
const ACTOR = {
  retriever: ["Retriever", "Encodes the question and each memory separately and compares the vectors (bi-encoder), or matches words (BM25). Fast enough to scan every memory."],
  rule: ["Rule", "Fixed code, no model."],
  cross: ["Cross-encoder", "Reads the question and one candidate together in a single input and scores that pair. Slower but more precise, so it only sees a few dozen candidates."],
  llm: ["LLM", "A prompted language model that reads several items at once and writes a judgement or text."],
};
function flowHTML(flow) {
  const node = x => `<div class="fl-node a-${x.actor}${x.decision ? " decide" : ""}">
      <div class="fl-head"><span class="fl-n">${x.n}</span><b class="fl-title">${esc(x.title)}</b><span class="fl-actor a-${x.actor}">${esc(ACTOR[x.actor]?.[0] || x.actor)}</span></div>
      <div class="fl-io"><span>${esc(x.in)}</span><span class="fl-to" aria-hidden="true">→</span><b>${esc(x.out)}</b></div>
      <p class="fl-method"><b>${esc(x.method)}</b>${x.model ? ` · ${esc(x.model)}` : ""}</p>
      <p class="fl-sees">${esc(x.sees)}</p>
      ${x.params && Object.keys(x.params).length ? `<div class="mparams">${Object.entries(x.params).map(([k, v]) => `<span class="tag">${esc(k)} ${esc(v)}</span>`).join("")}</div>` : ""}
      ${x.decision ? `<div class="fl-branch"><div><span class="mf-yes">Yes</span>${esc(x.yes)}</div><div><span class="mf-no">No</span>${esc(x.no)}</div></div>` : ""}
      <div class="fl-src">${msrc(x)}</div></div>`;
  const down = `<div class="fl-down" aria-hidden="true">↓</div>`;
  const r1 = flow.filter(x => x.round === 1), r2 = flow.filter(x => x.round === 2), end = flow.filter(x => !x.round);
  const legend = `<div class="fl-legend">${Object.entries(ACTOR).filter(([k]) => flow.some(x => x.actor === k)).map(([k, [name, def]]) => `<div><span class="fl-actor a-${k}">${esc(name)}</span><span>${esc(def)}</span></div>`).join("")}</div>`;
  return `${legend}
    <div class="fl">
      <p class="fl-lane">Round 1</p>
      ${r1.map(node).join(down)}
      ${r2.length ? `<div class="fl-split">
        <div class="fl-yeslane"><span class="mf-yes">Yes</span> go straight to step ${end[0]?.n || ""} with these 10</div>
        <div class="fl-nolane"><p class="fl-lane"><span class="mf-no">No</span> Round 2: reconstruction, runs once</p>${r2.map(node).join(down)}</div>
      </div>` : ""}
      ${end.length ? `<div class="fl-down" aria-hidden="true">↓</div>${end.map(node).join(down)}` : ""}
    </div>`;
}

/* The same read path as a compact one-screen table: row 1 runs 1 to 5 left to right, the "no" branch drops
   under 5 and runs 6 to 9 right to left, and 10 closes the loop at the bottom left. Clicking a step shows its
   details underneath, so the whole path stays in view. */
function compactFlow(flow, sel) {
  const by = n => flow.find(x => x.n === n);
  const decide = flow.find(x => x.decision);
  const cell = (n, col, row) => { const x = by(n); if (!x) return "";
    return `<button class="cf-node a-${x.actor}${x.decision ? " decide" : ""}${sel === n ? " sel" : ""}" style="grid-column:${col};grid-row:${row}" data-step="${n}" aria-pressed="${sel === n}">
      <span class="cf-top"><span class="fl-n">${n}</span><span class="fl-actor a-${x.actor}">${esc(ACTOR[x.actor]?.[0] || x.actor)}</span></span>
      <b>${esc(x.short || x.title)}</b><span class="cf-count">${esc(x.count || "")}</span></button>`; };
  const arrow = (ch, col, row) => `<span class="cf-arr" style="grid-column:${col};grid-row:${row}" aria-hidden="true">${ch}</span>`;
  const r2 = flow.some(x => x.round === 2);
  return `<div class="cf" role="group" aria-label="Read path, steps 1 to ${flow.length}">
    ${[1, 2, 3, 4, 5].map((n, i) => cell(n, 1 + i * 2, 1) + (i < 4 ? arrow("→", 2 + i * 2, 1) : "")).join("")}
    ${r2 ? `<div class="cf-yes" style="grid-column:1/9;grid-row:2"><span class="cf-dash"></span><span><span class="mf-yes">Yes</span> ${esc((decide?.yes || "").replace(/\s*\(step \d+\)\.?$/, ""))} → step 10</span></div>
      <div class="cf-no" style="grid-column:9;grid-row:2"><span aria-hidden="true">↓</span> <span class="mf-no">No</span> ${esc((decide?.no || "").match(/^\d+%/)?.[0] || "")}</div>
      ${cell(10, 1, 3)}${arrow("←", 2, 3)}${cell(9, 3, 3)}${arrow("←", 4, 3)}${cell(8, 5, 3)}${arrow("←", 6, 3)}${cell(7, 7, 3)}${arrow("←", 8, 3)}${cell(6, 9, 3)}` : cell(10, 1, 2)}
  </div>`;
}
function stepDetail(x) {
  if (!x) return `<p class="t-meta cf-hint">Click a step for what it sees and where it is in the code.</p>`;
  return `<div class="cf-detail"><div class="fl-head"><span class="fl-n">${x.n}</span><b class="fl-title">${esc(x.title)}</b><span class="fl-actor a-${x.actor}">${esc(ACTOR[x.actor]?.[0] || x.actor)}</span></div>
    <p class="fl-method"><b>${esc(x.method)}</b>${x.model ? ` · ${esc(x.model)}` : ""}</p>
    <div class="fl-io"><span>${esc(x.in)}</span><span class="fl-to" aria-hidden="true">→</span><b>${esc(x.out)}</b></div>
    <p class="fl-sees">${esc(x.sees)}</p>
    ${x.params && Object.keys(x.params).length ? `<div class="mparams">${Object.entries(x.params).map(([k, v]) => `<span class="tag">${esc(k)} ${esc(v)}</span>`).join("")}</div>` : ""}
    ${x.decision ? `<div class="fl-branch"><div><span class="mf-yes">Yes</span>${esc(x.yes)}</div><div><span class="mf-no">No</span>${esc(x.no)}</div></div>` : ""}
    <div class="fl-src">${msrc(x)}</div></div>`;
}

function mechanismFlow(sys) {
  const m = sys.mechanism, T = A.taxonomy;
  const sec = (n, title, inner) => `<section class="t-sec mf-sec"><h3 class="t-h3"><span class="mf-n">${n}</span>${esc(title)}</h3><div class="t-indent">${inner}</div></section>`;
  const r1 = (m.read || []).filter(x => (x.round || 1) === 1), r2 = (m.read || []).filter(x => x.round === 2);
  const check = r1.find(x => /sufficien/i.test(x.step));
  const glance = m.glance?.length ? `<dl class="mf-glance">${m.glance.map(g => `<dt>${esc(g.q)}</dt><dd>${esc(g.a)} ${msrc(g)}</dd>`).join("")}</dl>` : "";
  const units = (m.units || []).map(u => `<div class="munit"><p class="t-body"><b>${esc(u.name)}</b>: ${esc(u.role || "")}</p>
    <table class="mfields"><thead><tr><th>Field</th><th>Kept as</th><th>Used for</th></tr></thead><tbody>
    ${u.fields.map(f => `<tr><td><b>${esc(f.name)}</b><div class="dim">${esc(f.what || "")}</div></td><td><span class="kept ${KEPT_CLASS[f.kept_as] || ""}">${esc(f.kept_as)}</span></td>
      <td>${f.used_for?.length ? f.used_for.map(x => `<span class="tag${x === "answer" ? " use-ans" : ""}">${esc(x)}</span>`).join("") : '<span class="tag unused">not used</span>'}</td></tr>`).join("")}
    </tbody></table></div>`).join("");
  const funnel = round => { const f = (m.funnel || []).find(x => x.round === round); if (!f) return "";
    return `<div class="mf-funnel" aria-label="How many items at each step">${f.steps.map((x, i) => `${i ? '<span class="mf-arr" aria-hidden="true">→</span>' : ""}<div class="mf-fs${i === f.steps.length - 1 ? " last" : ""}"><b>${esc(x.n)}</b><span>${esc(x.what)}</span></div>`).join("")}</div><p class="t-meta">${msrc(f)}</p>`; };
  const decision = check ? `<div class="mf-decide"><b>Enough evidence?</b>
      <div><span class="mf-yes">Yes</span> go to step 5, the answer.</div>
      <div><span class="mf-no">No</span> ${esc(check.out || "")}: reconstruct, step 4.</div></div>` : "";
  const ac = m.answer_context;
  const answer = ac ? `<div class="mans"><div class="mansees">${esc(ac.sees)}</div><code class="mfmt">${esc(ac.format)}</code>
      <div class="mf-inout">
        ${ac.includes?.length ? `<div><h4 class="mf-h4"><span class="mf-yes">In</span>Goes to the answer model</h4><ul>${ac.includes.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        ${ac.excludes?.length ? `<div><h4 class="mf-h4"><span class="mf-no">Out</span>Never goes to it</h4><ul>${ac.excludes.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      </div>
      ${ac.note ? `<p class="t-meta">${esc(ac.note)}</p>` : ""}${msrc(ac)}</div>` : "";
  const rows = A.results.filter(r => r.system === sys.id && (r.category || "overall") === "overall")
    .sort((a, b) => a.benchmark.localeCompare(b.benchmark) || b.score - a.score);
  const results = rows.length ? `<table class="mnums"><thead><tr><th>Benchmark</th><th class="num">Score</th><th>Answer model</th><th>Reported by</th></tr></thead><tbody>
      ${rows.slice(0, 10).map(r => `<tr><td>${esc(A.benchmarks.find(b => b.id === r.benchmark)?.name || r.benchmark)} <span class="dim">${esc(r.metric)}</span></td><td class="num">${fmt(r.score)}</td><td>${esc(r.answer_model || "not stated")}</td><td>${r.run_by === "self" ? "own paper" : esc(reporterShort(r.reporter))}</td></tr>`).join("")}
    </tbody></table>${rows.length > 10 ? `<p class="t-meta">${rows.length - 10} more in Compare and Results.</p>` : ""}` : "";
  const unused = (m.units || []).flatMap(u => u.fields.filter(f => !f.used_for?.length || f.used_for.every(x => x === "chat mode only" || x === "profile")).map(f => `${u.name} ${f.name}`));
  const top = m.flow?.length ? `<section class="t-sec mf-sec cf-sec"><h3 class="t-h3">How a question is answered</h3>
      <div class="fl-legend cf-legend">${Object.entries(ACTOR).filter(([k]) => m.flow.some(x => x.actor === k)).map(([k, [name, def]]) => `<div><span class="fl-actor a-${k}">${esc(name)}</span><span>${esc(def)}</span></div>`).join("")}</div>
      ${compactFlow(m.flow, S.tzStep)}<div class="cf-slot">${stepDetail(m.flow.find(x => x.n === S.tzStep))}</div></section>` : "";
  return `<div class="mflow t-noindent">
    ${top}
    ${glance ? sec("", "At a glance", glance) : ""}
    ${sec(1, "Memory structure: what is stored", units)}
    ${m.write?.length ? sec(2, "Building memory", mechSteps(m.write)) : ""}
    ${m.flow?.length ? "" : `
    ${r1.length ? sec(3, "Reading memory, first pass", funnel(1) + mechSteps(r1) + decision) : ""}
    ${r2.length ? sec(4, "Reconstruction: when the first pass is not enough", funnel(2) + mechSteps(r2)) : ""}`}
    ${answer ? sec(m.flow?.length ? 3 : 5, "What the answer model finally reads", answer) : ""}
    ${m.compression?.length ? sec(m.flow?.length ? 4 : 6, "How much is kept", mechCompression(m)) : ""}
    ${results || m.numbers?.length ? sec(m.flow?.length ? 5 : 7, "Results", `${results}${m.numbers?.length ? `<h4 class="mf-h4">Ablations and cost from the paper</h4><table class="mnums"><tbody>${m.numbers.map(n => `<tr><td>${esc(n.label)}</td><td class="num">${esc(n.value)}</td><td class="dim">${esc(n.src || "")}</td></tr>`).join("")}</tbody></table>` : ""}`) : ""}
    ${sec(m.flow?.length ? 6 : 8, "Easy to miss", `
      ${unused.length ? `<h4 class="mf-h4">Stored but not used in the evaluated setting</h4><p class="t-body">${unused.map(esc).join(", ")}.</p>` : ""}
      ${m.paper_vs_code?.length ? `<h4 class="mf-h4">Where the paper and the code differ</h4>${m.paper_vs_code.map(d => `<div class="mdiff"><b>${esc(d.topic)}</b><div><span class="dim">paper</span> ${esc(d.paper)}</div><div><span class="dim">code</span> ${esc(d.code)}</div>${msrc(d)}</div>`).join("")}` : ""}
      ${m.open_questions?.length ? `<h4 class="mf-h4">What the experiments cannot tell apart</h4><ul class="mq">${m.open_questions.map(q => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}`)}
    ${m.sources ? `<p class="t-meta msources">Sources: ${esc(m.sources.paper || "")}${m.sources.code ? ` · <a href="${esc(m.sources.code)}" target="_blank" rel="noopener">code at the cited commit ↗</a>` : ""}</p>` : ""}
  </div>`;
}

/* Two figures, how memory is built and how a question is answered, each with a few sentences: the short
   version of an annotated system. The full record stays in the system's profile. */
function figuresHTML(sys) {
  return (sys.mechanism.figures || []).map(f => `<figure class="mfig">
      <h3 class="t-h3">${esc(f.title)}</h3>
      <svg class="axicon mfig-svg" viewBox="${esc(f.viewBox)}" role="img" aria-label="${esc(f.title)}">${f.body}</svg>
      <figcaption>${f.text.map(x => `<p class="t-body">${esc(x)}</p>`).join("")}<p class="t-meta">${msrc(f)}</p></figcaption>
    </figure>`).join("");
}

/* An annotated system in the order of a paper, kept brief: memory architecture (two figures), construction
   details, method, results, ablation. Tables only; every value carries its source. */
function paperRecord(sys) {
  const m = sys.mechanism;
  const tbl = (head, rows, cls = "") => `<table class="ctbl ${cls}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const block = (title, body) => body ? `<section class="cblock"><h3 class="t-h3">${esc(title)}</h3>${body}</section>` : "";
  const nums = section => { const l = (m.key_numbers || []).filter(n => n.section === section); return l.length ? tbl(["", "Value", "Source"], l.map(n => `<tr><td>${esc(n.label)}</td><td><b>${esc(n.value)}</b></td><td class="dim">${esc(n.src || "")}</td></tr>`)) : ""; };
  const stored = tbl(["Item", "Kept as", "Used for"], (m.units || []).flatMap(u => u.fields.map(f =>
    `<tr><td><b>${esc(f.name)}</b> <span class="dim">${esc(u.name)}</span></td><td><span class="kept ${KEPT_CLASS[f.kept_as] || ""}">${esc(f.kept_as)}</span></td><td>${f.used_for?.length ? f.used_for.map(x => `<span class="tag${x === "answer" ? " use-ans" : ""}">${esc(x)}</span>`).join("") : '<span class="tag unused">not used</span>'}</td></tr>`)));
  const models = m.components?.length ? tbl(["Step", "Model", "Source"], m.components.map(c => `<tr><td>${esc(c.role)}</td><td><span class="fl-actor a-${esc(c.kind)}">${esc(ACTOR[c.kind]?.[0] || c.kind)}</span> ${esc(c.model)}</td><td class="dim">${msrc(c)}</td></tr>`)) : "";
  const diff = m.paper_vs_code?.length ? tbl(["", "Paper", "Code"], m.paper_vs_code.map(d => `<tr><td><b>${esc(d.topic)}</b></td><td>${esc(d.paper)}</td><td>${esc(d.code)} ${msrc(d)}</td></tr>`)) : "";
  const bname = id => A.benchmarks.find(b => b.id === id)?.name || id;
  const rows = A.results.filter(r => r.system === sys.id && (r.category || "overall") === "overall")
    .sort((a, b) => a.benchmark.localeCompare(b.benchmark) || b.score - a.score);
  const resRow = (r, who) => `<tr><td><b>${esc(bname(r.benchmark))}</b>${r.benchmark_version && r.benchmark_version !== "original" ? ` <span class="dim">${esc(r.benchmark_version)}</span>` : ""}${r.variant ? ` <span class="tag">${esc(r.variant)}</span>` : ""}</td><td>${esc(r.metric)}</td><td>${esc(r.answer_model || "not stated")}</td><td class="num"><b>${fmt(r.score)}</b></td><td>${who ? `${esc(reporterShort(r.reporter))} <span class="dim">${r.run_by === "copied" ? "copied" : "re-run"}</span><br>` : ""}${sourceLink(r)}</td></tr>`;
  const own = rows.filter(r => r.run_by === "self"), others = rows.filter(r => r.run_by !== "self");
  const results = (own.length ? block("Reported by the authors", tbl(["Benchmark", "Metric", "Answer model", "Score", "Table"], own.map(r => resRow(r, false)))) : "")
    + (others.length ? block("Measured or copied by other papers", tbl(["Benchmark", "Metric", "Answer model", "Score", "Paper, table"], others.map(r => resRow(r, true)))) : "");
  const abl = m.ablation ? tbl(["", ...m.ablation.cols], m.ablation.rows.map(r => `<tr><td>${esc(r[0])}</td>${r.slice(1).map(v => `<td class="num">${esc(v)}</td>`).join("")}</tr>`)) + `<p class="t-meta">${esc(m.ablation.src)}</p>` : "";
  const dsc = m.discussion;
  const slug = x => "pr-" + x.toLowerCase().replace(/[^a-z]+/g, "-");
  // same sections for every system, in the order of a paper; each heading names the paper section it comes from
  const from = m.sections || {};
  const part = (title, inner) => inner ? `<section class="prpart" id="${slug(title)}"><h2 class="t-h2">${esc(title)}${from[title] && m.paper_sections !== false ? ` <span class="t-meta prfrom">paper ${esc(from[title])}</span>` : ""}</h2>${inner}</section>` : "";
  const parts = ["Abstract", "Memory architecture", "Results", "Ablation", "Discussion", "Details"]
    .filter(x => x !== "Abstract" || m.abstract).filter(x => x !== "Ablation" || m.ablation).filter(x => x !== "Discussion" || m.discussion);
  const toc = `<nav class="prtoc" aria-label="Contents"><span class="t-label">Contents</span><ol>${parts.map(x => `<li><button class="prtoc-link" data-toc="${slug(x)}">${esc(x)}</button></li>`).join("")}</ol></nav>`;
  return `<div class="prec t-noindent">
    ${toc}
    ${m.abstract ? part("Abstract", `<p class="t-body prabs">${esc(m.abstract.text)}</p><p class="t-meta">${esc(m.abstract.note)} <a href="${esc(m.abstract.url)}" target="_blank" rel="noopener">arXiv abstract ↗</a></p>`) : ""}
    ${part("Memory architecture", `<div class="cfigs">${figuresHTML(sys)}</div>`)}
    ${part("Results", `<div class="ctables">${results}</div>`)}
    ${part("Ablation", `<div class="ctables">${block("Removing parts of the system", abl)}</div>`)}
    ${dsc ? part("Discussion", `<p class="t-body prtake">${esc(dsc.takeaway)}</p>
      <div class="ctables">
        ${block("What the paper claims", tbl(["Claim", "Evidence"], dsc.claims.map(c => `<tr><td>${esc(c.claim)}</td><td>${esc(c.evidence)}</td></tr>`)))}
        <div>${block("Limits the authors state", `<ul class="prlist">${dsc.limits.map(x => `<li>${esc(x)}</li>`).join("")}</ul><p class="t-meta">${esc(dsc.limits_src || "")}</p>`)}
        ${block("Our reading, not the paper's", `<ul class="prlist">${dsc.reading.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`)}</div>
      </div>`) : ""}
    ${part("Details", `<div class="ctables">${block("What is stored", stored)}${block("Construction numbers", nums("construction"))}${block("Models", models)}${block("Retrieval settings", nums("method"))}${block("Cost", nums("results"))}</div>`)}
  </div>`;
}

function tzDetail(p, fams) {
  const t = p.tax, f = fams.get(t.family), ax = f?.axes;
  const figSys = p.system && A.systems.find(s => s.id === p.system);
  if (figSys?.mechanism?.figures) {
    return `<button class="dclose" data-close aria-label="Close details">×</button>
      <h2 class="t-h2">${esc(t.name || p.title)} ${learnBadge(t)}</h2>
      <p class="t-meta">${esc(venueLabel(p))}</p>
      <p class="t-body pdtitle">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)} ↗</a>` : esc(p.title)}${p.code ? ` · <a href="${esc(p.code)}" target="_blank" rel="noopener">code ↗</a>` : ""}</p>
      ${paperRecord(figSys)}`;
  }
  const lname = id => A.taxonomy.learning.find(l => l.id === id)?.name || id;
  const val = (i, id) => ax?.[i].values.find(v => v.id === id);
  const sys = p.system && A.systems.find(s => s.id === p.system);
  const sec = (title, inner) => `<section class="t-sec"><h3 class="t-h3">${esc(title)}</h3><div class="t-indent">${inner}</div></section>`;
  return `<button class="dclose" data-close aria-label="Close details">×</button>
    <h2 class="t-h2">${esc(t.name || p.title)} ${learnBadge(t)}</h2>
    <p class="t-meta">${esc(venueLabel(p))}</p>
    <p class="t-body pdtitle">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)} ↗</a>` : esc(p.title)}${p.code ? ` · <a href="${esc(p.code)}" target="_blank" rel="noopener">code ↗</a>` : ""}</p>
    ${sys?.mechanism ? `<div class="pdsys top">${mechanismFlow(sys)}<button class="jump" data-profile="${esc(sys.id)}">Open full profile</button></div><h2 class="t-h2 pdmore">In the paper index</h2>` : ""}
    ${t.unique ? sec("What sets it apart", `<p class="t-body">${esc(t.unique)}</p>`) : ""}
    ${t.what ? sec("How it works", `<p class="t-body">${esc(t.what)}</p>`) : ""}
    ${ax ? sec("Where it sits in this family", `<p class="t-body"><b>${esc(ax[0].name)}</b>: ${esc(val(0, t.x)?.name || "not placed")}</p><p class="t-body"><b>${esc(ax[1].name)}</b>: ${esc(val(1, t.y)?.name || "not placed")}</p>`) : ""}
    ${t.learning ? sec("How it improves", `<p class="t-body">${esc(lname(t.learning))}${t.learning_also?.length ? ` + ${esc(t.learning_also.map(lname).join(", "))}` : ""}${t.learns_what ? `: ${esc(t.learns_what)}` : ""}</p>`) : ""}
    ${sec("Where it is filed", `<p class="t-body"><b>Family</b>: ${esc(f?.name || t.family)}${t.also?.length ? `; also ${esc(t.also.map(a => fams.get(a)?.name || a).join(", "))}` : ""}</p>${t.function?.length ? `<p class="t-body"><b>Function</b>: ${esc(t.function.join(", "))}</p>` : ""}
      <p class="t-meta">Placed from its ${esc(t.basis)} · confidence ${esc(t.confidence)}${t.checked ? " · checked by hand" : ""}</p>${t.fit ? `<p class="t-meta">Fits loosely: ${esc(t.fit)}</p>` : ""}`)}
    ${sec("How the source lists file it", `<ul class="txlists">${p.sources.map(s => `<li class="t-body"><span class="t-meta">${esc(SOURCE_NAME[s.list] || s.list)}</span> ${esc(s.section)}</li>`).join("")}</ul>`)}
    ${sys && !sys.mechanism ? `<div class="pdsys"><h2 class="t-h2">Annotated in depth</h2><p class="t-body">${esc(sys.summary || "")}</p><button class="jump" data-profile="${esc(sys.id)}">Open full profile</button></div>` : ""}`;
}

/* level 3 keeps its headers in view: the axis row and the column headers stick under the site bar, and each
   row header sticks under them while its row is on screen. The offsets depend on rendered heights. */
function stickGrid(g) {
  if (!g || !g.isConnected) return;
  const bar = document.querySelector(".bar")?.offsetHeight || 0;
  const axisRow = g.querySelector(".paxx")?.offsetHeight || 0;
  const colRow = Math.max(0, ...[...g.querySelectorAll(".pcol, .pcorner")].map(el => el.offsetHeight));
  g.style.setProperty("--st1", `${bar}px`);
  g.style.setProperty("--st2", `${bar + axisRow}px`);
  g.style.setProperty("--st3", `${bar + axisRow + colRow}px`);
}
window.addEventListener("resize", () => stickGrid(document.querySelector(".pgrid")));

/* papers whose source does not say what their memory is for, or where they sit on their family's axes,
   are left out of every view; papers tied to an annotated system stay */
function notStated(p) {
  const t = p.tax;
  if (!t || p.system) return false;
  const ns = v => /^not[-_ ]?stated$/.test(v || "");
  const form = A.taxonomy.groups.find(g => g.families.some(f => f.id === t.family))?.id;
  return ns(t.x) || ns(t.y) || (["token", "parametric", "latent"].includes(form) && !(t.function || []).length);
}

/* Overview search: type part of a paper's name or title; the list says where each match sits
   (cell and family), its blocks light up on the map, and choosing one opens it in its family table. */
function paperPlace(p) {
  const g = groupOf(p), fam = A.taxonomy.groups.flatMap(x => x.families).find(f => f.id === p.tax.family);
  if (g === "benchmark") return { where: `Benchmarks → ${fam?.name || p.tax.family}`, z: { level: 2, band: "benchmark", fam: p.tax.family } };
  if (!FORMS.includes(g)) return null;
  const G = A.taxonomy.groups.find(x => x.id === g), r = rowOfPaper(p), rn = A.taxonomy.functions.find(f => f.id === r)?.name || "Not stated";
  return { where: `${G.name.replace(/ memory$/, "")} · ${rn} → ${fam?.name || p.tax.family}`, z: { level: 2, form: g, row: r, fam: p.tax.family }, cell: `cell|${g}|${r}` };
}
function wireSearch(main) {
  const q = $("#ovq", main), list = $("#ovres", main);
  if (!q) return;
  const norm = t => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let hits = [];
  const light = cells => main.querySelectorAll(".iso .blk").forEach(b => {
    b.classList.toggle("hit", cells.has(b.dataset.info)); b.classList.toggle("dim", cells.size > 0 && !cells.has(b.dataset.info)); });
  const show = () => {
    const t = norm(q.value);
    if (t.length < 2) { hits = []; list.hidden = true; light(new Set()); return; }
    hits = A.papers.filter(p => p.tax && (norm(p.tax.name).includes(t) || norm(p.title).includes(t)))
      .map(p => ({ p, at: paperPlace(p) })).filter(h => h.at)
      .sort((a, b) => (norm(b.p.tax.name).startsWith(t)) - (norm(a.p.tax.name).startsWith(t)) || (b.p.system ? 1 : 0) - (a.p.system ? 1 : 0))
      .slice(0, 10);
    list.innerHTML = hits.length ? hits.map((h, i) => `<li role="option" data-i="${i}"><b>${esc(h.p.tax.name || h.p.title)}</b>
        <span class="ovwhere">${esc(h.at.where)}</span><span class="t-meta">${esc(venueLabel(h.p))}${S.taxAccepted && !isAccepted(h.p) ? " · hidden by the accepted filter" : ""}</span></li>`).join("")
      : `<li class="none t-meta">No paper matches “${esc(q.value)}”</li>`;
    list.hidden = false;
    light(new Set(hits.map(h => h.at.cell).filter(Boolean)));
  };
  const open = h => {
    if (S.taxAccepted && !isAccepted(h.p)) S.taxAccepted = false;  // show the paper even if its venue is unknown
    S.tz = h.at.z; S.view = h.at.z.band === "benchmark" ? "benchmarks" : "taxonomy";
    S.taxQ = ""; S.tzAllRows = false; S.taxLearn = null;
    try { history.pushState(null, "", "#" + tzHash(S.tz)); } catch (_) { /* sandboxed */ }
    S.tzPaper = h.p.id; render(); window.scrollTo(0, 0); $(".pmbox")?.focus();
  };
  q.addEventListener("input", show);
  q.addEventListener("focus", show);
  q.addEventListener("keydown", e => { if (e.key === "Enter" && hits[0]) open(hits[0]); if (e.key === "Escape") { q.value = ""; show(); } });
  list.addEventListener("click", e => { const li = e.target.closest("li[data-i]"); if (li) open(hits[+li.dataset.i]); });
}

function viewTaxonomy(main) {
  const fams = famById();
  if (!S.tz) S.tz = { level: 0 };
  const papers = tzPapers();
  const z = S.tz;
  main.innerHTML = `${z.level === 0 ? `<p class="lede t-body">Every memory paper in the index, by <b>where the memory lives</b> and <b>what it is for</b>. Hover a block for what it means; click to zoom in.</p>
    <div class="ovsearch" role="search"><input id="ovq" type="search" placeholder="Find a paper by name, e.g. EverMemOS" autocomplete="off" aria-controls="ovres">
      <ul id="ovres" class="ovres" role="listbox" hidden></ul></div>` : ""}
    ${tzCrumbs(fams)}
    ${z.level === 0 ? tzOverview(papers, fams) : z.level === 1 ? tzCell(papers, fams) : tzFamily(papers, fams)}`;

  const panel = $(".ovpanel", main);
  if (panel) {
    let cur = null;
    const cone = $(".ovcone", main);
    const drawCone = el => {
      if (!cone) return;
      const poly = cone.querySelector("polygon");
      if (!el || !el.querySelector(".tp") || S.tz?.level > 1) { poly.setAttribute("points", ""); cone.classList.remove("on"); return; }
      const box = cone.parentElement.getBoundingClientRect(), t = el.querySelector(".tp").getBoundingClientRect(), p = panel.getBoundingClientRect();
      const X = x => x - box.left, Y = y => y - box.top;
      poly.setAttribute("points", [[X(t.left + t.width / 2), Y(t.top)], [X(p.left), Y(p.top + 6)], [X(p.left), Y(p.bottom - 6)], [X(t.left + t.width / 2), Y(t.bottom)]].map(q => q.map(v => v.toFixed(1)).join(",")).join(" "));
      cone.classList.add("on");
    };
    const show = (info, el) => { if (info !== cur) { cur = info; panel.innerHTML = tzPanel(info); } drawCone(info?.startsWith("cell|") || S.tz?.level === 1 ? el : null); };
    main.querySelectorAll("[data-info]").forEach(el => { el.addEventListener("mouseenter", () => show(el.dataset.info, el)); el.addEventListener("focus", () => show(el.dataset.info, el)); });
    main.querySelectorAll(".iso svg").forEach(el => el.addEventListener("mouseleave", () => show(null)));
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
  $("#txa", main).addEventListener("change", e => { S.taxAccepted = e.target.checked; render(); });
  wireSearch(main);
  const q = $("#txq", main);
  q?.addEventListener("input", () => { S.taxQ = q.value; const pos = q.selectionStart; render(); const n = $("#txq"); n.focus(); n.setSelectionRange(pos, pos); });
  main.querySelectorAll("[data-learn]").forEach(b => b.addEventListener("click", () => { S.taxLearn = b.dataset.learn || null; render(); }));
  $("#tzall", main)?.addEventListener("change", e => { S.tzAllRows = e.target.checked; render(); });
  main.querySelectorAll("[data-paper]").forEach(b => b.addEventListener("click", () => {
    const y = scrollY;
    S.tzPaper = b.dataset.paper; render(); window.scrollTo(0, y);
    $(".pmbox", main)?.focus();
  }));
  const closePaper = () => { const y = scrollY; S.tzPaper = null; render(); window.scrollTo(0, y); };
  main.querySelector("[data-close]")?.addEventListener("click", closePaper);
  $(".pmodal", main)?.addEventListener("click", e => { if (e.target.matches("[data-backdrop]")) closePaper(); });
  $(".pmodal", main)?.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); closePaper(); } });
  document.body.classList.toggle("modal-open", !!$(".pmodal", main));
  main.querySelectorAll("[data-toc]").forEach(b => b.addEventListener("click", () => {
    document.getElementById(b.dataset.toc)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }));
  const more = $(".pdmore2", main);
  more?.addEventListener("toggle", () => { S.tzMore = more.open; });
  main.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => {
    const n = +b.dataset.step;
    S.tzStep = S.tzStep === n ? null : n;
    const sys = A.systems.find(x => x.id === A.papers.find(p => p.id === S.tzPaper)?.system);
    main.querySelectorAll("[data-step]").forEach(x => { const on = +x.dataset.step === S.tzStep; x.classList.toggle("sel", on); x.setAttribute("aria-pressed", on); });
    const slot = $(".cf-slot", main);
    if (slot && sys) slot.innerHTML = stepDetail(sys.mechanism.flow.find(x => x.n === S.tzStep));
  }));
  main.querySelectorAll("[data-profile]").forEach(b => b.addEventListener("click", () => openSystem(b.dataset.profile)));
  const grid = $(".pgrid", main);
  if (grid) { stickGrid(grid); document.fonts?.ready.then(() => stickGrid(grid)); }
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
              <span class="tag">${esc(p.kind)}</span>${p.venue ? `<span class="tag ven${p.venue.track === "preprint" ? " pre" : ""}" title="${p.venue.checked ? "Checked against the paper" : p.venue.source ? `Looked up in ${p.venue.source}` : "As listed by DEEP-PolyU"}">${esc(venueLabel(p))}${p.venue.track !== "main" && p.venue.track !== "preprint" ? "" : p.venue.track === "main" ? " main" : ""}</span>` : ""}${p.date ? `<span class="num">${esc(p.date)}</span>` : ""}
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

/* The compact record of an annotated system: the two figures, then four tables (what is stored, key numbers,
   ablation, paper vs code). Everything else folds away under "All annotated fields". */
function compactRecord(sys, tablesOnly = false) {
  const m = sys.mechanism, tbl = (head, rows) => `<table class="ctbl"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const stored = tbl(["Item", "Kept as", "Used for"], (m.units || []).flatMap(u => u.fields.map(f =>
    `<tr><td><b>${esc(f.name)}</b> <span class="dim">${esc(u.name)}</span></td><td><span class="kept ${KEPT_CLASS[f.kept_as] || ""}">${esc(f.kept_as)}</span></td><td>${f.used_for?.length ? f.used_for.map(x => `<span class="tag${x === "answer" ? " use-ans" : ""}">${esc(x)}</span>`).join("") : '<span class="tag unused">not used</span>'}</td></tr>`)));
  const nums = m.key_numbers?.length ? tbl(["", "Value", "Source"], m.key_numbers.map(n => `<tr><td>${esc(n.label)}</td><td><b>${esc(n.value)}</b></td><td class="dim">${esc(n.src || "")}</td></tr>`)) : "";
  const abl = m.ablation ? tbl(["", ...m.ablation.cols], m.ablation.rows.map(r => `<tr><td>${esc(r[0])}</td>${r.slice(1).map(v => `<td class="num">${esc(v)}</td>`).join("")}</tr>`)) + `<p class="t-meta">${esc(m.ablation.src)}</p>` : "";
  const diff = m.paper_vs_code?.length ? tbl(["", "Paper", "Code"], m.paper_vs_code.map(d => `<tr><td><b>${esc(d.topic)}</b></td><td>${esc(d.paper)}</td><td>${esc(d.code)} ${msrc(d)}</td></tr>`)) : "";
  const block = (title, body) => body ? `<section class="cblock"><h3 class="t-h3">${esc(title)}</h3>${body}</section>` : "";
  const tables = `<div class="ctables">${block("What is stored", stored)}${block("Key numbers", nums)}${block("Ablation", abl)}${block("Paper vs code", diff)}</div>`;
  return tablesOnly ? tables : `<div class="crec t-noindent"><div class="cfigs">${figuresHTML(sys)}</div>${tables}</div>`;
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
  if (s.mechanism?.figures) {
    d.classList.add("wide");
    d.innerHTML = `<button class="x" id="dx">Close</button>
      <h2 class="t-h2">${esc(s.name)}</h2>
      <div class="sub">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title || "")}${venueYear(p) ? ` · ${esc(venueYear(p))}` : ""}${p.code ? ` · <a href="${esc(p.code)}" target="_blank" rel="noopener">code</a>` : ""}</div>
      ${compactRecord(s)}
      <details class="call"><summary>All annotated fields</summary>
        ${DESIGN.map(([g, label, , fields]) => `<h4 class="mf-h4">${label}</h4><dl class="kv">${fields.map(([f, l]) => { const v = s.design?.[g]?.[f]; return `<dt>${l}</dt><dd>${v == null || v === "" ? '<span class="dim">not stated</span>' : esc(v)}</dd>`; }).join("")}</dl>`).join("")}
      </details>`;
    document.body.append(scrim, d);
    scrim.addEventListener("click", closeDrawer);
    $("#dx", d).addEventListener("click", closeDrawer);
    $("#dx", d).focus();
    return;
  }
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
