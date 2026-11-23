"use strict";
// Data Modeler client. Model docs are kept in the exact shape of model/nodes/*.yml so unknown
// keys round-trip untouched; the server only serialises what it is sent.

const $ = (id) => document.getElementById(id);
const DEFAULT_TYPE_COLOR = "#8C8C8C";
const BUSINESS_KEY_ROLE = "businessKeyPart";
const CARDINALITIES = [
  ["many-to-one", "Many → one", "N", "1"],
  ["one-to-many", "One → many", "1", "N"],
  ["one-to-one", "One → one", "1", "1"],
  ["many-to-many", "Many → many", "N", "N"],
];
const COLUMN_KEY_ORDER = ["id", "name", "label", "roles", "tags"];
const MAX_VISIBLE_COLUMNS = 8;

const S = {
  nodes: [], // every node in nodes/, any type
  nodeTypes: [],
  typeById: new Map(),
  models: {}, // slug -> model definition (model/models/<slug>.yml), layout included
  current: null, // slug of the model on screen
  deletedModels: new Set(),
  byKey: new Map(),
  byId: new Map(),
  model: {}, // "<LOC>-<NAME>" -> model doc
  fileKeys: new Set(), // docs that already exist on disk
  vocab: { roles: {}, tags: {} },
  vocabDirty: false,
  layout: {}, // the current model's layout: key -> {x, y}
  sel: null, // {type:"node",key} | {type:"cols",items:[{key,colId}]} | {type:"rel",key,relId}
  highlight: null, // {group, key}
  search: "",
  showLabels: false,
  showColumns: true, // false = compact Coalesce graph nodes; remembered per model
  limitColumns: false, // columns view shows at most MAX_VISIBLE_COLUMNS rows per node, scrollable
  colScroll: {}, // key -> scrollTop of the node's column list (survives re-renders)
  view: { x: 40, y: 40, k: 1 },
  dirty: false,
  gesture: null,
  signature: null, // fingerprint of the files on disk at last load/save
  busy: false, // a load or save is in flight
  hiddenLocs: new Set(), // filters of the current model: storage locations and node types hidden,
  hiddenTypes: new Set(), // plus S.search (text) and S.highlight (tag), see passesFilters()
  hiddenStatus: new Set(), // "built" / "planned"
};

const currentDef = () => S.models[S.current];
const modelNodes = () => S.nodes.filter((n) => Models.includes(currentDef(), n));
// Planning status of a node: "new" (planned, not built), "changed" (built, planned changes),
// "deleted" (built, planned for deletion) or "unchanged". See planned.js.
const nodeStatus = (n) => n?.status || (n?.planned ? "new" : "unchanged");
const STATUS = {
  unchanged: { label: "Unchanged", tag: null, title: "" },
  new: { label: "New", tag: "NEW", title: "Planned new node: not built in Coalesce yet" },
  changed: { label: "Changed", tag: "CHANGED", title: "Built node with planned changes" },
  deleted: { label: "To delete", tag: "DELETE", title: "Built node planned for deletion" },
};
const statusTag = (n) => {
  const st = STATUS[nodeStatus(n)];
  return st.tag ? h("span", { class: `planned-tag tag-${nodeStatus(n)}`, title: st.title }, st.tag) : null;
};
const COLUMN_CHANGE = { new: "Planned: column to add", changed: "Planned: data type change", deleted: "Planned: column to remove" };

// Filters panel: a node is shown when it passes every active filter.
function passesFilters(n) {
  if (S.hiddenLocs.has(n.location) || S.hiddenTypes.has(n.nodeType) || S.hiddenStatus.has(nodeStatus(n))) return false;
  const key = keyOf(n);
  const q = S.search.trim().toLowerCase();
  if (q) {
    const label = (getDoc(key)?.node?.label || "").toLowerCase();
    const hit = key.toLowerCase().includes(q) || label.includes(q) || n.columns.some((c) => c.name.toLowerCase().includes(q) || (getMeta(key, c)?.label || "").toLowerCase().includes(q));
    if (!hit) return false;
  }
  if (S.highlight && !n.columns.some((c) => has(getMeta(key, c), S.highlight.group, S.highlight.key))) return false;
  return true;
}
const visibleNodes = () => modelNodes().filter(passesFilters);
const isVisible = (key) => !!key && S.byKey.has(key) && Models.includes(currentDef(), S.byKey.get(key)) && passesFilters(S.byKey.get(key));
const activeFilterCount = () =>
  (S.search.trim() ? 1 : 0) +
  (modelNodes().some((n) => S.hiddenLocs.has(n.location)) ? 1 : 0) +
  (modelNodes().some((n) => S.hiddenTypes.has(n.nodeType)) ? 1 : 0) +
  (S.highlight ? 1 : 0) +
  (modelNodes().some((n) => S.hiddenStatus.has(nodeStatus(n))) ? 1 : 0);
const typeOf = (n) => S.typeById.get(n?.nodeType) || { id: n?.nodeType, name: n?.nodeType || "Unknown", color: DEFAULT_TYPE_COLOR };
const typeLabel = (t) => t.short || String(t.name).replace(/^.*?:\s*/, "");

// ---------- helpers ----------

