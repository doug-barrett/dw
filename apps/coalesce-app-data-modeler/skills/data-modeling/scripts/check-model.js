#!/usr/bin/env node
// Validates the Data Modeler metadata in <workspace>/model/ against the workspace's nodes, using the
// app's own readers (workspace.js, planned.js, yaml.js), and optionally regenerates the DBML files
// exactly as the app's Save does (dbml.js).
//
//   node check-model.js [--workspace <dir>] [--model <slug>] [--write-dbml] [--json]
//
// Workspace: --workspace, else $WORKSPACE_DIR, else the nearest parent of the cwd with data.yml.
// Exit code 1 when there are errors. Warnings never fail. Zero-dependency.
const fs = require("fs");
const path = require("path");

const APP = path.resolve(__dirname, "../../..");
const YAML = require(path.join(APP, "yaml.js"));
const WS = require(path.join(APP, "workspace.js"));
const Planned = require(path.join(APP, "planned.js"));
const Models = require(path.join(APP, "models.js"));
const DBML = require(path.join(APP, "dbml.js"));

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

function findWorkspace() {
  if (opt("--workspace")) return path.resolve(opt("--workspace"));
  if (process.env.WORKSPACE_DIR) return path.resolve(process.env.WORKSPACE_DIR);
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, "data.yml"))) return d;
    if (path.dirname(d) === d) break;
  }
  // The app lives in <workspace>/apps/<id>/.
  return path.resolve(APP, "../..");
}

const WORKSPACE = findWorkspace();
const MODEL_DIR = path.join(WORKSPACE, "model");
const readYaml = (file, fallback) => {
  try {
    return YAML.parse(fs.readFileSync(file, "utf-8")) ?? fallback;
  } catch (e) {
    if (e.code !== "ENOENT") problems.push({ level: "error", where: path.relative(WORKSPACE, file), msg: `unparseable YAML: ${e.message}` });
    return fallback;
  }
};
const ymlFiles = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".yml")).sort();
  } catch {
    return [];
  }
};

const problems = [];
const err = (where, msg) => problems.push({ level: "error", where, msg });
const warn = (where, msg) => problems.push({ level: "warning", where, msg });

// ---------------------------------------------------------------- load
const model = {};
for (const f of ymlFiles(path.join(MODEL_DIR, "nodes"))) model[f.slice(0, -4)] = readYaml(path.join(MODEL_DIR, "nodes", f), {});
const vocab = readYaml(path.join(MODEL_DIR, "tags.yml"), { roles: {}, tags: {} });
const models = {};
for (const f of ymlFiles(path.join(MODEL_DIR, "models"))) models[f.slice(0, -4)] = readYaml(path.join(MODEL_DIR, "models", f), null);
const types = WS.loadNodeTypes(WORKSPACE);
const typeIds = new Set(types.map((t) => t.id));
const real = WS.loadNodes(WORKSPACE);
const nodes = [...Planned.decorate(real, model), ...Planned.plannedNodes(model, real)];
const byKey = new Map(nodes.map((n) => [`${n.location}-${n.name}`, n]));
const byId = new Map(nodes.map((n) => [n.id, n]));
const realByKey = new Map(real.map((n) => [`${n.location}-${n.name}`, n]));

const CARDINALITIES = Object.keys(DBML.CARDINALITY);
const roleKeys = new Set(Object.keys(vocab.roles || {}));
const tagKeys = new Set(Object.keys(vocab.tags || {}));
if (!fs.existsSync(path.join(MODEL_DIR, "tags.yml"))) warn("model/tags.yml", "missing: roles and tags have no labels or colours");

