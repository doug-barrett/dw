#!/usr/bin/env node
// Writes Data Modeler metadata (model/nodes/*.yml, model/models/*.yml, model/tags.yml) from a compact
// spec that names nodes and columns only. Node and column ids are resolved from the workspace, so a
// spec can never carry a wrong id. Existing files are merged, not replaced:
//   - columns not mentioned in the spec, unknown keys and layouts are kept;
//   - a column's label/roles/tags/planned are replaced only when the spec gives them;
//   - relations get a deterministic id from their columns, so re-applying updates them in place.
//
//   node apply-spec.js <spec.yml|spec.json> [--workspace <dir>] [--dry-run]
//
// Spec (YAML in the app's subset, or JSON):
//   models:                                   # model/models/<slug>.yml; layout kept if present
//     source: { name: Sales source, type: Source, include: { nodeTypes: [Source], locations: [] } }
//   tags:                                     # merged into model/tags.yml (roles are fixed)
//     code: { label: Code, color: "#FA8C16" }
//   nodes:
//     SRC-ORDERS:                             # <LOCATION>-<NAME>; built node, or planned (below)
//       label: Order
//       planned: { nodeType: Data-Vault:::6, description: ... }   # makes a missing node planned;
//                                             # on a built node: a planned change ({ delete: true } / nodeType)
//       columns:
//         O_ORDERKEY: { label: Order number, roles: [businessKeyPart] }
//         NEW_COL: { planned: { dataType: NUMBER, derivedFrom: [SRC-X.Y] } }   # planned column
//       relations:
//         - { to: SRC-CUSTOMER, label: placed by, cardinality: many-to-one, columns: { O_CUSTKEY: C_CUSTKEY } }
//       replaceRelations: true                # optional: drop this node's relations not in the spec
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const APP = path.resolve(__dirname, "../../..");
const YAML = require(path.join(APP, "yaml.js"));
const WS = require(path.join(APP, "workspace.js"));

const args = process.argv.slice(2);
const specFile = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--workspace");
if (!specFile) {
  console.error("usage: node apply-spec.js <spec.yml|spec.json> [--workspace <dir>] [--dry-run]");
  process.exit(2);
}
const dryRun = args.includes("--dry-run");
const WORKSPACE = path.resolve(
  args.includes("--workspace") ? args[args.indexOf("--workspace") + 1] : process.env.WORKSPACE_DIR || findUp(process.cwd()) || path.resolve(APP, "../.."),
);
function findUp(d) {
  for (; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, "data.yml"))) return d;
    if (path.dirname(d) === d) return null;
  }
}

const text = fs.readFileSync(specFile, "utf-8");
const spec = specFile.endsWith(".json") ? JSON.parse(text) : YAML.parse(text);
const MODEL = path.join(WORKSPACE, "model");
const readYaml = (f, fb) => {
  try {
    return YAML.parse(fs.readFileSync(f, "utf-8")) ?? fb;
  } catch (e) {
    if (e.code === "ENOENT") return fb;
    throw new Error(`${f}: ${e.message}`);
  }
};
const fail = (msg) => {
  console.error(`apply-spec: ${msg}`);
  process.exit(1);
};