function h(tag, props, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== "string") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
// append() that skips null/false, for optional sections.
const add = (el, ...children) => el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
const keyOf = (s) => `${s.location}-${s.name}`;
const uuid = () =>
  crypto.randomUUID?.() ||
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((Math.random() * 16) | (c === "x" ? 0 : 8)).toString(16));
const humanize = (k) => {
  const s = String(k).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const api = async (method, url, body) => {
  const r = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json", accept: "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r;
};

function vocabItems() {
  const items = [];
  for (const group of ["roles", "tags"])
    for (const [key, v] of Object.entries(S.vocab[group] || {}))
      items.push({ group, key, label: v?.label || humanize(key), color: v?.color || "#999" });
  return items;
}
const vocabItem = (group, key) => vocabItems().find((v) => v.group === group && v.key === key) || { group, key, label: humanize(key), color: "#999" };

// ---------- model access ----------

function getDoc(key, create) {
  let d = S.model[key];
  if (!d && create) {
    const s = S.byKey.get(key);
    d = S.model[key] = { modelVersion: 1, node: { id: s.id, location: s.location, name: s.name }, columns: [] };
  }
  return d || null;
}

function getMeta(key, col, create) {
  const d = getDoc(key, create);
  if (!d) return null;
  if (!Array.isArray(d.columns)) d.columns = [];
  let m = d.columns.find((c) => c.id && c.id === col.id) || d.columns.find((c) => c.name === col.name);
  if (!m && create) d.columns.push((m = { id: col.id, name: col.name }));
  return m || null;
}

const colById = (key, colId) => S.byKey.get(key)?.columns.find((c) => c.id === colId);
const findCol = (s, ref) => s && ref && (s.columns.find((c) => ref.id && c.id === ref.id) || s.columns.find((c) => c.name === ref.name));
const has = (m, group, k) => !!m?.[group]?.includes(k);

function toggleTag(key, col, group, k, on) {
  const m = getMeta(key, col, true);
  const list = (m[group] ||= []);
  const i = list.indexOf(k);
  if (on && i < 0) list.push(k);
  if (!on && i >= 0) list.splice(i, 1);
}

// Every relation resolved to concrete source/target nodes and columns.
function relations() {
  const out = [];
  for (const [key, d] of Object.entries(S.model)) {
    const s = S.byKey.get(key);
    for (const r of d?.relations || []) {
      const t = S.byId.get(r.target?.id) || S.byKey.get(`${r.target?.location}-${r.target?.name}`);
      const pairs = (r.columns || [])
        .map((p) => ({ s: findCol(s, p.source), t: findCol(t, p.target) }))
        .filter((p) => p.s && p.t);
      out.push({ key, r, s, t, tKey: t && keyOf(t), pairs, broken: !s || !t || !pairs.length });
    }
  }
  return out;
}

function findRel(key, relId) {
  return (getDoc(key)?.relations || []).find((r) => r.id === relId);
}

// Drop empty metadata before saving. Column order is left alone so untouched files never churn.
function cleanDoc(key, d) {
  if (d.node && !d.node.label) delete d.node.label;
  d.columns = (d.columns || [])
    .map((m) => {
      const o = {};
      for (const k of COLUMN_KEY_ORDER) if (m[k] !== undefined) o[k] = m[k];
      for (const k of Object.keys(m)) if (!(k in o)) o[k] = m[k];
      if (!o.label) delete o.label;
      if (!o.roles?.length) delete o.roles;
      if (!o.tags?.length) delete o.tags;
      return o;
    })
    .filter((m) => Object.keys(m).some((k) => k !== "id" && k !== "name"));
  for (const r of d.relations || []) if (!r.label) delete r.label;
  if (d.relations && !d.relations.length) delete d.relations;
  return d;
}

function payloadModel() {
  const out = {};
  for (const [key, d] of Object.entries(S.model)) {
    const c = cleanDoc(key, structuredClone(d));
    const empty = !c.columns.length && !c.node?.label && !c.relations;
    if (empty && !S.fileKeys.has(key)) continue;
    out[key] = c;
  }
  return out;
}

function markDirty() {
  S.dirty = true;
  $("btnSave").disabled = false;
  setStatus("Unsaved changes", "dirty");
}
// Status line: notes (confirmations, problems) on top of the unsaved-changes state.
// Confirmations clear after a few seconds; problem notes clear on the next successful action.
let noteTimer = null;
function clearNote() {
  if (S.dirty) setStatus("Unsaved changes", "dirty");
  else setStatus("");
}
function confirmNote(text) {
  setStatus(text);
  noteTimer = setTimeout(clearNote, 3000);
}
function setStatus(text, cls = "") {
  clearTimeout(noteTimer);
  $("status").textContent = text;
  $("status").className = cls;
}

// ---------- rendering ----------

function render() {
  renderNodes();
  restoreColumnScroll();
  renderEdges();
  renderSidebar();
  renderInspector();
}
function renderCanvas() {
  renderNodes();
  restoreColumnScroll();
  renderEdges();
  renderSidebar();
}

function selectedCols() {
  return S.sel?.type === "cols" ? S.sel.items : [];
}
const isSelCol = (key, colId) => selectedCols().some((i) => i.key === key && i.colId === colId);

function renderNodes() {
  const root = $("nodes");
  root.replaceChildren();
  const rels = relations();
  const selRel = S.sel?.type === "rel" ? rels.find((x) => x.key === S.sel.key && x.r.id === S.sel.relId) : null;
  const related = new Set();
  for (const x of rels) {
    for (const p of x.pairs) {
      if (isSelCol(x.key, p.s.id)) related.add(`${x.tKey}|${p.t.id}`);
      if (isSelCol(x.tKey, p.t.id)) related.add(`${x.key}|${p.s.id}`);
    }
  }
  const q = S.search.trim().toLowerCase();

  // Compact view: nodes related to the selection get Coalesce's predecessor/successor border.
  const neighbours = new Set();
  if (S.sel?.type === "node")
    for (const x of rels) {
      if (x.key === S.sel.key && x.tKey) neighbours.add(x.tKey);
      if (x.tKey === S.sel.key) neighbours.add(x.key);
    }

  for (const s of visibleNodes()) {
    const key = keyOf(s);
    const d = getDoc(key);
    const pos = S.layout[key] || { x: 0, y: 0 };
    const current = S.sel?.type === "node" && S.sel.key === key;
    const label = d?.node?.label;
    const title = S.showLabels && label ? label : s.name;
    if (!S.showColumns) {
      root.append(compactNode(s, key, pos, { current, title, neighbour: neighbours.has(key), q, label }));
      continue;
    }
    const sub = [S.showLabels && label ? `${s.location}.${s.name}` : s.location, typeLabel(typeOf(s)), !S.showLabels && label].filter(Boolean).join(" · ");

    const cols = s.columns.map((c) => {
      const m = getMeta(key, c);
      const sqs = vocabItems().filter((v) => has(m, v.group, v.key));
      const selected =
        isSelCol(key, c.id) ||
        (selRel && selRel.pairs.some((p) => (selRel.key === key && p.s.id === c.id) || (selRel.tKey === key && p.t.id === c.id)));
      const dim = S.highlight && !has(m, S.highlight.group, S.highlight.key);
      const flash = q && (c.name.toLowerCase().includes(q) || (m?.label || "").toLowerCase().includes(q));
      const showLabel = S.showLabels;
      const text = showLabel ? m?.label || c.name : c.name;
      return h(
        "div",
        {
          class: ["ColumnLineageNode", selected && "SelectedItemBrand", !selected && related.has(`${key}|${c.id}`) && "related", dim && "dim", flash && "flash", c.change && `col-${c.change}`]
            .filter(Boolean)
            .join(" "),
          "data-key": key,
          "data-col": c.id,
          title: [c.name, c.dataType, c.change && `${COLUMN_CHANGE[c.change]}${c.plannedType ? ` → ${c.plannedType}` : ""}`, m?.label && `Label: ${m.label}`, ...sqs.map((v) => `■ ${v.label}`)].filter(Boolean).join("\n"),
        },
        h("span", { class: "handle l", title: "Drag to another column to add a relation" }),
        h("span", { class: `colName${showLabel && !m?.label ? " nolabel" : ""}` }, text),
        h("span", { class: "squares" }, sqs.map((v) => h("span", { class: "sq", style: { background: v.color } }))),
        h("span", { class: "handle r", title: "Drag to another column to add a relation" }),
      );
    });

    root.append(
      h(
        "div",
        {
          class: `StepNodeContainer ${current ? "CurrentLineageStep" : "NotCurrentLineageStep"}${s.planned ? " planned" : ""} status-${nodeStatus(s)}`,
          style: { left: `${pos.x}px`, top: `${pos.y}px` },
          "data-key": key,
        },
        h(
          "div",
          { class: "LineageStepTitle", "data-key": key },
          h("div", { class: "LineageStepTitleTop", style: { background: typeOf(s).color } }),
          h(
            "div",
            { class: "titleBox" },
            h("div", { class: "nodeName", title: s.name }, title, statusTag(s)),
            h("div", { class: "nodeSub" }, sub),
          ),
        ),
        h("div", { class: `cols${S.limitColumns ? " limited" : ""}`, "data-key": key }, cols),
      ),
    );
  }
}

// Same markup and classes as a node in Coalesce's graph (Steps2.tsx SimpleStep): a nameBox with a
// 6px band in the node type's tagColor on the left and the ellipsised node name.
function compactNode(s, key, pos, { current, title, neighbour, q, label }) {
  const t = typeOf(s);
  const metas = s.columns.map((c) => getMeta(key, c));
  const dim = S.highlight && !metas.some((m) => has(m, S.highlight.group, S.highlight.key));
  const flash =
    q && (s.name.toLowerCase().includes(q) || (label || "").toLowerCase().includes(q) || s.columns.some((c, i) => c.name.toLowerCase().includes(q) || (metas[i]?.label || "").toLowerCase().includes(q)));
  return h(
    "div",
    {
      class: ["StepNodeContainer", "compact", neighbour && "Successor", dim && "dim", flash && "flash", s.planned && "planned", `status-${nodeStatus(s)}`].filter(Boolean).join(" "),
      style: { left: `${pos.x}px`, top: `${pos.y}px` },
      "data-key": key,
    },
    h(
      "div",
      {
        class: `${current ? "CurrentStep" : "NotCurrentStep"} rowFlexBox nameBox`,
        "data-key": key,
        title: [s.name, label && `Label: ${label}`, `Location: ${s.location}`, `Type: ${t.name}`, `ID: ${s.id}`].filter(Boolean).join("\n"),
      },
      h("div", { class: "GraphStepTitleSide", style: { background: t.color } }),
      h("div", { class: "ellipseParentWide" }, h("div", { class: "ellipseChild black-font" }, title)),
      statusTag(s),
    ),
  );
}

// Anchor in world coordinates: left/right edge x and the column row's vertical centre, or the
// node's centre in the compact view.
// Re-renders rebuild the cards: put each column list back where the user scrolled it, and bring
// selected rows (a selected relation's columns) into view.
function restoreColumnScroll() {
  for (const list of $("nodes").querySelectorAll(".cols.limited")) {
    list.scrollTop = S.colScroll[list.dataset.key] || 0;
    const sel = list.querySelector(".SelectedItemBrand");
    if (sel && S.sel?.type === "rel") {
      const top = sel.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + sel.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = Math.max(0, top - list.clientHeight / 2 + sel.offsetHeight / 2);
    }
    S.colScroll[list.dataset.key] = list.scrollTop;
  }
}

// In the 8-columns view a row may be scrolled out of its list: pin it to the list's top or bottom
// edge and report it as clipped.
function rowOffset(row) {
  const list = row.parentElement;
  const y = row.offsetTop + row.offsetHeight / 2;
  if (!list.classList.contains("limited")) return { y, clipped: false };
  const top = list.offsetTop + 6;
  const bottom = list.offsetTop + list.clientHeight - 6;
  const visible = y - list.scrollTop;
  return { y: Math.min(bottom, Math.max(top, visible)), clipped: visible < top || visible > bottom };
}

function anchor(key, colId) {
  const card = $("nodes").querySelector(`.StepNodeContainer[data-key="${CSS.escape(key)}"]`);
  if (!card) return null;
  const pos = S.layout[key] || { x: 0, y: 0 };
  if (!S.showColumns) return { xl: pos.x, xr: pos.x + card.offsetWidth, y: pos.y + card.offsetHeight / 2 };
  const row = card.querySelector(`.ColumnLineageNode[data-col="${CSS.escape(colId)}"]`);
  if (!row) return null;
  const { y, clipped } = rowOffset(row);
  return { xl: pos.x, xr: pos.x + card.offsetWidth, y: pos.y + y, clipped };
}

function curve(a, b) {
  let x1, x2, d1, d2;
  if (a.xr + 30 < b.xl) [x1, x2, d1, d2] = [a.xr, b.xl, 1, -1];
  else if (b.xr + 30 < a.xl) [x1, x2, d1, d2] = [a.xl, b.xr, -1, 1];
  else [x1, x2, d1, d2] = [a.xr, b.xr, 1, 1];
  const c = Math.max(50, Math.abs(x2 - x1) / 2);
  const p = [x1, a.y, x1 + d1 * c, a.y, x2 + d2 * c, b.y, x2, b.y];
  return {
    d: `M${p[0]},${p[1]} C${p[2]},${p[3]} ${p[4]},${p[5]} ${p[6]},${p[7]}`,
    mid: { x: (p[0] + 3 * p[2] + 3 * p[4] + p[6]) / 8, y: (p[1] + 3 * p[3] + 3 * p[5] + p[7]) / 8 },
    start: { x: x1, y: a.y, d: d1 },
    end: { x: x2, y: b.y, d: d2 },
  };
}

const SVG = (tag, attrs) => {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, v);
  return e;
};

