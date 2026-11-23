// Zero-dependency app: the watch server runs `npm start` with PORT and WORKSPACE_DIR set.
// Reads nodes and node types from the workspace, keeps modelling metadata in model/ and writes
// one DBML file per model to model/models/<slug>.dbml.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const YAML = require("./yaml");
const DBML = require("./dbml");
const WS = require("./workspace");
const Planned = require("./planned");

const PORT = Number(process.env.PORT || 3000);
const WORKSPACE = process.env.WORKSPACE_DIR || path.resolve(__dirname, "../..");
const NODES_DIR = path.join(WORKSPACE, "nodes");
const MODEL_DIR = path.join(WORKSPACE, "model");
const MODEL_NODES_DIR = path.join(MODEL_DIR, "nodes");
const TAGS_FILE = path.join(MODEL_DIR, "tags.yml");
const MODELS_DIR = path.join(MODEL_DIR, "models");
// Before 0.3.0 there was one implicit source model; these are migrated into model/models/.
const LEGACY_LAYOUT_FILE = path.join(MODEL_DIR, "layout.yml");
const LEGACY_DBML_FILE = path.join(MODEL_DIR, "model.dbml");

const readYaml = (file, fallback) => {
  try {
    return YAML.parse(fs.readFileSync(file, "utf-8")) ?? fallback;
  } catch (e) {
    if (e.code !== "ENOENT") console.warn(`Could not read ${file}: ${e.message}`);
    return fallback;
  }
};

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

// Model definitions: { <slug>: { name, type, include: { nodeTypes, locations }, layout } }.
function loadModels() {
  const models = {};
  let files = [];
  try {
    files = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith(".yml"));
  } catch {}
  for (const f of files) {
    const def = readYaml(path.join(MODELS_DIR, f), null);
    if (def && typeof def === "object") models[f.slice(0, -4)] = def;
  }
  if (!Object.keys(models).length) {
    // No models yet: offer the pre-0.3.0 implicit source model, positions included.
    models.source = {
      name: "Source",
      type: "Source",
      include: { nodeTypes: ["Source"], locations: [] },
      layout: readYaml(LEGACY_LAYOUT_FILE, {})?.nodes || {},
    };
  }
  return models;
}

function loadModel() {
  const model = {};
  let files = [];
  try {
    files = fs.readdirSync(MODEL_NODES_DIR).filter((f) => f.endsWith(".yml"));
  } catch {}
  for (const f of files) model[f.slice(0, -4)] = readYaml(path.join(MODEL_NODES_DIR, f), {});
  return model;
}

const loadVocab = () => readYaml(TAGS_FILE, { roles: {}, tags: {} });

// Write only when content changed, atomically, so unchanged files never show up in git.
function writeIfChanged(file, text) {
  let prev = null;
  try {
    prev = fs.readFileSync(file, "utf-8");
  } catch {}
  if (prev === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return true;
}

// Keep the leading comment block of a hand-written YAML file when rewriting it.
function headerComments(file) {
  try {
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    const head = [];
    for (const l of lines) {
      if (/^\s*#/.test(l)) head.push(l);
      else if (l.trim() === "" && head.length) head.push(l);
      else break;
    }
    return head.length ? head.join("\n").replace(/\n*$/, "\n\n") : "";
  } catch {
    return "";
  }
}

// Cheap fingerprint of every file the app reads, so the client can notice edits made outside it.
function signature() {
  const parts = [];
  const add = (dir, filter) => {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter(filter).sort();
    } catch {}
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(dir, f));
        parts.push(`${dir}/${f}:${st.mtimeMs}:${st.size}`);
      } catch {}
    }
  };
  add(NODES_DIR, (f) => /\.(yml|sql)$/.test(f));
  add(MODEL_NODES_DIR, (f) => f.endsWith(".yml"));
  add(MODELS_DIR, (f) => f.endsWith(".yml"));
  add(MODEL_DIR, (f) => f === "tags.yml");
  return crypto.createHash("sha1").update(parts.join("\n")).digest("hex");
}

const KEY_RE = /^[^/\\\0]+-[^/\\\0]+$/;

// Real nodes from nodes/ plus planned nodes (designed in model/nodes, not built yet).
function workspaceNodes(model = loadModel()) {
  const real = WS.loadNodes(WORKSPACE);
  return [...Planned.decorate(real, model), ...Planned.plannedNodes(model, real)];
}

// Planned nodes whose real node now exists become normal metadata files for it (design kept).
function upgradePlanned() {
  const model = loadModel();
  const real = WS.loadNodes(WORKSPACE);
  const { changed, upgraded } = Planned.upgrade(model, real);
  // Planned changes to built nodes that have been carried out move to `design:` as well.
  Object.assign(changed, Planned.applyChanges({ ...model, ...changed }, real));
  for (const [key, doc] of Object.entries(changed)) writeIfChanged(path.join(MODEL_NODES_DIR, `${key}.yml`), YAML.stringify(doc));
  return upgraded;
}