function relId(from, cols, to) {
  const name = `${from}.${Object.keys(cols).join("+")}->${to}.${Object.values(cols).join("+")}`;
  const h = crypto.createHash("sha1").update("coalesce-data-modeler:" + name).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const real = new Map(WS.loadNodes(WORKSPACE).map((n) => [`${n.location}-${n.name}`, n]));
const specNodes = spec.nodes || {};
const out = new Map(); // file -> text

// ---------------------------------------------------------------- vocabulary
const TAGS = path.join(MODEL, "tags.yml");
// No vocabulary yet: start from the skill's template (the app's fixed roles plus common tags).
const TEMPLATE = path.join(__dirname, "..", "assets", "tags.yml");
if (!fs.existsSync(TAGS)) out.set(TAGS, fs.readFileSync(TEMPLATE, "utf-8"));
const vocab = readYaml(TAGS, null) || YAML.parse(fs.readFileSync(TEMPLATE, "utf-8"));
if (spec.roles) fail("roles are fixed by the app; only `tags` can be added");
if (spec.tags) {
  vocab.tags ||= {};
  for (const [k, v] of Object.entries(spec.tags)) vocab.tags[k] = { ...(vocab.tags[k] || {}), ...v };
  let header = "";
  try {
    header = (fs.readFileSync(fs.existsSync(TAGS) ? TAGS : TEMPLATE, "utf-8").match(/^(\s*#.*\n|\s*\n)*/) || [""])[0];
  } catch {}
  out.set(TAGS, (header ? header.replace(/\n*$/, "\n\n") : "") + YAML.stringify(vocab));
}
const roleKeys = new Set(Object.keys(vocab.roles || {}));
const tagKeys = new Set(Object.keys(vocab.tags || {}));

// ---------------------------------------------------------------- nodes
// Columns of a node as the spec sees it: built columns, then planned ones (existing file + spec).
function nodeColumns(key) {
  const r = real.get(key);
  if (r) return r.columns;
  const existing = readYaml(path.join(MODEL, "nodes", `${key}.yml`), null);
  const names = [...(existing?.columns || []).map((c) => c.name), ...Object.keys(specNodes[key]?.columns || {})];
  return [...new Set(names)].map((name) => ({ name }));
}
const isKnown = (key) => real.has(key) || !!specNodes[key]?.planned || !!readYaml(path.join(MODEL, "nodes", `${key}.yml`), null)?.node?.planned;

for (const [key, sn] of Object.entries(specNodes)) {
  const m = /^([^-/\\]+)-(.+)$/.exec(key);
  if (!m) fail(`node key "${key}" must be <LOCATION>-<NAME>`);
  const r = real.get(key);
  const file = path.join(MODEL, "nodes", `${key}.yml`);
  const doc = readYaml(file, null) || { modelVersion: 1, node: { location: m[1], name: m[2] }, columns: [] };
  doc.modelVersion = 1;
  doc.node ||= {};
  if (r) doc.node = { id: r.id, location: r.location, name: r.name, ...doc.node, id: r.id };
  else {
    if (!sn.planned?.nodeType && !doc.node.planned?.nodeType) fail(`${key}: no such node in nodes/ — give it planned: { nodeType } to plan it`);
    delete doc.node.id;
  }
  if (sn.label !== undefined) doc.node.label = sn.label;
  if (sn.planned !== undefined) doc.node.planned = sn.planned;

  doc.columns ||= [];
  for (const [name, sc] of Object.entries(sn.columns || {})) {
    const rc = r?.columns.find((c) => c.name === name) || r?.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (r && !rc && !sc?.planned) fail(`${key}.${name}: not a column of the node (add planned: to propose it)`);
    if (!r && !sc?.planned && !doc.columns.find((c) => c.name === name)?.planned) fail(`${key}.${name}: columns of a planned node need planned: { dataType }`);
    for (const k of sc?.roles || []) if (!roleKeys.has(k)) fail(`${key}.${name}: unknown role "${k}"`);
    for (const k of sc?.tags || []) if (!tagKeys.has(k)) fail(`${key}.${name}: unknown tag "${k}" (declare it under tags:)`);
    const colName = rc?.name || name;
    let c = doc.columns.find((x) => (rc && x.id === rc.id) || x.name === colName);
    if (!c) doc.columns.push((c = rc ? { id: rc.id, name: colName } : { name: colName }));
    if (rc) c.id = rc.id;
    else delete c.id;
    c.name = colName;
    for (const k of ["label", "roles", "tags", "planned"]) if (sc?.[k] !== undefined) c[k] = sc[k];
  }
  // Built node: keep the node's column order (unknown columns after, in file order).
  if (r) {
    const pos = new Map(r.columns.map((c, i) => [c.name, i]));
    doc.columns = doc.columns.map((c, i) => [c, pos.has(c.name) ? pos.get(c.name) : 1e6 + i]).sort((a, b) => a[1] - b[1]).map(([c]) => c);
  }
  // Same key order as the app writes: id, name, label, roles, tags, then the rest.
  doc.columns = doc.columns.map((c) => {
    const o = {};
    for (const k of ["id", "name", "label", "roles", "tags"]) if (c[k] !== undefined && !(Array.isArray(c[k]) && !c[k].length) && c[k] !== "") o[k] = c[k];
    for (const k of Object.keys(c)) if (!(k in o) && c[k] !== undefined && !["label", "roles", "tags"].includes(k)) o[k] = c[k];
    return o;
  });

  if (sn.relations || sn.replaceRelations) {
    const keep = sn.replaceRelations ? [] : doc.relations || [];
    const rels = [...keep];
    for (const sr of sn.relations || []) {
      if (!sr.to || !sr.columns || !Object.keys(sr.columns).length) fail(`${key}: relation needs to: and columns: { <source col>: <target col> }`);
      if (!isKnown(sr.to)) fail(`${key}: relation target ${sr.to} is neither built nor planned`);
      const [, tl, tn] = /^([^-]+)-(.+)$/.exec(sr.to);
      const tr = real.get(sr.to);
      const srcCols = nodeColumns(key), tgtCols = nodeColumns(sr.to);
      const pick = (cols, name, where) => cols.find((c) => c.name === name) || cols.find((c) => c.name.toLowerCase() === String(name).toLowerCase()) || fail(`${key}: relation column ${where}.${name} not found`);
      const rel = {
        id: relId(key, sr.columns, sr.to),
        label: sr.label || undefined,
        cardinality: sr.cardinality || "many-to-one",
        target: tr ? { id: tr.id, location: tr.location, name: tr.name } : { location: tl, name: tn },
        columns: Object.entries(sr.columns).map(([s, t]) => {
          const a = pick(srcCols, s, key), b = pick(tgtCols, t, sr.to);
          return { source: a.id ? { id: a.id, name: a.name } : { name: a.name }, target: b.id ? { id: b.id, name: b.name } : { name: b.name } };
        }),
      };
      if (!rel.label) delete rel.label;
      const i = rels.findIndex((x) => x.id === rel.id);
      if (i >= 0) rels[i] = { ...rels[i], ...rel };
      else rels.push(rel);
    }
    if (rels.length) doc.relations = rels;
    else delete doc.relations;
  }
  out.set(file, YAML.stringify(doc));
}

// ---------------------------------------------------------------- models
for (const [slug, sm] of Object.entries(spec.models || {})) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) fail(`model slug "${slug}" must be lowercase letters, digits, - or _`);
  if (!sm?.name) fail(`model ${slug} needs a name`);
  const file = path.join(MODEL, "models", `${slug}.yml`);
  const prev = readYaml(file, {}) || {};
  const def = { name: sm.name, type: sm.type ?? prev.type, include: sm.include ?? prev.include ?? { nodeTypes: [], locations: [] } };
  for (const [k, v] of Object.entries(prev)) if (!(k in def)) def[k] = v;
  def.layout ||= {}; // empty: the app auto-lays out nodes without a position
  out.set(file, YAML.stringify(def));
}

// ---------------------------------------------------------------- write
for (const [file, txt] of out) {
  let prev = null;
  try {
    prev = fs.readFileSync(file, "utf-8");
  } catch {}
  const rel = path.relative(WORKSPACE, file);
  if (prev === txt) {
    console.log(`unchanged ${rel}`);
    continue;
  }
  console.log(`${dryRun ? "would write" : "wrote"} ${rel}`);
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, txt);
  }
}
console.log("Next: node check-model.js --write-dbml (in this folder), then open the model in the app.");