function renderEdges() {
  const svg = $("edges");
  const labels = $("labels");
  svg.replaceChildren();
  labels.replaceChildren();
  const focus = S.sel && S.sel.type !== "node";
  for (const x of relations()) {
    if (x.broken) continue;
    const active =
      (S.sel?.type === "rel" && S.sel.key === x.key && S.sel.relId === x.r.id) ||
      (S.sel?.type === "node" && (S.sel.key === x.key || S.sel.key === x.tKey)) ||
      x.pairs.some((p) => isSelCol(x.key, p.s.id) || isSelCol(x.tKey, p.t.id));
    const card = CARDINALITIES.find((c) => c[0] === x.r.cardinality) || CARDINALITIES[0];
    // Compact view draws one node-to-node line per relation.
    (S.showColumns ? x.pairs : x.pairs.slice(0, 1)).forEach((p, i) => {
      const a = anchor(x.key, p.s.id);
      const b = anchor(x.tKey, p.t.id);
      if (!a || !b) return;
      const g = curve(a, b);
      const cls = `Edge${active ? " active" : focus ? " dim" : ""}${a.clipped || b.clipped ? " clipped" : ""}`;
      const hit = SVG("path", { d: g.d, class: "EdgeHit", "data-rel": x.r.id, "data-key": x.key });
      svg.append(SVG("path", { d: g.d, class: cls }), hit);
      for (const [pt, txt] of [[g.start, card[2]], [g.end, card[3]]]) {
        const t = SVG("text", { x: pt.x + pt.d * 12, y: pt.y - 4, class: `card${active ? " active" : ""}`, "text-anchor": "middle" });
        t.textContent = txt;
        svg.append(t);
      }
      if (i === 0) {
        labels.append(
          h(
            "div",
            {
              class: `RelLabel${x.r.label ? "" : " empty"}${active ? " active" : focus ? " dim" : ""}`,
              style: { left: `${g.mid.x}px`, top: `${g.mid.y}px` },
              "data-rel": x.r.id,
              "data-key": x.key,
              title: x.r.label || "Unlabelled relation",
            },
            x.r.label || "add label",
          ),
        );
      }
    });
  }
  if (S.gesture?.type === "link" && S.gesture.to) {
    const a = S.gesture.from;
    const b = S.gesture.to;
    const g = curve(a, { xl: b.x, xr: b.x, y: b.y });
    svg.append(SVG("path", { d: g.d, class: "Edge draft" }));
  }
}

function renderSidebar() {
  const q = S.search.trim().toLowerCase();
  const locs = $("locList");
  locs.replaceChildren();
  const byLoc = new Map();
  for (const s of modelNodes()) byLoc.set(s.location, (byLoc.get(s.location) || 0) + 1);
  for (const [loc, n] of [...byLoc].sort()) {
    const on = !S.hiddenLocs.has(loc);
    const cb = h("input", { type: "checkbox", checked: on, onchange: () => setLocationVisible(loc, !on) });
    locs.append(
      h(
        "li",
        { class: on ? "" : "off", title: "Click to toggle, double-click to show only this location", ondblclick: () => soloLocation(loc) },
        cb,
        h("span", { onclick: () => setLocationVisible(loc, !on) }, loc),
        h("span", { class: "count" }, n),
      ),
    );
  }

  const types = $("typeFilterList");
  types.replaceChildren();
  const byType = new Map();
  for (const n of modelNodes()) byType.set(n.nodeType, (byType.get(n.nodeType) || 0) + 1);
  for (const [id, n] of [...byType].sort((a, b) => typeOf({ nodeType: a[0] }).name.localeCompare(typeOf({ nodeType: b[0] }).name))) {
    const t = typeOf({ nodeType: id });
    const on = !S.hiddenTypes.has(id);
    types.append(
      h(
        "li",
        { class: on ? "" : "off", title: `${t.name}\nClick to toggle, double-click to show only this node type`, ondblclick: () => soloType(id) },
        h("input", { type: "checkbox", checked: on, onchange: () => setTypeVisible(id, !on) }),
        h("span", { class: "sq", style: { background: t.color } }),
        h("span", { class: "type-name", onclick: () => setTypeVisible(id, !on) }, String(t.name).replace(/^.*?:\s*/, "")),
        h("span", { class: "count" }, n),
      ),
    );
  }

  // Status filter only matters once the model contains planned nodes or changes.
  const counts = { unchanged: 0, new: 0, changed: 0, deleted: 0 };
  for (const n of modelNodes()) counts[nodeStatus(n)]++;
  $("statusFilter").hidden = counts.unchanged === modelNodes().length;
  $("statusFilterList").replaceChildren(
    ...Object.keys(counts).filter((st) => counts[st] || S.hiddenStatus.has(st)).map((st) => {
      const on = !S.hiddenStatus.has(st);
      const toggle = () => setHiddenStatus(st, !on);
      return h(
        "li",
        { class: on ? "" : "off" },
        h("input", { type: "checkbox", checked: on, onchange: toggle }),
        st === "unchanged" ? null : h("span", { class: `status-dot status-dot-${st}` }),
        h("span", { class: "type-name", onclick: toggle }, STATUS[st].label),
        h("span", { class: "count" }, counts[st]),
      );
    }),
  );

  const active = activeFilterCount();
  $("filterCount").hidden = !active;
  $("filterCount").textContent = active;
  $("btnClearFilters").disabled = !active;
  if (document.activeElement !== $("search")) $("search").value = S.search;

  const legend = $("legend");
  legend.replaceChildren();
  let lastGroup = null;
  for (const v of vocabItems()) {
    if (v.group !== lastGroup) {
      legend.append(h("li", { class: "loc", style: { cursor: "default", background: "none" } }, v.group === "roles" ? "Roles" : "Tags"));
      lastGroup = v.group;
    }
    let n = 0;
    for (const s of modelNodes()) for (const c of s.columns) if (has(getMeta(keyOf(s), c), v.group, v.key)) n++;
    const active = S.highlight?.group === v.group && S.highlight.key === v.key;
    legend.append(
      h(
        "li",
        {
          class: active ? "active" : "",
          onclick: () => {
            S.highlight = active ? null : { group: v.group, key: v.key };
            applyFilters();
          },
        },
        h("span", { class: "sq", style: { background: v.color } }),
        v.label,
        h("span", { class: "count" }, n),
        h("button", { class: "edit", title: "Edit tag", onclick: (e) => { e.stopPropagation(); tagDialog(v.group, v.key); } }, "✎"),
      ),
    );
  }
}

// ---------- inspector ----------

function field(label, input) {
  return h("label", { class: "field" }, h("span", {}, label), input);
}

function tagChecklist(targets) {
  // targets: [{key, col}]
  const box = h("div", {});
  for (const group of ["roles", "tags"]) {
    const items = vocabItems().filter((v) => v.group === group);
    box.append(
      h("h4", {}, group === "roles" ? "Roles" : "Tags", group === "tags" ? h("button", { class: "link", style: { float: "right" }, onclick: () => tagDialog() }, "+ New tag") : null),
    );
    if (!items.length) box.append(h("div", { class: "muted" }, "None defined in model/tags.yml"));
    const list = h("div", { class: "tags" });
    for (const v of items) {
      const n = targets.filter((t) => has(getMeta(t.key, t.col), v.group, v.key)).length;
      const cb = h("input", { type: "checkbox", checked: n === targets.length, indeterminate: n > 0 && n < targets.length });
      cb.addEventListener("change", () => {
        const on = n < targets.length;
        for (const t of targets) toggleTag(t.key, t.col, v.group, v.key, on);
        markDirty();
        renderCanvas();
        renderInspector();
      });
      list.append(h("label", { class: "tag" }, cb, h("span", { class: "sq", style: { background: v.color } }), v.label, v.key === BUSINESS_KEY_ROLE ? h("span", { class: "muted" }, " (pk in DBML)") : null));
    }
    box.append(list);
  }
  return box;
}