// ---------------------------------------------------------------- node metadata files
const relIds = new Map();
for (const [key, doc] of Object.entries(model)) {
  const where = `model/nodes/${key}.yml`;
  const n = doc?.node;
  if (!n || typeof n !== "object") {
    err(where, "no `node:` block");
    continue;
  }
  if (doc.modelVersion !== 1) warn(where, "modelVersion should be 1");
  if (`${n.location}-${n.name}` !== key) err(where, `file name does not match node location/name (${n.location}-${n.name})`);
  const planned = Planned.isPlanned(doc);
  const r = realByKey.get(key);

  if (n.id) {
    if (!r) err(where, `node.id ${n.id} set but no node ${key} exists in nodes/ (a planned node must not have an id)`);
    else if (r.id !== n.id) err(where, `node.id ${n.id} does not match the real node's id ${r.id}`);
  } else if (!n.planned) {
    if (r) warn(where, "no node.id: the app matches by location+name, but write the real id");
    else err(where, `no node ${key} in nodes/ and no \`node.planned\` block: the file is ignored`);
  }
  if (planned) {
    if (!n.planned.nodeType) err(where, "planned node without node.planned.nodeType");
    else if (!typeIds.has(String(n.planned.nodeType))) err(where, `unknown node type id "${n.planned.nodeType}" (see nodeTypes/*/definition.yml or .coa/cache/packages)`);
    if (r) warn(where, "a real node with this location+name exists; the app upgrades this file on its next load");
  }
  if (n.planned?.nodeType && n.id && !typeIds.has(String(n.planned.nodeType))) err(where, `planned node type change to unknown type "${n.planned.nodeType}"`);

  const node = byKey.get(key);
  const seen = new Set();
  for (const [i, c] of (doc.columns || []).entries()) {
    const cw = `${where} columns[${i}] ${c?.name || ""}`;
    if (!c?.name) {
      err(cw, "column without name");
      continue;
    }
    if (seen.has(c.name)) err(cw, "duplicate column");
    seen.add(c.name);
    for (const k of c.roles || []) if (!roleKeys.has(k)) err(cw, `unknown role "${k}" (roles are fixed: ${[...roleKeys].join(", ")})`);
    for (const k of c.tags || []) if (!tagKeys.has(k)) err(cw, `unknown tag "${k}" — add it to model/tags.yml first`);
    for (const k of ["isBusinessKey", "isChangeTracking", "isSurrogateKey"]) if (k in c) warn(cw, `${k} is a Coalesce node property; in the modeler use roles/tags`);
    if (planned) {
      if (c.id) err(cw, "columns of a planned node must not have an id");
      if (!c.planned) warn(cw, "column of a planned node without a planned: block (no data type)");
      for (const ref of c.planned?.derivedFrom || []) checkDerived(cw, ref);
    } else if (r) {
      const rc = r.columns.find((x) => c.id && x.id === c.id) || r.columns.find((x) => x.name === c.name);
      if (!rc && !c.planned && !c.design) err(cw, "column not found in the node (add `planned:` to propose it as a new column)");
      if (rc && c.id && rc.id !== c.id && r.format !== "sql") err(cw, `column id ${c.id} does not match the node's column id ${rc.id}`);
      if (rc && rc.name !== c.name) warn(cw, `name differs from the node's column name ${rc.name}`);
      for (const ref of c.planned?.derivedFrom || []) checkDerived(cw, ref);
    }
  }

  for (const [i, rel] of (doc.relations || []).entries()) {
    const rw = `${where} relations[${i}]${rel?.label ? ` "${rel.label}"` : ""}`;
    if (!rel?.id) err(rw, "relation without id");
    else if (relIds.has(rel.id)) err(rw, `duplicate relation id (also in ${relIds.get(rel.id)})`);
    else relIds.set(rel.id, where);
    if (rel.cardinality && !CARDINALITIES.includes(rel.cardinality)) err(rw, `cardinality must be one of ${CARDINALITIES.join(", ")}`);
    const t = byId.get(rel.target?.id) || byKey.get(`${rel.target?.location}-${rel.target?.name}`);
    if (!t) {
      err(rw, `target ${rel.target?.location}-${rel.target?.name} not found (built or planned)`);
      continue;
    }
    if (rel.target?.id && t.id !== rel.target.id && !t.planned) err(rw, `target id ${rel.target.id} does not match ${t.id}`);
    if (!(rel.columns || []).length) err(rw, "relation without column pairs");
    for (const [j, p] of (rel.columns || []).entries()) {
      const sc = Planned.findColumn(node, p.source);
      const tc = Planned.findColumn(t, p.target);
      if (!sc) err(rw, `columns[${j}] source column ${p.source?.name} not found in ${key}`);
      if (!tc) err(rw, `columns[${j}] target column ${p.target?.name} not found in ${t.location}-${t.name}`);
      if (sc && tc && sc.dataType && tc.dataType && baseType(sc.dataType) !== baseType(tc.dataType))
        warn(rw, `data types differ: ${sc.name} ${sc.dataType} vs ${tc.name} ${tc.dataType}`);
    }
  }
}

