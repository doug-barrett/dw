// Model Browser — zero-dependency app (Node built-ins only). Reads the nodes/
// YAML, infers referential integrity between key columns, lets the UI add/draw
// relationships, and persists them (+ layout) to relationships.json in the app
// folder so the ERD can be reopened later.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const WORKSPACE = process.env.WORKSPACE_DIR || path.resolve(__dirname, "../..");
const NODES_DIR = path.join(WORKSPACE, "nodes");
const STORE = path.join(__dirname, "relationships.json");

// --- node-type labels -------------------------------------------------------
// sqlType is "<alias>:::<id>" (package) or a bare id (workspace type). Build a
// label map from every definition.yml on disk, then fall back to known DV ids.
const DV_FALLBACK = {
  "DV:::4": "DV Stage", "DV:::6": "Hub", "DV:::7": "Link",
  "DV:::8": "Satellite V0", "DV:::9": "Satellite V1",
};
// Colors for types whose definition.yml isn't on disk (DV package, built-in Source).
const COLOR_FALLBACK = {
  "DV:::4": "#72B7B2", "DV:::6": "#4C78A8", "DV:::7": "#E45756",
  "DV:::8": "#54A24B", "DV:::9": "#88B04B", "Source": "#6B7785",
};
// Build {sqlType: {name, color}} from every definition.yml on disk. Each type
// def carries a `tagColor` (hex like '#D9A438' or a CSS name like 'gray').
function scanTypeMeta() {
  const meta = {};
  function readDef(defPath, alias) {
    try {
      const txt = fs.readFileSync(defPath, "utf-8");
      const id = (txt.match(/^\s*id:\s*["']?(.+?)["']?\s*$/m) || [])[1];
      const name = (txt.match(/^\s*name:\s*(.+?)\s*$/m) || [])[1];
      if (!id || !name) return;
      const color = (txt.match(/tagColor:\s*['"]?(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)['"]?/) || [])[1] || null;
      meta[alias ? `${alias}:::${id}` : id] = { name, color };
    } catch {}
  }
  try {
    for (const d of fs.readdirSync(path.join(WORKSPACE, "nodeTypes")))
      readDef(path.join(WORKSPACE, "nodeTypes", d, "definition.yml"), null);
  } catch {}
  try {
    const pkgRoot = path.join(WORKSPACE, ".coa/cache/packages");
    for (const alias of fs.readdirSync(pkgRoot)) {
      const nt = path.join(pkgRoot, alias, "nodeTypes");
      try { for (const d of fs.readdirSync(nt)) readDef(path.join(nt, d, "definition.yml"), alias); } catch {}
    }
  } catch {}
  return meta;
}
function typeLabel(sqlType, meta) {
  return (meta[sqlType] && meta[sqlType].name) || DV_FALLBACK[sqlType] || sqlType;
}
function typeColor(sqlType, meta) {
  return (meta[sqlType] && meta[sqlType].color) || COLOR_FALLBACK[sqlType] || "#1f6feb";
}

// --- minimal node parser ----------------------------------------------------
// Pulls name, locationName, sqlType and the column list (with the few flags we
// need) out of a node .yml. The files are machine-generated with stable 2-space
// indentation, so a targeted line scan is reliable and keeps us dependency-free.
function idFromFile(file) {
  const base = file.replace(/\.(sql|yml)$/i, "");
  const dash = base.indexOf("-");
  const location = dash < 0 ? "" : base.slice(0, dash);
  const name = dash < 0 ? base : base.slice(dash + 1);
  return { location, name, id: location + "." + name };
}

function parseNode(file, content) {
  const info = idFromFile(file);
  const lines = content.split("\n");
  const top = (re) => { for (const l of lines) { const m = l.match(re); if (m) return m[1]; } return null; };
  const sqlType = top(/^\s*sqlType:\s*(.+?)\s*$/) || "";
  const locationName = top(/^\s*locationName:\s*["']?(.+?)["']?\s*$/) || info.location;

  // Find the metadata columns: block (4-space key) and iterate its 6-space items.
  const cols = [];
  let i = 0;
  while (i < lines.length && !/^    columns:\s*$/.test(lines[i])) i++;
  i++; // first item
  let cur = null;
  const flush = () => { if (cur && cur.name) cols.push(cur); cur = null; };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^    \S/.test(l) || /^  \S/.test(l) || /^\S/.test(l)) break; // dedent -> block ended
    if (/^      - /.test(l)) { flush(); cur = { name: null, flags: {} }; }
    if (!cur) continue;
    let m;
    if ((m = l.match(/^        name:\s*["']?(.+?)["']?\s*$/))) cur.name = m[1];
    else if (/^\s*is_system_ldts:\s*true/.test(l)) cur.flags.system = true;
    else if (/^\s*is_system_rsrc:\s*true/.test(l)) cur.flags.system = true;
    else if (/^\s*is_Hub_hk:\s*true/.test(l)) cur.flags.hubKey = true;
    else if (/^\s*hashedColumns:\s*$/.test(l)) cur.flags.hashed = true;
  }
  flush();
  return { id: info.id, name: info.name, location: locationName, sqlType, columns: cols };
}

function listNodeFiles() {
  try { return fs.readdirSync(NODES_DIR).filter((f) => /\.(sql|yml)$/i.test(f)); }
  catch { return []; }
}
function loadAllNodes() {
  const meta = scanTypeMeta();
  const nodes = [];
  for (const f of listNodeFiles()) {
    let c = "";
    try { c = fs.readFileSync(path.join(NODES_DIR, f), "utf-8"); } catch {}
    const n = parseNode(f, c);
    n.typeLabel = typeLabel(n.sqlType, meta);
    n.typeColor = typeColor(n.sqlType, meta);
    nodes.push(n);
  }
  return nodes;
}

// --- system-column handling -------------------------------------------------
// Never infer relationships on housekeeping columns common to every table.
const SYSTEM_NAMES = new Set([
  "LDTS", "RSRC", "RECORD_SOURCE", "REC_SRC", "LOADDATE", "LOAD_DATE", "LOAD_TS",
  "LOAD_DTS", "LOAD_TIMESTAMP", "LOAD_DATETIME", "DW_LOAD_DATE", "DW_UPDATE_DATE",
  "SYSTEM_LOAD_DATE", "SYSTEM_INSERT_DATE", "SYSTEM_UPDATE_DATE", "INSERT_DATE",
  "UPDATE_DATE", "CREATED_AT", "UPDATED_AT", "CREATED_DATE", "MODIFIED_DATE",
  "CREATE_DATE", "MODIFY_DATE", "IS_ACTIVE", "IS_CURRENT", "IS_LATEST",
  "IS_DELETED", "ACTIVE_FLAG", "CURRENT_FLAG", "DELETED_FLAG", "EFFECTIVE_FROM",
  "EFFECTIVE_TO", "VALID_FROM", "VALID_TO", "START_DATE", "END_DATE",
  "ROW_HASH", "CHANGE_HASH", "HASHDIFF", "HASH_DIFF", "ETL_BATCH_ID", "BATCH_ID",
]);
function isSystemColumn(col) {
  if (col.flags && col.flags.system) return true;
  const n = (col.name || "").toUpperCase();
  if (SYSTEM_NAMES.has(n)) return true;
  if (/^(DW_|META_|ETL_|DBT_|_)/.test(n)) return true;
  if (/_HASH$/.test(n) || /HASHDIFF/.test(n)) return true; // satellite change hashes
  return false;
}
function businessColumns(node) {
  return node.columns.filter((c) => !isSystemColumn(c));
}

// --- inference --------------------------------------------------------------
// A column is "key-like" if flagged as a hub hash key or its name ends with a
// key suffix. Relationships are inferred only between matching key-like column
// names; the parent (PK side) is the Hub/Dimension-ish owner of that key.
// Classify a key column so inference can be limited to one kind of key.
//   hash      — DV hub/link hash keys (flagged, or H_/L_..._KEY style)
//   surrogate — dimension surrogate keys (*_KEY / *_SK / *_SID / *_WID)
//   natural   — business/natural keys (*_ID / *_CODE / *_NO / *_NK / *_BK)
function keyClass(col) {
  const n = (col.name || "").toUpperCase();
  if (!n) return null;
  if (col.flags && (col.flags.hubKey || col.flags.hashed)) return "hash";
  if (/^(H|L|HK)_.+_(KEY|HK|HKEY)$/.test(n) || /_(HKEY|HASHKEY|HASH_KEY)$/.test(n)) return "hash";
  if (/^(H|L)_.+_KEY$/.test(n)) return "hash";
  if (/_(KEY|SK|SKEY|SID|WID)$/.test(n)) return "surrogate";
  if (/_(ID|CODE|NO|NUM|NBR|NK|BK)$/.test(n)) return "natural";
  return null;
}
function isKeyLike(col) { return keyClass(col) != null; }
const ALL_KEY_CLASSES = ["hash", "surrogate", "natural"];
function entityToken(name) {
  return (name || "").toUpperCase()
    .replace(/^(H|L|S|HUB|LINK|SAT|SATV0|SATV1|DVSTG|STG|DIM|FACT|FCT|BRIDGE|REF)_+/, "")
    .replace(/_(ID|KEY|SID|HKEY|HK|NK|BK|CODE)$/i, "");
}
function isParentType(label) {
  return /\b(hub|dimension|dim|reference|master)\b/i.test(label || "");
}

function inferRelationships(nodes, allowed) {
  const classes = new Set(allowed && allowed.length ? allowed : ALL_KEY_CLASSES);
  const byKeyName = new Map(); // KEYNAME -> [{node, col}]
  for (const n of nodes) {
    for (const c of businessColumns(n)) {
      const cls = keyClass(c);
      if (!cls || !classes.has(cls)) continue;
      const k = c.name.toUpperCase();
      if (!byKeyName.has(k)) byKeyName.set(k, []);
      byKeyName.get(k).push({ node: n, col: c });
    }
  }
  const rels = [];
  for (const [key, occ] of byKeyName) {
    if (occ.length < 2) continue; // need at least a parent and a child
    const token = entityToken(key);
    const score = (o) => {
      let s = 0;
      if (isParentType(o.node.typeLabel)) s += 100;
      if (entityToken(o.node.name) === token) s += 40;
      if (o.col.flags && o.col.flags.hubKey) s += 20;
      s -= businessColumns(o.node).length; // narrower table = more entity-like
      return s;
    };
    let owner = occ[0];
    for (const o of occ) if (score(o) > score(owner)) owner = o;
    for (const o of occ) {
      if (o.node.id === owner.node.id) continue;
      rels.push({
        id: relId(o.node.id, o.col.name, owner.node.id, owner.col.name),
        from: { node: o.node.id, column: o.col.name },   // child / FK side
        to: { node: owner.node.id, column: owner.col.name }, // parent / PK side
        origin: "inferred",
        keyClass: keyClass(owner.col),
      });
    }
  }
  return rels;
}
function relId(fn, fc, tn, tc) {
  return `${fn}:${fc}->${tn}:${tc}`;
}

// --- persistence ------------------------------------------------------------
// The file holds one or more named models, each with its own relationships,
// node positions, view options and inference key classes, plus the current one.
function blankModel() {
  return { relationships: [], positions: {}, collapsed: false, zoom: 1, types: [], inferKeys: ALL_KEY_CLASSES.slice() };
}
function loadStore() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(STORE, "utf-8")); } catch { raw = null; }
  if (raw && raw.models) return raw;
  // migrate an older flat file (or start fresh) into a "default" model
  const def = blankModel();
  if (raw) { def.relationships = raw.relationships || []; def.positions = raw.positions || {}; def.collapsed = !!raw.collapsed; }
  return { models: { default: def }, current: "default" };
}
function saveStore(store) {
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
}
function currentModel(store) {
  const name = store.current || "default";
  if (!store.models[name]) store.models[name] = blankModel();
  store.current = name;
  return store.models[name];
}

// --- http -------------------------------------------------------------------
function sendJson(res, body, code = 200) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
  });
}
function filterByTypes(nodes, typesParam) {
  if (!typesParam) return nodes;
  const want = new Set(typesParam.split(",").filter(Boolean));
  return nodes.filter((n) => want.has(n.sqlType));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname.replace(/^\/proxy(?=\/|$)/, "") || "/";
    try {
      if (p === "/api/types") {
        const nodes = loadAllNodes();
        const agg = new Map();
        for (const n of nodes) {
          if (!agg.has(n.sqlType)) agg.set(n.sqlType, { sqlType: n.sqlType, label: n.typeLabel, color: n.typeColor, count: 0 });
          agg.get(n.sqlType).count++;
        }
        const types = [...agg.values()].sort((a, b) => a.label.localeCompare(b.label));
        return sendJson(res, { types });
      }

      if (p === "/api/model") {
        const store = loadStore();
        const want = url.searchParams.get("name");
        if (want) { store.current = want; currentModel(store); saveStore(store); } // switch model
        const model = currentModel(store);
        // the UI may override the model's saved types for this request
        const typesParam = url.searchParams.has("types")
          ? url.searchParams.get("types")
          : (model.types || []).join(",");
        const all = loadAllNodes();
        const nodes = filterByTypes(all, typesParam).map((n) => ({
          id: n.id, name: n.name, location: n.location, sqlType: n.sqlType,
          typeLabel: n.typeLabel, typeColor: n.typeColor,
          columns: n.columns.map((c) => ({
            name: c.name, system: isSystemColumn(c),
            key: isKeyLike(c) && !isSystemColumn(c),
            keyClass: isSystemColumn(c) ? null : keyClass(c),
          })),
        }));
        const visible = new Set(nodes.map((n) => n.id));
        const saved = (model.relationships || []).filter(
          (r) => visible.has(r.from.node) && visible.has(r.to.node)
        );
        return sendJson(res, {
          nodes, relationships: saved,
          positions: model.positions || {}, collapsed: !!model.collapsed, zoom: model.zoom || 1,
          types: typesParam ? typesParam.split(",").filter(Boolean) : [],
          inferKeys: model.inferKeys || ALL_KEY_CLASSES.slice(),
          modelName: store.current, models: Object.keys(store.models),
        });
      }

      if (p === "/api/infer") {
        const nodes = filterByTypes(loadAllNodes(), url.searchParams.get("types"));
        const keys = (url.searchParams.get("keys") || "").split(",").filter(Boolean);
        const inferred = inferRelationships(nodes, keys);
        const existing = new Set((currentModel(loadStore()).relationships || []).map((r) => r.id));
        // suggestions = inferred edges not already saved (either direction)
        const missing = inferred.filter((r) => {
          const rev = relId(r.to.node, r.to.column, r.from.node, r.from.column);
          return !existing.has(r.id) && !existing.has(rev);
        });
        return sendJson(res, { inferred, missing });
      }

      if (p === "/api/relationships" && req.method === "POST") {
        const body = await readBody(req);
        const store = loadStore();
        const model = currentModel(store);
        const rels = model.relationships || [];
        const incoming = Array.isArray(body.add) ? body.add : body.from ? [body] : [];
        for (const r of incoming) {
          if (!r.from || !r.to) continue;
          const id = relId(r.from.node, r.from.column, r.to.node, r.to.column);
          const rev = relId(r.to.node, r.to.column, r.from.node, r.from.column);
          if (rels.some((x) => x.id === id || x.id === rev)) continue;
          rels.push({ id, from: r.from, to: r.to, origin: r.origin || "manual", keyClass: r.keyClass || null });
        }
        model.relationships = rels;
        saveStore(store);
        return sendJson(res, { relationships: rels });
      }

      if (p === "/api/relationships" && req.method === "DELETE") {
        const id = url.searchParams.get("id");
        const store = loadStore();
        const model = currentModel(store);
        // ?all=1 clears every relationship in the current model (start afresh)
        model.relationships = url.searchParams.get("all")
          ? []
          : (model.relationships || []).filter((r) => r.id !== id);
        saveStore(store);
        return sendJson(res, { relationships: model.relationships });
      }

      // Save the current diagram (positions, view, key classes) under a name.
      // A new name copies the current model's relationships into it (Save As).
      if (p === "/api/save" && req.method === "POST") {
        const body = await readBody(req);
        const store = loadStore();
        const cur = currentModel(store);
        const name = (body.name || store.current || "default").trim() || "default";
        let model;
        if (name === store.current) model = cur;
        else model = { relationships: JSON.parse(JSON.stringify(cur.relationships || [])) };
        model.positions = body.positions || model.positions || {};
        model.collapsed = typeof body.collapsed === "boolean" ? body.collapsed : !!model.collapsed;
        model.zoom = typeof body.zoom === "number" ? body.zoom : (model.zoom || 1);
        model.types = Array.isArray(body.types) ? body.types : (model.types || []);
        model.inferKeys = Array.isArray(body.inferKeys) ? body.inferKeys : (model.inferKeys || ALL_KEY_CLASSES.slice());
        store.models[name] = model;
        store.current = name;
        saveStore(store);
        return sendJson(res, { ok: true, modelName: name, models: Object.keys(store.models) });
      }

      if (p === "/api/models" && req.method === "DELETE") {
        const name = url.searchParams.get("name");
        const store = loadStore();
        if (name && store.models[name] && Object.keys(store.models).length > 1) {
          delete store.models[name];
          if (store.current === name) store.current = Object.keys(store.models)[0];
          saveStore(store);
        }
        return sendJson(res, { modelName: store.current, models: Object.keys(store.models) });
      }

      if (p === "/" || p === "/index.html") {
        res.setHeader("content-type", "text/html");
        return res.end(fs.readFileSync(path.join(__dirname, "index.html")));
      }
      res.statusCode = 404;
      res.end("Not found");
    } catch (err) {
      sendJson(res, { error: String((err && err.message) || err) }, 500);
    }
  })
  .listen(PORT, () => console.log(`Model Browser on :${PORT}, workspace=${WORKSPACE}`));