function relationList(items) {
  if (!items.length) return h("div", { class: "muted" }, "No relations yet. Drag from a column's ● handle onto another column.");
  return items.map((x) => {
    const p = x.pairs[0];
    const card = CARDINALITIES.find((c) => c[0] === x.r.cardinality) || CARDINALITIES[0];
    return h(
      "div",
      { class: "rel", onclick: () => select({ type: "rel", key: x.key, relId: x.r.id }) },
      h("b", {}, x.r.label || h("i", { class: "muted" }, "unlabelled")),
      h("div", { class: "muted" }, x.broken ? "⚠ target node or column missing" : `${x.s.name}.${p.s.name} ${card[2]}:${card[3]} ${x.t.name}.${p.t.name}`),
    );
  });
}

// Design details of a planned (or built-from-design) column: data type, description, derivation.
function designInfo(design, planned) {
  if (!design) return null;
  const from = [].concat(design.derivedFrom || []);
  return h(
    "div",
    {},
    h("h4", {}, planned ? "Planned" : "Design"),
    h(
      "dl",
      { class: "kv" },
      design.dataType ? [h("dt", {}, "Data type"), h("dd", {}, design.dataType)] : null,
      design.description ? [h("dt", {}, "Description"), h("dd", {}, design.description)] : null,
      from.length ? [h("dt", {}, "Derived from"), h("dd", {}, from.join(", "))] : null,
    ),
  );
}

// Pending planned changes of a built node (from planned.js decorate()).
function plannedChanges(s) {
  const p = s.pending;
  if (!p) return null;
  const items = [];
  if (p.deleteNode) items.push("Delete this node");
  if (p.nodeType) items.push(`Change node type to ${typeOf({ nodeType: p.nodeType }).name}`);
  if (p.add.length) items.push(`Add ${p.add.map((m) => m.name).join(", ")}`);
  for (const r of p.retype) items.push(`Change ${r.name} from ${r.from || "?"} to ${r.to}`);
  if (p.remove.length) items.push(`Remove ${p.remove.join(", ")}`);
  if (!items.length) return null;
  return h("div", { class: `planned-changes planned-${nodeStatus(s)}` }, h("b", {}, "Planned changes"), h("ul", {}, items.map((t) => h("li", {}, t))));
}

// For a node built from a design: what was designed but not built, built but not designed, and
// data types that differ. Metadata of columns not in the node is always kept.
function designDifferences(s, d, orphans) {
  const out = [];
  if (s.planned) return out;
  const designed = (d?.columns || []).filter((m) => m.design);
  const notBuilt = orphans.filter((m) => m.design);
  const otherOrphans = orphans.filter((m) => !m.design);
  if (notBuilt.length) out.push(h("div", { class: "warn" }, `Designed but not built: ${notBuilt.map((m) => m.name).join(", ")}`));
  if (designed.length || d?.node?.design) {
    const names = new Set((d?.columns || []).filter((m) => m.design).map((m) => String(m.name).toLowerCase()));
    const extra = s.columns.filter((c) => !names.has(String(c.name).toLowerCase()));
    if (extra.length) out.push(h("div", { class: "warn" }, `Built but not in the design: ${extra.map((c) => c.name).join(", ")}`));
    const norm = (t) => String(t || "").toUpperCase().replace(/\s+/g, "");
    const typeDiffs = designed
      .map((m) => [m, findCol(s, m)])
      .filter(([m, c]) => c && m.design.dataType && c.dataType && norm(m.design.dataType) !== norm(c.dataType));
    if (typeDiffs.length)
      out.push(h("div", { class: "warn" }, `Data type differs from the design: ${typeDiffs.map(([m, c]) => `${c.name} (designed ${m.design.dataType}, built ${c.dataType})`).join("; ")}`));
  }
  if (otherOrphans.length) out.push(h("div", { class: "warn" }, `Metadata for columns no longer in this node is kept as-is: ${otherOrphans.map((m) => m.name).join(", ")}`));
  return out;
}

function renderInspector() {
  const root = $("inspector");
  root.replaceChildren();
  const sel = S.sel;
  const rels = relations();

  if (!sel) {
    const nRel = rels.length;
    let nTagged = 0;
    const inModel = modelNodes();
    for (const s of inModel) for (const c of s.columns) { const m = getMeta(keyOf(s), c); if (m && (m.label || m.roles?.length || m.tags?.length)) nTagged++; }
    const def = currentDef() || {};
    // Drop package prefixes ("Datavault by Scalefree: Hub" -> "Hub") to keep the summary readable.
    const typeNames = (def.include?.nodeTypes || []).map((id) => String(S.typeById.get(id)?.name || id).replace(/^.*?:\s*/, ""));
    const keysIn = new Set(inModel.map(keyOf));
    const nRelIn = rels.filter((x) => keysIn.has(x.key) && keysIn.has(x.tKey)).length;
    add(root, 
      h("h2", {}, def.name || "Model"),
      h("div", { class: "muted" }, def.type || "No model type"),
      h(
        "dl",
        { class: "kv", style: { marginTop: "10px" } },
        h("dt", {}, "Node types"), h("dd", {}, typeNames.join(", ") || "any"),
        h("dt", {}, "Locations"), h("dd", {}, (def.include?.locations || []).join(", ") || "any"),
        h("dt", {}, "Nodes"), h("dd", {}, inModel.length),
        h("dt", {}, "Enriched columns"), h("dd", {}, nTagged),
        h("dt", {}, "Relations"), h("dd", {}, nRelIn),
        h("dt", {}, "Files"), h("dd", {}, `model/models/${S.current}.yml, .dbml`),
      ),
      h("div", { class: "actions" }, h("button", { onclick: () => modelDialog(S.current) }, "Edit model")),
      inModel.length ? null : h("div", { class: "warn" }, "No nodes match this model. Use Edit model to pick node types or storage locations."),
      h("h4", {}, "How to"),
      h(
        "ul",
        { class: "help" },
        h("li", {}, "Click a column to label and tag it. Shift/⌘-click to tag several at once."),
        h("li", {}, "Click a node title to give the entity a business name. Drag the title to move it."),
        h("li", {}, "Drag from the ● handle on a column onto a column in another node to add a relation, then name it. Relations are made between columns, so turn Columns on to add one."),
        h("li", {}, "Scroll to zoom towards the pointer; drag the background to pan."),
        h("li", {}, "Column labels, tags and relations belong to the node, so they show in every model that includes it."),
        h("li", {}, "Save writes model/nodes/*.yml, and model/models/<model>.yml and .dbml for every model."),
      ),
    );
    return;
  }

  if (sel.type === "cols") {
    const targets = sel.items.map((i) => ({ key: i.key, col: colById(i.key, i.colId) })).filter((t) => t.col);
    if (targets.length === 1) {
      const { key, col } = targets[0];
      const s = S.byKey.get(key);
      const m = getMeta(key, col);
      const input = h("input", { value: m?.label || "", placeholder: humanize(col.name.toLowerCase()) });
      input.addEventListener("input", () => {
        getMeta(key, col, true).label = input.value.trim() ? input.value : undefined;
        markDirty();
        renderCanvas();
      });
      add(root, 
        h("h2", {}, col.name),
        h("div", { class: "muted" }, `${s.location}.${s.name}`),
        field("Business label", input),
        h("h4", {}, "Column"),
        h("dl", { class: "kv" }, h("dt", {}, "Type"), h("dd", {}, col.dataType || "—"), h("dt", {}, "Nullable"), h("dd", {}, col.nullable ? "yes" : "no"), h("dt", {}, "Description"), h("dd", {}, col.description || "—")),
        designInfo(m?.planned || m?.design, !!m?.planned),
        tagChecklist(targets),
        h("h4", {}, "Relations"),
        h("div", {}, relationList(rels.filter((x) => x.pairs.some((p) => (x.key === key && p.s.id === col.id) || (x.tKey === key && p.t.id === col.id))))),
      );
      setTimeout(() => sel === S.sel && document.activeElement === document.body && input.focus(), 0);
    } else {
      add(root, 
        h("h2", {}, `${targets.length} columns`),
        h("div", { class: "muted" }, targets.map((t) => `${S.byKey.get(t.key).name}.${t.col.name}`).join(", ")),
        tagChecklist(targets),
      );
    }
    return;
  }

  if (sel.type === "node") {
    const s = S.byKey.get(sel.key);
    const d = getDoc(sel.key);
    const input = h("input", { value: d?.node?.label || "", placeholder: humanize(s.name.toLowerCase()) });
    input.addEventListener("input", () => {
      getDoc(sel.key, true).node.label = input.value.trim() ? input.value : undefined;
      markDirty();
      renderCanvas();
    });
    const orphans = (d?.columns || []).filter((m) => !findCol(s, m));
    add(root, 
      h("h2", {}, s.name),
      h("div", { class: "muted" }, `${s.location} · ${typeOf(s).name}`),
      field("Entity label", input),
      h("h4", {}, "Node"),
      h("dl", { class: "kv" }, h("dt", {}, "Columns"), h("dd", {}, s.columns.length), h("dt", {}, "Format"), h("dd", {}, s.planned ? "Planned: not built in Coalesce yet" : s.format === "sql" ? "SQL node (.sql) — column types not available" : "YAML node (.yml)"), h("dt", {}, "Description"), h("dd", {}, s.description || "—"), h("dt", {}, "Metadata"), h("dd", {}, `model/nodes/${sel.key}.yml`)),
      plannedChanges(s),
      ...designDifferences(s, d, orphans),
      h("h4", {}, "Relations"),
      h("div", {}, relationList(rels.filter((x) => x.key === sel.key || x.tKey === sel.key))),
    );
    return;
  }

  if (sel.type === "rel") {
    const x = rels.find((y) => y.key === sel.key && y.r.id === sel.relId);
    if (!x) { S.sel = null; return renderInspector(); }
    const r = x.r;
    const input = h("input", { value: r.label || "", placeholder: "e.g. placed by" });
    input.addEventListener("input", () => {
      r.label = input.value;
      markDirty();
      renderEdges();
    });
    input.addEventListener("keydown", (e) => e.key === "Enter" && input.blur());
    const select = h("select", {}, CARDINALITIES.map(([v, label, a, b]) => h("option", { value: v, selected: (r.cardinality || "many-to-one") === v }, `${label} (${a}:${b})`)));
    select.addEventListener("change", () => {
      r.cardinality = select.value;
      markDirty();
      renderEdges();
    });
    add(root, 
      h("h2", {}, r.label || "Relation"),
      ...x.pairs.map((p) => h("div", { class: "muted path" }, `${x.s.location}.${x.s.name}.${p.s.name} → ${x.t.location}.${x.t.name}.${p.t.name}`)),
      x.broken ? h("div", { class: "warn" }, "The target node or a column of this relation no longer exists.") : null,
      field("Label", input),
      field("Cardinality", select),
      h("div", { class: "actions" }, h("button", { onclick: () => reverseRelation(x) }, "Reverse direction"), h("span", { class: "grow" }), h("button", { class: "danger", onclick: () => deleteRelation(sel.key, sel.relId) }, "Delete")),
    );
    if (sel.focusLabel) {
      delete sel.focusLabel;
      setTimeout(() => input.focus(), 0);
    }
  }
}