function checkDerived(where, ref) {
  const m = /^(.+?)-(.+)\.([^.]+)$/.exec(String(ref));
  if (!m) return warn(where, `derivedFrom "${ref}" is not <LOC>-<NODE>.<COLUMN>`);
  const src = byKey.get(`${m[1]}-${m[2]}`);
  if (!src) return warn(where, `derivedFrom "${ref}": node not found`);
  if (!Planned.findColumn(src, { name: m[3] })) warn(where, `derivedFrom "${ref}": column not found`);
}

function baseType(t) {
  const s = String(t).toUpperCase().replace(/\(.*$/, "").trim();
  if (/^(NUMBER|NUMERIC|DECIMAL|INT|INTEGER|BIGINT|SMALLINT)$/.test(s)) return "NUMBER";
  if (/^(VARCHAR|STRING|TEXT|CHAR)$/.test(s)) return "VARCHAR";
  return s;
}

// ---------------------------------------------------------------- models
const summary = [];
const only = opt("--model");
for (const [slug, def] of Object.entries(models)) {
  if (only && slug !== only) continue;
  const where = `model/models/${slug}.yml`;
  if (!def || !def.name) {
    err(where, "model without a name");
    continue;
  }
  const inc = def.include || {};
  for (const t of inc.nodeTypes || []) if (!typeIds.has(String(t))) err(where, `include.nodeTypes: unknown node type id "${t}"`);
  if (!(inc.nodeTypes || []).length && !(inc.locations || []).length) warn(where, "include has no nodeTypes and no locations: the model shows nothing");
  const members = nodes.filter((n) => Models.includes(def, n));
  if (!members.length) warn(where, "no node matches this model's include");
  let noBk = [];
  for (const n of members) {
    const doc = model[`${n.location}-${n.name}`];
    const hasBk = (doc?.columns || []).some((c) => (c.roles || []).includes("businessKeyPart"));
    const role = Models.vaultRole(types.find((t) => t.id === n.nodeType));
    if (!hasBk && role !== "link" && role !== "sat") noBk.push(`${n.location}-${n.name}`);
  }
  if (noBk.length) warn(where, `no businessKeyPart (DBML primary key) on: ${noBk.join(", ")}`);
  const relCount = members.reduce((a, n) => a + (model[`${n.location}-${n.name}`]?.relations || []).filter((r) => members.some((m) => m.id === r.target?.id || (m.location === r.target?.location && m.name === r.target?.name))).length, 0);
  summary.push({ slug, name: def.name, type: def.type, nodes: members.length, planned: members.filter((n) => n.planned).length, relations: relCount });

  if (flag("--write-dbml")) {
    const file = path.join(MODEL_DIR, "models", `${slug}.dbml`);
    const text = DBML.generate({ nodes, model, vocab, types, def });
    let prev = null;
    try {
      prev = fs.readFileSync(file, "utf-8");
    } catch {}
    if (prev !== text) fs.writeFileSync(file, text);
    summary[summary.length - 1].dbml = `${path.relative(WORKSPACE, file)}${prev === text ? " (unchanged)" : " (written)"}`;
  }
}
if (!Object.keys(models).length) warn("model/models", "no model definitions");

// ---------------------------------------------------------------- report
const errors = problems.filter((p) => p.level === "error");
if (flag("--json")) {
  console.log(JSON.stringify({ workspace: WORKSPACE, models: summary, problems }, null, 2));
} else {
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`Metadata files: ${Object.keys(model).length}, planned nodes: ${nodes.filter((n) => n.planned).length}`);
  for (const s of summary)
    console.log(`Model ${s.slug} "${s.name}" (${s.type || "no type"}): ${s.nodes} nodes${s.planned ? ` (${s.planned} planned)` : ""}, ${s.relations} relations${s.dbml ? ` -> ${s.dbml}` : ""}`);
  for (const p of problems) console.log(`${p.level === "error" ? "ERROR" : "warn "} ${p.where}: ${p.msg}`);
  console.log(errors.length ? `${errors.length} error(s)` : "OK: no errors");
}
process.exit(errors.length ? 1 : 0);
