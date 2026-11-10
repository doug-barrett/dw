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
const { execFile } = require("child_process");

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
// Resolve one subgraph's steps to member nodes in the current branch.
function subgraphDetail(id) {
  const sg = loadSubgraphs().find((s) => s.id === id);
  if (!sg) return null;
  const byId = loadNodeIndex();
  const nodes = [], staleSteps = [];
  for (const sid of sg.steps) {
    const n = byId.get(sid);
    if (n) nodes.push({ id: n.id, name: n.name, location: n.location,
                        sqlType: n.sqlType, typeLabel: prettyType(n.sqlType) });
    else staleSteps.push(sid);
  }
  const bylocname = (a, b) => (a.location + a.name).localeCompare(b.location + b.name);
  nodes.sort(bylocname);
  return { id: sg.id, name: sg.name, file: sg.file, stepCount: sg.steps.length, nodes, staleSteps };
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