function select(sel) {
  S.sel = sel;
  render();
  clearNote(); // a successful selection ends any note
}

// ---------- relation edits ----------

function createRelation(fromKey, fromColId, toKey, toColId) {
  const s = S.byKey.get(fromKey), t = S.byKey.get(toKey);
  const sc = colById(fromKey, fromColId), tc = colById(toKey, toColId);
  if (!s || !t || !sc || !tc || (fromKey === toKey && fromColId === toColId)) return;
  const existing = relations().find(
    (x) => x.key === fromKey && x.tKey === toKey && x.pairs.length === 1 && x.pairs[0].s.id === sc.id && x.pairs[0].t.id === tc.id,
  );
  if (existing) return select({ type: "rel", key: fromKey, relId: existing.r.id, focusLabel: true });
  const d = getDoc(fromKey, true);
  const r = {
    id: uuid(),
    label: "",
    cardinality: "many-to-one",
    target: { id: t.id, location: t.location, name: t.name },
    columns: [{ source: { id: sc.id, name: sc.name }, target: { id: tc.id, name: tc.name } }],
  };
  (d.relations ||= []).push(r);
  markDirty();
  select({ type: "rel", key: fromKey, relId: r.id, focusLabel: true });
}

function deleteRelation(key, relId) {
  const d = getDoc(key);
  if (!d?.relations) return;
  d.relations = d.relations.filter((r) => r.id !== relId);
  markDirty();
  select(null);
}

function reverseRelation(x) {
  if (x.broken) return;
  const flip = { "many-to-one": "one-to-many", "one-to-many": "many-to-one" };
  const r = x.r;
  const d = getDoc(x.key);
  d.relations = d.relations.filter((y) => y !== r);
  const s = x.s;
  const nr = {
    ...r,
    cardinality: flip[r.cardinality] || r.cardinality,
    target: { id: s.id, location: s.location, name: s.name },
    columns: (r.columns || []).map((p) => ({ ...p, source: p.target, target: p.source })),
  };
  (getDoc(x.tKey, true).relations ||= []).push(nr);
  markDirty();
  select({ type: "rel", key: x.tKey, relId: nr.id });
}

// ---------- vocabulary ----------

// Every column metadata entry across the model, for renaming or removing a tag everywhere.
function* allMeta() {
  for (const d of Object.values(S.model)) for (const m of d?.columns || []) yield m;
}

// Create a tag (no args) or edit an existing role/tag. Role keys stay fixed because generators
// read them; tag keys can be renamed, which rewrites every column that carries the tag.
function tagDialog(group, key) {
  const editing = !!key;
  const entry = editing ? S.vocab[group]?.[key] || {} : {};
  const dlg = $("tagDialog");
  const label = $("tagLabel"), keyIn = $("tagKey"), color = $("tagColor");
  $("tagTitle").textContent = editing ? `Edit ${group === "roles" ? "role" : "tag"}` : "New tag";
  $("tagOk").textContent = editing ? "Apply" : "Add tag";
  label.value = editing ? entry.label || humanize(key) : "";
  keyIn.value = editing ? key : "";
  keyIn.disabled = group === "roles";
  $("tagKeyHint").hidden = group !== "roles";
  $("tagDelete").hidden = !editing || group === "roles";
  color.value = /^#[0-9a-f]{6}$/i.test(entry.color || "") ? entry.color : "#4C8BF5";
  let keyEdited = editing;
  label.oninput = () => {
    if (keyEdited) return;
    const words = label.value.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
    keyIn.value = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("");
  };
  keyIn.oninput = () => (keyEdited = true);

  dlg.onclose = () => {
    const action = dlg.returnValue;
    if (action === "delete") {
      const n = [...allMeta()].filter((m) => m.tags?.includes(key)).length;
      if (n && !confirm(`Remove "${label.value}" from ${n} column${n > 1 ? "s" : ""} and delete it?`)) return;
      for (const m of allMeta()) if (m.tags) m.tags = m.tags.filter((t) => t !== key);
      delete S.vocab.tags[key];
      if (S.highlight?.key === key) S.highlight = null;
    } else if (action === "ok") {
      const newKey = keyIn.value.trim();
      const g = group || "tags";
      const taken = (k) => k !== key && (S.vocab.tags?.[k] || S.vocab.roles?.[k]);
      if (!newKey || taken(newKey)) return alert(`Tag "${newKey}" already exists.`);
      const value = { ...entry, label: label.value.trim(), color: color.value.toUpperCase() };
      // Rebuild the map so a renamed key keeps its position in tags.yml.
      const entries = Object.entries(S.vocab[g] || {});
      S.vocab[g] = Object.fromEntries(editing ? entries.map(([k, v]) => (k === key ? [newKey, value] : [k, v])) : [...entries, [newKey, value]]);
      if (editing && newKey !== key) {
        for (const m of allMeta()) if (m[g]) m[g] = m[g].map((t) => (t === key ? newKey : t));
        if (S.highlight?.key === key) S.highlight = { group: g, key: newKey };
      }
    } else return;
    S.vocabDirty = true;
    markDirty();
    render();
  };
  dlg.returnValue = "";
  dlg.showModal();
}

// ---------- models ----------

// All-columns, 8-columns and compact views keep separate positions: card sizes differ too much to
// share them. The 8-columns view starts from the all-columns arrangement (its cards are shorter,
// so nothing overlaps).
function layoutFor(def) {
  if (!def) return {};
  const k = !S.showColumns ? "compactLayout" : S.limitColumns ? "limitedLayout" : "layout";
  if (!def[k] || typeof def[k] !== "object") def[k] = k === "limitedLayout" ? structuredClone(def.layout || {}) : {};
  return def[k];
}

function updateColumnButtons() {
  $("btnColumns").setAttribute("aria-pressed", String(S.showColumns));
  $("btnLimit").setAttribute("aria-pressed", String(S.limitColumns));
  $("btnLimit").disabled = !S.showColumns;
}

function setLimitColumns(on) {
  S.limitColumns = on;
  localStorage.setItem(`dm.limitColumns.${S.current}`, on ? "1" : "0");
  updateColumnButtons();
  S.layout = layoutFor(currentDef());
  render();
  placeMissing();
  fit();
}

function setShowColumns(on) {
  S.showColumns = on;
  updateColumnButtons();
  localStorage.setItem(`dm.showColumns.${S.current}`, on ? "1" : "0");
  S.layout = layoutFor(currentDef());
  if (!on && S.sel?.type === "cols") S.sel = null;
  render();
  placeMissing();
  fit();
}

const modelSlugs = () => Object.keys(S.models).sort((a, b) => String(S.models[a].name).localeCompare(String(S.models[b].name)));

function setCurrentModel(slug, { render: doRender = true } = {}) {
  if (!S.models[slug]) slug = modelSlugs()[0];
  S.current = slug;
  localStorage.setItem("dm.currentModel", slug);
  const def = S.models[slug];
  S.showColumns = localStorage.getItem(`dm.showColumns.${slug}`) !== "0";
  S.limitColumns = localStorage.getItem(`dm.limitColumns.${slug}`) === "1";
  S.colScroll = {};
  updateColumnButtons();
  S.layout = layoutFor(def);
  S.hiddenLocs = new Set(JSON.parse(localStorage.getItem(`dm.hiddenLocations.${slug}`) || "[]"));
  S.hiddenTypes = new Set(JSON.parse(localStorage.getItem(`dm.hiddenTypes.${slug}`) || "[]"));
  S.hiddenStatus = new Set(JSON.parse(localStorage.getItem(`dm.hiddenStatus.${slug}`) || "[]"));
  if (!selectionValid(S.sel)) S.sel = null;
  renderModelSelect();
  if (doRender) {
    render();
    placeMissing();
    fit();
  }
}

