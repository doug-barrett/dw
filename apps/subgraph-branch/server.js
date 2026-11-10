// Subgraph Branch — zero-dependency app (Node built-ins only). The watch server
// runs `node server.js` with PORT and WORKSPACE_DIR set.
//
// Purpose: a one-stop panel to (1) cut a new Git branch from the latest commit
// on the current branch and switch to it, and (2) pick an existing subgraph to
// focus on — showing that subgraph's member nodes right here in the app.
//
//  - subgraphs/*.yml  : { id, name, steps:[nodeId…], type:Subgraph }
//  - nodes/*.sql|yml  : a node's own id is @id("UUID") (V2 .sql) or top-level
//                       `id:` (V1 .yml); a subgraph's steps are those ids.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");

const PORT = Number(process.env.PORT || 3000);
const WORKSPACE = process.env.WORKSPACE_DIR || path.resolve(__dirname, "../..");
const NODES_DIR = path.join(WORKSPACE, "nodes");
const SUBGRAPH_DIR = path.join(WORKSPACE, "subgraphs");

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// --- git helpers ------------------------------------------------------------
function git(args) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", WORKSPACE, ...args], { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message || "").trim())) : resolve(stdout)));
  });
}
async function currentBranch() {
  try { return (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim(); }
  catch { return "(detached)"; }
}
async function headInfo() {
  try {
    const out = (await git(["log", "-1", "--format=%h%x00%s%x00%an%x00%cr"])).trim();
    const [sha, subject, author, when] = out.split("\0");
    return { sha, subject, author, when };
  } catch { return null; }
}
async function listBranches() {
  let out = "";
  try { out = await git(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]); }
  catch { return []; }
  const seen = new Set(), branches = [];
  for (const line of out.split("\n")) {
    const name = line.trim();
    if (!name || name.endsWith("/HEAD") || seen.has(name)) continue;
    seen.add(name); branches.push(name);
  }
  return branches;
}
async function branchExists(name) {
  try { await git(["show-ref", "--verify", "--quiet", "refs/heads/" + name]); return true; }
  catch { return false; }
}
// `git check-ref-format` is the authority on what makes a legal branch name.
async function validRefName(name) {
  try { await git(["check-ref-format", "refs/heads/" + name]); return true; }
  catch { return false; }
}

// A sensible default branch name: <current>-<YYYYMMDD-HHMMSS> (local time).
function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}
function suggestName(current) {
  const base = (!current || current === "(detached)") ? "work" : current;
  return base + "-" + timestamp();
}