function save(body) {
  const nodes = workspaceNodes();
  const known = new Set([...nodes.map((n) => `${n.location}-${n.name}`), ...Object.keys(loadModel())]);
  const written = [];
  const rel = (f) => path.relative(WORKSPACE, f);

  for (const [key, doc] of Object.entries(body.model || {})) {
    if (!KEY_RE.test(key) || key.startsWith(".") || !known.has(key)) throw new Error(`Unknown node: ${key}`);
    if (!doc || typeof doc !== "object") continue;
    const file = path.join(MODEL_NODES_DIR, `${key}.yml`);
    if (writeIfChanged(file, YAML.stringify(doc))) written.push(rel(file));
  }
  if (body.vocab && typeof body.vocab === "object") {
    if (writeIfChanged(TAGS_FILE, headerComments(TAGS_FILE) + YAML.stringify(body.vocab))) written.push(rel(TAGS_FILE));
  }
  for (const slug of body.deletedModels || []) {
    if (!SLUG_RE.test(slug) || body.models?.[slug]) continue;
    for (const ext of [".yml", ".dbml"]) {
      const file = path.join(MODELS_DIR, slug + ext);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        written.push(`deleted ${rel(file)}`);
      }
    }
  }
  for (const [slug, def] of Object.entries(body.models || {})) {
    if (!SLUG_RE.test(slug)) throw new Error(`Invalid model id: ${slug}`);
    if (!def || typeof def !== "object" || !def.name) throw new Error(`Model ${slug} needs a name`);
    const file = path.join(MODELS_DIR, `${slug}.yml`);
    if (writeIfChanged(file, YAML.stringify(def))) written.push(rel(file));
  }
  // Metadata is shared, so any save can change every model's DBML.
  upgradePlanned();
  const model = loadModel();
  nodes.splice(0, nodes.length, ...workspaceNodes(model));
  const vocab = loadVocab();
  const types = WS.loadNodeTypes(WORKSPACE);
  const models = loadModels();
  for (const [slug, def] of Object.entries(models)) {
    if (!fs.existsSync(path.join(MODELS_DIR, `${slug}.yml`))) continue;
    const file = path.join(MODELS_DIR, `${slug}.dbml`);
    if (writeIfChanged(file, DBML.generate({ nodes, model, vocab, types, def }))) written.push(rel(file));
  }
  written.push(...removeLegacyFiles(rel));
  return written;
}

// Once real model files exist, the pre-0.3.0 layout.yml and model.dbml are superseded. The DBML
// is only removed if this app generated it.
function removeLegacyFiles(rel) {
  if (!fs.existsSync(path.join(MODELS_DIR, "source.yml"))) return [];
  const removed = [];
  if (fs.existsSync(LEGACY_LAYOUT_FILE)) {
    fs.unlinkSync(LEGACY_LAYOUT_FILE);
    removed.push(`deleted ${rel(LEGACY_LAYOUT_FILE)}`);
  }
  try {
    if (fs.readFileSync(LEGACY_DBML_FILE, "utf-8").includes("Generated by the Data Modeler app")) {
      fs.unlinkSync(LEGACY_DBML_FILE);
      removed.push(`deleted ${rel(LEGACY_DBML_FILE)}`);
    }
  } catch {}
  return removed;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) reject(new Error("Body too large"));
      else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const STATIC = { "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/app.css": "app.css", "/layout.js": "layout.js", "/models.js": "models.js", "/icons.js": "icons.js", "/planned.js": "planned.js", "/theme.js": "theme.js" };
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

async function handle(req, res) {
  // The proxy may forward a leading /proxy segment; strip it so routes work either way.
  const url = new URL(req.url, "http://x");
  const p = url.pathname.replace(/^\/proxy(?=\/|$)/, "") || "/";
  const json = (status, data) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(data));
  };

  try {
    if (p === "/api/model" && req.method === "GET") {
      const upgraded = upgradePlanned();
      return json(200, {
        workspace: WORKSPACE,
        upgraded,
        nodes: workspaceNodes(),
        nodeTypes: WS.loadNodeTypes(WORKSPACE),
        model: loadModel(),
        vocab: loadVocab(),
        models: loadModels(),
        signature: signature(),
      });
    }
    if (p === "/api/signature") {
      return json(200, { signature: signature() });
    }
    // The watch-server proxy re-sends bodies as JSON, so the API takes JSON only.
    if (p === "/api/model" && (req.method === "PUT" || req.method === "POST")) {
      const written = save(await readJson(req));
      return json(200, { written, signature: signature() });
    }
    if (p === "/api/dbml" && req.method === "POST") {
      // Preview of one model from unsaved client state.
      const body = await readJson(req);
      res.setHeader("content-type", "text/plain; charset=utf-8");
      return res.end(
        DBML.generate({
          nodes: workspaceNodes(body.model || loadModel()),
          model: body.model || loadModel(),
          vocab: body.vocab || loadVocab(),
          types: WS.loadNodeTypes(WORKSPACE),
          def: body.def,
        }),
      );
    }
    if (STATIC[p]) {
      const f = STATIC[p];
      res.setHeader("content-type", `${MIME[path.extname(f)]}; charset=utf-8`);
      res.setHeader("cache-control", "no-store");
      return res.end(fs.readFileSync(path.join(__dirname, f)));
    }
    res.statusCode = 404;
    res.end("Not found");
  } catch (e) {
    console.error(e);
    json(400, { error: e.message });
  }
}

// Loopback only: this app writes files. Bind both families since the proxy targets "localhost".
let listening = 0;
for (const host of ["127.0.0.1", "::1"]) {
  http
    .createServer(handle)
    .on("error", (e) => {
      if (host === "127.0.0.1" || listening === 0) console.warn(`Could not bind ${host}: ${e.message}`);
    })
    .listen(PORT, host, () => {
      if (listening++ === 0) console.log(`Data Modeler on :${PORT}, workspace=${WORKSPACE}`);
    });
}