function renderModelSelect() {
  $("modelSelect").replaceChildren(
    ...modelSlugs().map((slug) => {
      const d = S.models[slug];
      return h("option", { value: slug, selected: slug === S.current }, d.type ? `${d.name} · ${d.type}` : d.name);
    }),
  );
}

// Model files as written: known keys first, unknown keys kept, layout trimmed to nodes in the model.
function payloadModels() {
  const out = {};
  for (const [slug, def] of Object.entries(S.models)) {
    const trim = (positions) => {
      const out = {};
      for (const n of S.nodes) {
        const p = positions?.[keyOf(n)];
        if (p && Models.includes(def, n)) out[keyOf(n)] = { x: Math.round(p.x), y: Math.round(p.y) };
      }
      return out;
    };
    const o = { name: def.name, type: def.type || "", include: { nodeTypes: def.include?.nodeTypes || [], locations: def.include?.locations || [] } };
    for (const [k, v] of Object.entries(def)) if (!(k in o) && !["layout", "limitedLayout", "compactLayout"].includes(k)) o[k] = v;
    o.layout = trim(def.layout);
    if (def.limitedLayout && Object.keys(def.limitedLayout).length) o.limitedLayout = trim(def.limitedLayout);
    if (def.compactLayout && Object.keys(def.compactLayout).length) o.compactLayout = trim(def.compactLayout);
    out[slug] = o;
  }
  return out;
}

// Create (no slug) or edit a model: name, type and which node types / locations it includes.
function modelDialog(slug) {
  const editing = !!slug && !!S.models[slug];
  const def = editing ? S.models[slug] : { name: "", type: "", include: { nodeTypes: [], locations: [] } };
  const selTypes = new Set(def.include?.nodeTypes || []);
  const selLocs = new Set(def.include?.locations || []);
  const dlg = $("modelDialog");
  const nameIn = $("modelName"), typeIn = $("modelType"), presetIn = $("modelTypePreset"), filterIn = $("typeFilter");
  const OTHER = "__other__";
  let onlyUsed = false;

  $("modelTitle").textContent = editing ? `Edit model` : "New model";
  $("modelOk").textContent = editing ? "Apply" : "Create model";
  $("modelDelete").hidden = !editing || Object.keys(S.models).length < 2;
  nameIn.value = def.name || "";
  // Preset dropdown plus "Other…", which reveals a free-text type name.
  const preset = Models.PRESETS.find((p) => p.type.toLowerCase() === String(def.type || "").toLowerCase());
  presetIn.replaceChildren(
    h("option", { value: "" }, "— choose a model type —"),
    ...Models.PRESETS.map((p) => h("option", { value: p.type }, p.type)),
    h("option", { value: OTHER }, "Other…"),
  );
  presetIn.value = preset ? preset.type : def.type ? OTHER : "";
  typeIn.value = preset ? "" : def.type || "";
  typeIn.hidden = presetIn.value !== OTHER;
  const typeValue = () => (presetIn.value === OTHER ? typeIn.value.trim() : presetIn.value);
  filterIn.value = "";

  const typeCount = new Map();
  const locCount = new Map();
  for (const n of S.nodes) {
    typeCount.set(n.nodeType, (typeCount.get(n.nodeType) || 0) + 1);
    locCount.set(n.location, (locCount.get(n.location) || 0) + 1);
  }
  // Node types used by nodes (or selected) but missing a definition still need to be pickable.
  const types = [...S.nodeTypes];
  for (const id of new Set([...typeCount.keys(), ...selTypes])) if (id && !S.typeById.has(id)) types.push({ id, name: id, color: DEFAULT_TYPE_COLOR, origin: "Undefined" });

  const updateMatch = () => {
    const tmp = { include: { nodeTypes: [...selTypes], locations: [...selLocs] } };
    const n = S.nodes.filter((x) => Models.includes(tmp, x)).length;
    $("modelMatch").textContent = !selTypes.size && !selLocs.size ? "Select at least one node type or storage location." : `${n} node${n === 1 ? "" : "s"} match.`;
  };
  const check = (set, value, label, extra, count) => {
    const cb = h("input", { type: "checkbox", checked: set.has(value) });
    cb.addEventListener("change", () => {
      cb.checked ? set.add(value) : set.delete(value);
      updateMatch();
    });
    return h("label", { class: count ? "" : "unused", title: String(value) }, cb, extra, label, h("span", { class: "count" }, count || ""));
  };
  const renderTypes = () => {
    const q = filterIn.value.trim().toLowerCase();
    const groups = new Map();
    for (const t of types) {
      if (q && !`${t.name} ${t.id}`.toLowerCase().includes(q)) continue;
      if (onlyUsed && !typeCount.get(t.id) && !selTypes.has(t.id)) continue;
      if (!groups.has(t.origin)) groups.set(t.origin, []);
      groups.get(t.origin).push(t);
    }
    $("typeList").replaceChildren(
      ...[...groups].flatMap(([origin, ts]) => [
        h("h5", {}, origin),
        ...ts.sort((a, b) => a.name.localeCompare(b.name)).map((t) => check(selTypes, t.id, t.name, h("span", { class: "sq", style: { background: t.color } }), typeCount.get(t.id))),
      ]),
    );
  };
  const renderLocs = () =>
    $("locPickList").replaceChildren(...[...locCount.keys()].sort().map((loc) => check(selLocs, loc, loc, null, locCount.get(loc))));

  presetIn.onchange = () => {
    typeIn.hidden = presetIn.value !== OTHER;
    if (presetIn.value === OTHER) return typeIn.focus();
    const ids = Models.presetNodeTypes(presetIn.value, S.nodeTypes);
    if (!ids) return;
    selTypes.clear();
    ids.forEach((id) => selTypes.add(id));
    if (!nameIn.value.trim()) nameIn.value = presetIn.value;
    renderTypes();
    updateMatch();
  };
  filterIn.oninput = renderTypes;
  $("btnTypesUsed").onclick = () => { onlyUsed = !onlyUsed; $("btnTypesUsed").textContent = onlyUsed ? "show all" : "only used"; renderTypes(); };
  $("btnTypesUsed").textContent = "only used";
  $("btnTypesNone").onclick = () => { selTypes.clear(); renderTypes(); updateMatch(); };
  $("btnLocsNone").onclick = () => { selLocs.clear(); renderLocs(); updateMatch(); };
  renderTypes();
  renderLocs();
  updateMatch();

  dlg.querySelector("form").onsubmit = (e) => {
    if (e.submitter?.value === "ok" && !selTypes.size && !selLocs.size) {
      e.preventDefault();
      $("modelMatch").textContent = "Select at least one node type or storage location.";
    }
  };
  dlg.onclose = () => {
    const action = dlg.returnValue;
    if (action === "delete") {
      if (!confirm(`Delete the model "${def.name}"? Its .yml and .dbml files are removed on save. Node metadata is kept.`)) return;
      delete S.models[slug];
      S.deletedModels.add(slug);
      localStorage.removeItem(`dm.hiddenLocations.${slug}`);
      markDirty();
      setCurrentModel(modelSlugs()[0]);
    } else if (action === "ok") {
      const include = { nodeTypes: [...selTypes], locations: [...selLocs] };
      if (editing) {
        Object.assign(def, { name: nameIn.value.trim(), type: typeValue(), include });
        markDirty();
        setCurrentModel(slug);
      } else {
        const newSlug = Models.slugify(nameIn.value, Object.keys(S.models));
        S.models[newSlug] = { name: nameIn.value.trim(), type: typeValue(), include, layout: {} };
        S.deletedModels.delete(newSlug);
        markDirty();
        setCurrentModel(newSlug);
      }
    }
  };
  dlg.returnValue = "";
  dlg.showModal();
}

// ---------- filters ----------

// Re-apply the filters: drop selections that point into hidden nodes, redraw, place newcomers.
function applyFilters() {
  const sel = S.sel;
  if (sel?.type === "node" && !isVisible(sel.key)) S.sel = null;
  if (sel?.type === "cols") {
    const items = sel.items.filter((i) => isVisible(i.key));
    S.sel = items.length ? { type: "cols", items } : null;
  }
  if (sel?.type === "rel" && !selectionValid(sel)) S.sel = null;
  render();
  placeMissing();
}