// --- node identity ----------------------------------------------------------
function idFromFile(file) {
  const base = file.replace(/\.(sql|yml)$/i, "");
  const dash = base.indexOf("-");
  const location = dash < 0 ? "" : base.slice(0, dash);
  const name = dash < 0 ? base : base.slice(dash + 1);
  return { location, name };
}
function extractNodeId(content, file) {
  if (/\.sql$/i.test(file)) {
    const m = content.match(new RegExp(`@id\\(\\s*["'](${UUID})["']\\s*\\)`, "i"));
    return m ? m[1] : null;
  }
  const m = content.match(new RegExp(`^id:\\s*["']?(${UUID})["']?\\s*$`, "im"));
  return m ? m[1] : null;
}
function extractType(content, file) {
  if (/\.sql$/i.test(file)) {
    const m = content.match(/@nodeType\(\s*["']([^"']+)["']\s*\)/);
    return m ? m[1] : "";
  }
  const m = content.match(/^\s*sqlType:\s*(.+?)\s*$/m);
  return m ? m[1] : "";
}
function extractName(content, file) {
  if (/\.yml$/i.test(file)) {
    const m = content.match(/^name:\s*["']?(.+?)["']?\s*$/m);
    if (m) return m[1];
  }
  return idFromFile(file).name;
}
function prettyType(sqlType) {
  let s = String(sqlType || "").replace(/^[^:]*:::/, "");
  s = s.replace(/[-_]+/g, " ")
       .replace(/([a-z\d])([A-Z])/g, "$1 $2")
       .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
  return s || String(sqlType || "");
}

// --- node-type color/label (from each type's definition.yml tagColor) --------
const DV_FALLBACK = {
  "DV:::4": "DV Stage", "DV:::6": "Hub", "DV:::7": "Link",
  "DV:::8": "Satellite V0", "DV:::9": "Satellite V1",
};
const COLOR_FALLBACK = {
  "DV:::4": "#72B7B2", "DV:::6": "#4C78A8", "DV:::7": "#E45756",
  "DV:::8": "#54A24B", "DV:::9": "#88B04B", "Source": "#6B7785",
  "SQL:::SQLDimension": "#1E339A", "SQL:::SQLFact": "#D9A438",
  "SQL:::SQLWork": "#2EB67D", "SQL:::SQLView": "#C4C4C4",
};
// Map a few CSS color names the defs use to hex, so the client gets a usable swatch.
const NAMED = { gray:"#8a95a1", grey:"#8a95a1", red:"#E45756", pink:"#E07AAE",
  brown:"#a9743b", blue:"#4C78A8", black:"#1f2328", green:"#54A24B" };
function normColor(c) { if (!c) return null; return /^#/.test(c) ? c : (NAMED[c.toLowerCase()] || c); }
// {sqlType: {name, color}} from every definition.yml on disk (workspace + packages).
function scanTypeMeta() {
  const meta = {};
  const readDef = (defPath, alias) => {
    try {
      const txt = fs.readFileSync(defPath, "utf-8");
      const id = (txt.match(/^\s*id:\s*["']?(.+?)["']?\s*$/m) || [])[1];
      const name = (txt.match(/^\s*name:\s*(.+?)\s*$/m) || [])[1];
      if (!id || !name) return;
      const color = (txt.match(/tagColor:\s*['"]?(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)['"]?/) || [])[1] || null;
      meta[alias ? `${alias}:::${id}` : id] = { name, color: normColor(color) };
    } catch {}
  };
  try { for (const d of fs.readdirSync(path.join(WORKSPACE, "nodeTypes")))
    readDef(path.join(WORKSPACE, "nodeTypes", d, "definition.yml"), null); } catch {}
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
  return (meta[sqlType] && meta[sqlType].name) || DV_FALLBACK[sqlType] || prettyType(sqlType);
}
function typeColor(sqlType, meta) {
  return (meta[sqlType] && meta[sqlType].color) || COLOR_FALLBACK[sqlType] || "#1f6feb";
}

// --- columns (for the column toggle + properties panel) ---------------------
// V2 (.sql): output column names from the SELECT, with a few @annotation flags.
function parseColumnsV2(content) {
  const m = content.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
  if (!m) return [];
  const cols = [];
  for (const item of m[1].split(/,(?=\s*(?:\r?\n|$))/)) {
    let line = item.replace(/--.*$/gm, "").trim();
    if (!line) continue;
    const anns = (line.match(/@[A-Za-z_]\w*(?:\([^)]*\))?/g) || []).map((x) => x.toLowerCase());
    const core = line.replace(/@[A-Za-z_]\w*(?:\([^)]*\))?/g, "").trim();
    let a, name = null;
    if ((a = core.match(/\bAS\s+"([^"]+)"\s*$/i))) name = a[1];
    else if ((a = core.match(/\bAS\s+([A-Za-z_][\w$]*)\s*$/i))) name = a[1];
    else if ((a = core.match(/"([^"]+)"\s*$/))) name = a[1];
    else if ((a = core.match(/([A-Za-z_][\w$]*)\s*$/))) name = a[1];
    if (!name || name.toUpperCase() === "SELECT") continue;
    const flags = {};
    if (anns.some((x) => x.startsWith("@issurrogatekey"))) flags.key = "surrogate";
    else if (anns.some((x) => x.startsWith("@isbusinesskey"))) flags.key = "business";
    if (anns.some((x) => x.startsWith("@issystem"))) flags.system = true;
    cols.push({ name, flags });
  }
  return cols;
}
// V1 (.yml): columns under operation.metadata.columns (6-space items).
function parseColumnsV1(content) {
  const lines = content.split("\n");
  const cols = [];
  let i = 0;
  while (i < lines.length && !/^    columns:\s*$/.test(lines[i])) i++;
  i++;
  let cur = null;
  const flush = () => { if (cur && cur.name) cols.push(cur); cur = null; };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^    \S/.test(l) || /^  \S/.test(l) || /^\S/.test(l)) break;
    if (/^      - /.test(l)) { flush(); cur = { name: null, flags: {} }; }
    if (!cur) continue;
    let m;
    if ((m = l.match(/^        name:\s*["']?(.+?)["']?\s*$/))) cur.name = m[1];
    else if (/^\s*isSurrogateKey:\s*true/.test(l)) cur.flags.key = "surrogate";
    else if (/^\s*isBusinessKey:\s*true/.test(l)) cur.flags.key = "business";
    else if (/^\s*isSystem(Create|Update)Date:\s*true/.test(l)) cur.flags.system = true;
  }
  flush();
  return cols;
}
function parseColumns(content, file) {
  return /\.sql$/i.test(file) ? parseColumnsV2(content) : parseColumnsV1(content);
}
function listNodeFiles() {
  try { return fs.readdirSync(NODES_DIR).filter((f) => /\.(sql|yml)$/i.test(f)); }
  catch { return []; }
}
function loadNodeIndex() {
  const byId = new Map();
  for (const file of listNodeFiles()) {
    let content = "";
    try { content = fs.readFileSync(path.join(NODES_DIR, file), "utf-8"); } catch {}
    const id = extractNodeId(content, file);
    const { location, name } = idFromFile(file);
    const rec = { id, file, name: extractName(content, file) || name, location,
                  sqlType: extractType(content, file) };
    if (id) byId.set(id, rec);
  }
  return byId;
}
// Upstream refs inside a node body: {{ ref('LOC','NODE') }} and {{ ref('NODE') }}.
function parseRefs(content) {
  const refs = [];
  const re = /ref\(\s*(["'])(.*?)\1\s*(?:,\s*(["'])(.*?)\3\s*)?\)/g;
  let m;
  while ((m = re.exec(content || ""))) {
    if (m[4] !== undefined) refs.push({ location: m[2], name: m[4] });
    else refs.push({ location: null, name: m[2] });
  }
  return refs;
}

// --- subgraphs --------------------------------------------------------------
function parseSteps(content) {
  const lines = content.split("\n");
  const steps = [];
  let i = lines.findIndex((l) => /^steps:/.test(l));
  if (i < 0) return steps;
  if (/^steps:\s*\[\s*\]/.test(lines[i])) return steps;
  for (i = i + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = l.match(new RegExp(`^\\s*-\\s*["']?(${UUID})["']?\\s*$`, "i"));
    if (m) steps.push(m[1]);
  }
  return steps;
}
function loadSubgraphs() {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(SUBGRAPH_DIR).filter((f) => /\.ya?ml$/i.test(f)); } catch {}
  for (const f of files) {
    let content = "";
    try { content = fs.readFileSync(path.join(SUBGRAPH_DIR, f), "utf-8"); } catch {}
    if (!/^type:\s*Subgraph\s*$/m.test(content)) continue;
    const id = (content.match(new RegExp(`^id:\\s*["']?(${UUID})["']?`, "im")) || [])[1];
    const name = (content.match(/^name:\s*(.+?)\s*$/m) || [])[1] || f;
    out.push({ id, name, file: f, steps: parseSteps(content) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
// Resolve one subgraph's steps to member nodes in the current branch, plus the
// ref() edges *between members* (so the app can draw a filtered mini-DAG).
function subgraphDetail(id) {
  const sg = loadSubgraphs().find((s) => s.id === id);
  if (!sg) return null;
  const byId = loadNodeIndex();
  const meta = scanTypeMeta();
  const nodes = [], staleSteps = [], contentById = new Map();
  for (const sid of sg.steps) {
    const n = byId.get(sid);
    if (!n) { staleSteps.push(sid); continue; }
    let content = "";
    try { content = fs.readFileSync(path.join(NODES_DIR, n.file), "utf-8"); } catch {}
    contentById.set(n.id, content);
    nodes.push({
      id: n.id, name: n.name, location: n.location, file: n.file,
      sqlType: n.sqlType, typeLabel: typeLabel(n.sqlType, meta),
      typeColor: typeColor(n.sqlType, meta),
      columns: parseColumns(content, n.file),
    });
  }
  const bylocname = (a, b) => (a.location + a.name).localeCompare(b.location + b.name);
  nodes.sort(bylocname);

  // Edge resolution: a member's body ref()s another member -> edge from -> to.
  const memberIds = new Set(nodes.map((n) => n.id));
  const byLocName = new Map(), byName = new Map();
  for (const n of nodes) {
    byLocName.set(n.location + "." + n.name, n.id);
    if (!byName.has(n.name)) byName.set(n.name, []);
    byName.get(n.name).push(n.id);
  }
  const seen = new Set(), edges = [];
  for (const n of nodes) {
    for (const r of parseRefs(contentById.get(n.id) || "")) {
      let fromId = null;
      if (r.location) fromId = byLocName.get(r.location + "." + r.name) || null;
      else { const c = byName.get(r.name); if (c && c.length) fromId = c[0]; }
      if (!fromId || fromId === n.id || !memberIds.has(fromId)) continue;
      const key = fromId + "->" + n.id;
      if (seen.has(key)) continue;
      seen.add(key); edges.push({ from: fromId, to: n.id });
    }
  }
  return { id: sg.id, name: sg.name, file: sg.file, stepCount: sg.steps.length,
           nodes, edges, staleSteps };
}

// Is a command on PATH? (synchronous, used to prefer VS Code's CLI.)
function onPath(cmd) {
  try {
    require("child_process").execFileSync(process.platform === "win32" ? "where" : "which",
      [cmd], { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch { return false; }
}
// Open a node's source file in the user's editor. Prefers VS Code (opens for
// editing); falls back to the OS default handler. Returns {ok} or {error}.
function openNodeFile(id) {
  const rec = loadNodeIndex().get(id);
  if (!rec) return { error: "Node not found in the current branch." };
  const full = path.join(NODES_DIR, rec.file);
  if (!full.startsWith(NODES_DIR + path.sep)) return { error: "Refusing to open outside nodes/." };
  if (!fs.existsSync(full)) return { error: "File no longer exists: " + rec.file };
  const run = (cmd, args) => { const c = spawn(cmd, args, { detached: true, stdio: "ignore" }); c.on("error", () => {}); c.unref(); };
  let how;
  if (onPath("code")) { run("code", ["-g", full]); how = "code"; }
  else if (process.platform === "darwin") { run("open", [full]); how = "open"; }
  else if (process.platform === "win32") { run("cmd", ["/c", "start", "", full]); how = "start"; }
  else { run("xdg-open", [full]); how = "xdg-open"; }
  return { ok: true, file: rec.file, via: how };
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

async function buildState() {
  const current = await currentBranch();
  const [head, branches] = await Promise.all([headInfo(), listBranches()]);
  const subgraphs = loadSubgraphs().map((s) => ({ id: s.id, name: s.name, stepCount: s.steps.length }));
  return { current, head, branches, suggestedBranch: suggestName(current), subgraphs };
}

// Create <name> from the current HEAD and switch to it.
async function createAndSwitch(rawName) {
  const name = String(rawName || "").trim();
  if (!name) return { error: "Branch name is required." };
  if (!(await validRefName(name)))
    return { error: `“${name}” is not a valid Git branch name.` };
  if (await branchExists(name))
    return { error: `Branch “${name}” already exists.` };
  // -b creates from the current HEAD (the latest commit on the current branch)
  // and checks it out; any uncommitted work travels along to the new branch.
  try {
    await git(["checkout", "-b", name, "HEAD"]);
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
  const [current, head] = await Promise.all([currentBranch(), headInfo()]);
  return { ok: true, current, head, from: head };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname.replace(/^\/proxy(?=\/|$)/, "") || "/";
  try {
    if (p === "/api/state") {
      return sendJson(res, await buildState());
    }
    if (p === "/api/subgraph") {
      const id = url.searchParams.get("id") || "";
      const d = subgraphDetail(id);
      if (!d) return sendJson(res, { error: "Subgraph not found." }, 404);
      return sendJson(res, d);
    }
    if (p === "/api/branch" && req.method === "POST") {
      const body = await readBody(req);
      const result = await createAndSwitch(body.name);
      return sendJson(res, result, result.error ? 400 : 200);
    }
    if (p === "/api/open-node" && req.method === "POST") {
      const body = await readBody(req);
      const result = openNodeFile(body.id);
      return sendJson(res, result, result.error ? 400 : 200);
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
}).listen(PORT, () => console.log(`Subgraph Branch on :${PORT}, workspace=${WORKSPACE}`));