function setHiddenLocations(set) {
  S.hiddenLocs = set;
  localStorage.setItem(`dm.hiddenLocations.${S.current}`, JSON.stringify([...set]));
  applyFilters();
}
function setHiddenTypes(set) {
  S.hiddenTypes = set;
  localStorage.setItem(`dm.hiddenTypes.${S.current}`, JSON.stringify([...set]));
  applyFilters();
}
function setTypeVisible(id, on) {
  const set = new Set(S.hiddenTypes);
  on ? set.delete(id) : set.add(id);
  setHiddenTypes(set);
}
function soloType(id) {
  setHiddenTypes(new Set(modelNodes().map((n) => n.nodeType).filter((t) => t !== id)));
  fit();
}
function setHiddenStatus(status, on) {
  const set = new Set(S.hiddenStatus);
  on ? set.delete(status) : set.add(status);
  S.hiddenStatus = set;
  localStorage.setItem(`dm.hiddenStatus.${S.current}`, JSON.stringify([...set]));
  applyFilters();
}
function clearFilters() {
  S.hiddenStatus = new Set();
  localStorage.removeItem(`dm.hiddenStatus.${S.current}`);
  S.search = "";
  $("search").value = "";
  S.highlight = null;
  S.hiddenLocs = new Set();
  S.hiddenTypes = new Set();
  localStorage.removeItem(`dm.hiddenLocations.${S.current}`);
  localStorage.removeItem(`dm.hiddenTypes.${S.current}`);
  applyFilters();
  fit();
}
function setLocationVisible(loc, on) {
  const set = new Set(S.hiddenLocs);
  on ? set.delete(loc) : set.add(loc);
  setHiddenLocations(set);
}
function soloLocation(loc) {
  setHiddenLocations(new Set(modelNodes().map((s) => s.location).filter((l) => l !== loc)));
  fit();
}

// ---------- viewport ----------

function applyView() {
  const { x, y, k } = S.view;
  $("world").style.transform = `translate(${x}px, ${y}px) scale(${k})`;
}

function zoomAt(factor, cx, cy) {
  const v = S.view;
  const k = Math.min(2.5, Math.max(0.2, v.k * factor));
  const wx = (cx - v.x) / v.k, wy = (cy - v.y) / v.k;
  S.view = { k, x: cx - wx * k, y: cy - wy * k };
  applyView();
}

function zoomCenter(factor) {
  const r = $("canvas").getBoundingClientRect();
  zoomAt(factor, r.width / 2, r.height / 2);
}

function bounds(keys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const card of $("nodes").children) {
    if (keys && !keys.includes(card.dataset.key)) continue;
    const p = S.layout[card.dataset.key];
    if (!p) continue;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + card.offsetWidth); y1 = Math.max(y1, p.y + card.offsetHeight);
  }
  return { x0, y0, x1, y1 };
}

function fit() {
  const b = bounds();
  if (!isFinite(b.x0)) return;
  const r = $("canvas").getBoundingClientRect();
  const pad = 40;
  const top = 56; // keep the floating graph controls clear of the nodes
  const k = Math.min(1, (r.width - 2 * pad) / (b.x1 - b.x0), (r.height - top - pad) / (b.y1 - b.y0));
  S.view = { k, x: (r.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: top - b.y0 * k };
  applyView();
}

function centerOn(key) {
  const b = bounds([key]);
  if (!isFinite(b.x0)) return;
  const r = $("canvas").getBoundingClientRect();
  const k = S.view.k;
  // Centre the node; one taller than the view is top-aligned so its title stays visible.
  const tall = (b.y1 - b.y0) * k > r.height - 112;
  S.view = { k, x: r.width / 2 - ((b.x0 + b.x1) / 2) * k, y: tall ? 56 - b.y0 * k : r.height / 2 - ((b.y0 + b.y1) / 2) * k };
  applyView();
}

// Layout of the visible nodes (see layout.js): star layout for dimensional model types, spine
// layout for Data Vault, otherwise layered with the "one" side of a relation right of the "many"
// side, like lineage flow. onlyMissing places just the nodes without a position yet,
// to the right of the ones the user already arranged.
function placeMissing() {
  const visible = visibleNodes().map(keyOf);
  if (!visible.some((k) => !S.layout[k])) return;
  autoLayout(visible.some((k) => S.layout[k]));
  render();
}

function autoLayout(onlyMissing) {
  const cards = new Map([...$("nodes").children].map((c) => [c.dataset.key, c]));
  const keys = visibleNodes().map(keyOf).filter((k) => !onlyMissing || !S.layout[k]);
  if (!keys.length) return;
  const inSet = new Set(keys);
  const nodes = keys.map((key) => {
    const card = cards.get(key);
    const ports = {};
    for (const row of card?.querySelectorAll(".ColumnLineageNode") || []) ports[row.dataset.col] = rowOffset(row).y;
    const t = typeOf(S.byKey.get(key));
    return { key, w: card?.offsetWidth || 240, h: card?.offsetHeight || 200, ports, fact: Models.isFactType(t), role: Models.vaultRole(t) };
  });
  const edges = [];
  for (const x of relations()) {
    if (x.broken || !inSet.has(x.key) || !inSet.has(x.tKey)) continue;
    const flip = x.r.cardinality === "one-to-many";
    for (const p of x.pairs)
      edges.push(flip ? { from: x.tKey, fromPort: p.t.id, to: x.key, toPort: p.s.id } : { from: x.key, fromPort: p.s.id, to: x.tKey, toPort: p.t.id });
  }
  let origin = { x: 40, y: 40 };
  if (onlyMissing) {
    const placed = visibleNodes().map(keyOf).filter((k) => S.layout[k] && !inSet.has(k));
    if (placed.length) origin = { x: bounds(placed).x1 + 120, y: bounds(placed).y0 };
  }
  const def = currentDef();
  const engine = Models.isDimensional(def) ? ModelLayout.starLayout : Models.isDataVault(def) ? ModelLayout.spineLayout : ModelLayout.layout;
  const pos = engine(nodes, edges, { origin, maxHeight: Math.max(700, $("canvas").clientHeight / 0.8) });
  Object.assign(S.layout, pos);
}

// ---------- gestures ----------

function worldPoint(e) {
  const r = $("canvas").getBoundingClientRect();
  return { x: (e.clientX - r.left - S.view.x) / S.view.k, y: (e.clientY - r.top - S.view.y) / S.view.k };
}

function setupCanvas() {
  const canvas = $("canvas");

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest(".graph-controls")) return;
    const handle = e.target.closest(".handle");
    const title = e.target.closest(".LineageStepTitle, .nameBox");
    const row = e.target.closest(".ColumnLineageNode");
    const rel = e.target.closest("[data-rel]");
    if (handle && row) {
      const a = anchor(row.dataset.key, row.dataset.col);
      const right = handle.classList.contains("r");
      S.gesture = { type: "link", key: row.dataset.key, colId: row.dataset.col, from: right ? { ...a, xl: a.xr } : { ...a, xr: a.xl }, to: null };
      document.body.classList.add("linking");
      e.preventDefault();
    } else if (title) {
      const p = S.layout[title.dataset.key];
      S.gesture = { type: "drag", key: title.dataset.key, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
      e.preventDefault();
    } else if (row || rel) {
      // handled on click
    } else {
      S.gesture = { type: "pan", sx: e.clientX, sy: e.clientY, ox: S.view.x, oy: S.view.y, moved: false };
      canvas.classList.add("panning");
    }
  });

  window.addEventListener("mousemove", (e) => {
    const g = S.gesture;
    if (!g) return;
    if (g.type === "pan") {
      g.moved ||= Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) > 3;
      S.view.x = g.ox + e.clientX - g.sx;
      S.view.y = g.oy + e.clientY - g.sy;
      applyView();
    } else if (g.type === "drag") {
      g.moved ||= Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) > 3;
      if (!g.moved) return;
      S.layout[g.key] = { x: Math.round(g.ox + (e.clientX - g.sx) / S.view.k), y: Math.round(g.oy + (e.clientY - g.sy) / S.view.k) };
      const card = $("nodes").querySelector(`.StepNodeContainer[data-key="${CSS.escape(g.key)}"]`);
      card.style.left = `${S.layout[g.key].x}px`;
      card.style.top = `${S.layout[g.key].y}px`;
      renderEdges();
    } else if (g.type === "link") {
      g.to = worldPoint(e);
      renderEdges();
    }
  });

  window.addEventListener("mouseup", (e) => {
    const g = S.gesture;
    S.gesture = null;
    canvas.classList.remove("panning");
    document.body.classList.remove("linking");
    if (!g) return;
    if (g.type === "pan" && !g.moved && e.target.closest("#canvas")) select(null);
    else if (g.type === "drag") {
      if (g.moved) markDirty();
      else {
        select({ type: "node", key: g.key });
      }
    } else if (g.type === "link") {
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest(".ColumnLineageNode");
      if (row) createRelation(g.key, g.colId, row.dataset.key, row.dataset.col);
      else renderEdges();
    }
  });

  canvas.addEventListener("click", (e) => {
    if (e.target.closest(".handle")) return;
    const rel = e.target.closest("[data-rel]");
    if (rel) return select({ type: "rel", key: rel.dataset.key, relId: rel.dataset.rel });
    const row = e.target.closest(".ColumnLineageNode");
    if (!row) return;
    const item = { key: row.dataset.key, colId: row.dataset.col };
    if ((e.shiftKey || e.metaKey || e.ctrlKey) && S.sel?.type === "cols") {
      const items = S.sel.items.filter((i) => !(i.key === item.key && i.colId === item.colId));
      if (items.length === S.sel.items.length) items.push(item);
      return select(items.length ? { type: "cols", items } : null);
    }
    select({ type: "cols", items: [item] });
  });

  canvas.addEventListener(
    "wheel",
    // Like the Coalesce graph: the wheel zooms towards the pointer, x1.1 per notch (deltaY 100),
    // and never pans (drag to pan). Trackpad scrolls and pinches (ctrlKey) zoom proportionally.
    (e) => {
      // Over a node whose column list can scroll, the wheel scrolls that list instead.
      const list = e.target.closest(".cols.limited");
      if (list && !e.ctrlKey && list.scrollHeight > list.clientHeight) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const lines = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const notches = (-e.deltaY * lines) / (e.ctrlKey ? 10 : 100);
      if (notches) zoomAt(Math.pow(1.1, notches), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
}

// ---------- save / load ----------

async function save() {
  if (!S.dirty) return;
  $("btnSave").disabled = true;
  setStatus("Saving…");
  S.busy = true;
  try {
    const model = payloadModel();
    const res = await (
      await api("PUT", "api/model", { model, models: payloadModels(), deletedModels: [...S.deletedModels], vocab: S.vocabDirty ? S.vocab : undefined })
    ).json();
    S.deletedModels.clear();
    for (const key of Object.keys(model)) S.fileKeys.add(key);
    S.signature = res.signature;
    $("banner").hidden = true;
    S.dirty = false;
    S.vocabDirty = false;
    confirmNote(res.written.length ? `Saved · ${res.written.length} file${res.written.length > 1 ? "s" : ""} written` : "Saved · no changes");
  } catch (err) {
    $("btnSave").disabled = false;
    setStatus(`Save failed: ${err.message}`, "error");
  } finally {
    S.busy = false;
  }
}

async function showDbml() {
  const text = await (await api("POST", "api/dbml", { model: payloadModel(), vocab: S.vocab, def: currentDef() })).text();
  $("dbmlText").textContent = text;
  $("dbmlDialog").showModal();
}

// First load fits the view; later reloads keep view and selection so edits made in the files
// (by hand or by an agent) just appear in place.
async function load({ initial = false } = {}) {
  S.busy = true;
  try {
    const data = await (await api("GET", "api/model")).json();
    S.nodes = data.nodes;
    S.nodeTypes = data.nodeTypes || [];
    S.typeById = new Map(S.nodeTypes.map((t) => [t.id, t]));
    S.models = data.models || {};
    S.deletedModels.clear();
    S.byKey = new Map(S.nodes.map((s) => [keyOf(s), s]));
    S.byId = new Map(S.nodes.map((s) => [s.id, s]));
    S.model = data.model || {};
    S.fileKeys = new Set(Object.keys(S.model));
    S.vocab = data.vocab || { roles: {}, tags: {} };
    S.vocabDirty = false;
    S.signature = data.signature;
    setCurrentModel(S.models[S.current] ? S.current : localStorage.getItem("dm.currentModel"), { render: false });
    S.dirty = false;
    $("btnSave").disabled = true;
    $("banner").hidden = true;
    if (!selectionValid(S.sel)) S.sel = null;
    if (S.highlight && !S.vocab[S.highlight.group]?.[S.highlight.key]) S.highlight = null;
    render();
    placeMissing();
    if (initial) fit();
    if (data.upgraded?.length) confirmNote(`${data.upgraded.length} planned node${data.upgraded.length > 1 ? "s" : ""} now built: ${data.upgraded.map((k) => k.split("-").slice(1).join("-")).join(", ")}`);
    else if (initial) clearNote();
    else confirmNote("Reloaded from disk");
  } finally {
    S.busy = false;
  }
}

function selectionValid(sel) {
  if (!sel) return true;
  if (sel.type === "node") return isVisible(sel.key);
  if (sel.type === "cols") return sel.items.every((i) => isVisible(i.key) && colById(i.key, i.colId));
  if (sel.type === "rel") return !!findRel(sel.key, sel.relId);
  return false;
}

function reload() {
  if (S.dirty && !confirm("Discard unsaved changes and reload from the YAML files?")) return;
  load().catch((e) => setStatus(`Reload failed: ${e.message}`, "error"));
}

// Poll the files' fingerprint: reload silently when there is nothing to lose, otherwise ask.
async function watchFiles() {
  if (S.busy || document.hidden || !S.signature) return;
  try {
    const { signature } = await (await api("GET", "api/signature")).json();
    if (S.busy || signature === S.signature) return;
    if (!S.dirty) await load();
    else if ($("banner").dataset.dismissed !== signature) $("banner").hidden = false;
    $("banner").dataset.pending = signature;
  } catch {}
}

function toggleSidebar(show = document.body.classList.contains("hide-sidebar")) {
  document.body.classList.toggle("hide-sidebar", !show);
  $("btnSidebar").classList.toggle("on", show);
  localStorage.setItem("dm.sidebar", show ? "1" : "0");
}

function toggleInspector(show = document.body.classList.contains("hide-inspector")) {
  document.body.classList.toggle("hide-inspector", !show);
  $("btnInspector").classList.toggle("on", show);
  localStorage.setItem("dm.inspector", show ? "1" : "0");
}

// ---------- wiring ----------

function init() {
  setupCanvas();
  $("btnSave").onclick = save;
  $("btnDbml").onclick = () => showDbml().catch((e) => setStatus(e.message, "error"));
  $("btnCloseDbml").onclick = () => $("dbmlDialog").close();
  $("btnCopyDbml").onclick = () => navigator.clipboard.writeText($("dbmlText").textContent);
  $("btnFit").onclick = fit;
  $("btnZoomIn").onclick = () => zoomCenter(1.2);
  $("btnZoomOut").onclick = () => zoomCenter(1 / 1.2);
  $("btnLayout").onclick = () => { autoLayout(false); markDirty(); render(); fit(); };
  $("btnReload").onclick = reload;
  $("modelSelect").onchange = (e) => setCurrentModel(e.target.value);
  $("btnEditModel").onclick = () => modelDialog(S.current);
  $("btnNewModel").onclick = () => modelDialog();
  $("btnBannerReload").onclick = () => { S.dirty = false; reload(); };
  $("btnBannerDismiss").onclick = () => { $("banner").hidden = true; $("banner").dataset.dismissed = $("banner").dataset.pending; };
  $("btnInspector").onclick = () => toggleInspector();
  $("btnSidebar").onclick = () => toggleSidebar();
  toggleSidebar(localStorage.getItem("dm.sidebar") !== "0");
  $("btnAllLocs").onclick = () => { setHiddenLocations(new Set()); fit(); };
  toggleInspector(localStorage.getItem("dm.inspector") !== "0");
  setInterval(watchFiles, 2500);
  $("btnNewTag").onclick = () => tagDialog();
  $("btnColumns").onclick = () => setShowColumns(!S.showColumns);
  $("btnLimit").onclick = () => setLimitColumns(!S.limitColumns);
  // Column lists scroll inside their node: remember the position and keep the lines attached.
  let edgeFrame = 0;
  $("nodes").addEventListener(
    "scroll",
    (e) => {
      if (!e.target.classList?.contains("cols")) return;
      S.colScroll[e.target.dataset.key] = e.target.scrollTop;
      cancelAnimationFrame(edgeFrame);
      edgeFrame = requestAnimationFrame(renderEdges);
    },
    true,
  );
  S.showLabels = localStorage.getItem("dm.showLabels") === "1";
  $("btnLabels").setAttribute("aria-pressed", String(S.showLabels));
  $("btnLabels").onclick = () => {
    S.showLabels = !S.showLabels;
    localStorage.setItem("dm.showLabels", S.showLabels ? "1" : "0");
    $("btnLabels").setAttribute("aria-pressed", String(S.showLabels));
    render();
  };
  for (const b of document.querySelectorAll("[data-icon]")) b.append(icon(b.dataset.icon));
  $("search").oninput = (e) => { S.search = e.target.value; applyFilters(); };
  $("btnClearFilters").onclick = clearFilters;
  $("btnAllTypes").onclick = () => { setHiddenTypes(new Set()); fit(); };

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); return; }
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (e.key === "Escape") {
      if (typing) document.activeElement.blur();
      else if (S.gesture) { S.gesture = null; document.body.classList.remove("linking"); renderEdges(); }
      else select(null);
    }
    if (!typing && !e.metaKey && !e.ctrlKey && (e.key === "i" || e.key === "I")) toggleInspector();
    if (!typing && !e.metaKey && !e.ctrlKey && (e.key === "b" || e.key === "B")) toggleSidebar();
    if (!typing && (e.key === "Delete" || e.key === "Backspace") && S.sel?.type === "rel") deleteRelation(S.sel.key, S.sel.relId);
  });
  window.addEventListener("beforeunload", (e) => { if (S.dirty) e.preventDefault(); });
  window.addEventListener("resize", renderEdges);
  applyView();
  load({ initial: true }).catch((e) => setStatus(`Load failed: ${e.message}`, "error"));
}

init();
