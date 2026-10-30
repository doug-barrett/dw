// Branch Diff — zero-dependency app. The watch server runs `node server.js`
// with PORT and WORKSPACE_DIR set. We shell out to `git` in the workspace to
// compare the working tree against another branch, then build the node graph
// (nodes/ DAG) and tag every node with its diff status.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PORT = Number(process.env.PORT || 3000);
const WORKSPACE = process.env.WORKSPACE_DIR || path.resolve(__dirname, "../..");
const NODES_DIR = path.join(WORKSPACE, "nodes");

// --- git helpers -----------------------------------------------------------
function git(args) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", WORKSPACE, ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

async function currentBranch() {
  try {
    return (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    return "(detached)";
  }
}

async function listBranches() {
  // Local + remote branches, deduped, HEAD aliases dropped.
  const out = await git([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ]);
  const seen = new Set();
  const branches = [];
  for (const line of out.split("\n")) {
    const name = line.trim();
    if (!name || name.endsWith("/HEAD") || seen.has(name)) continue;
    seen.add(name);
    branches.push(name);
  }
  return branches;
}

// --- node identity + edge parsing ------------------------------------------
// Files are <LOCATION>-<NAME>.sql|yml ; node id is "LOCATION.NAME".
function idFromFile(file) {
  const base = file.replace(/\.(sql|yml)$/i, "");
  const dash = base.indexOf("-");
  if (dash < 0) return { location: "", name: base, id: base };
  const location = base.slice(0, dash);
  const name = base.slice(dash + 1);
  return { location, name, id: location + "." + name };
}

// Pull upstream refs out of node content. Handles {{ ref('LOC','NODE') }} and
// the single-arg {{ ref('NODE') }} form. Returns array of {location?, name}.
function parseRefs(content) {
  const refs = [];
  const re = /ref\(\s*(["'])(.*?)\1\s*(?:,\s*(["'])(.*?)\3\s*)?\)/g;
  let m;
  while ((m = re.exec(content))) {
    if (m[4] !== undefined) refs.push({ location: m[2], name: m[4] });
    else refs.push({ location: null, name: m[2] });
  }
  return refs;
}

// --- diff status ------------------------------------------------------------
// `git diff --name-status <compare>` describes what it takes to go from the
// compare branch to the working tree: A = added here, D = removed here,
// M = modified. Returns a Map of file -> status for files under nodes/.
async function diffStatus(compare) {
  const map = new Map();
  if (!compare) return map;
  let out;
  try {
    out = await git(["diff", "--name-status", compare, "--", "nodes/"]);
  } catch {
    return map; // unknown ref etc. — treat everything as unchanged
  }
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0][0];
    if (code === "R") {
      // rename: old path removed, new path added
      const [, oldPath, newPath] = parts;
      map.set(path.basename(oldPath), "removed");
      map.set(path.basename(newPath), "added");
    } else {
      const file = path.basename(parts[parts.length - 1]);
      map.set(file, code === "A" ? "added" : code === "D" ? "removed" : "modified");
    }
  }
  return map;
}

// --- graph ------------------------------------------------------------------
async function buildGraph(compare) {
  const status = await diffStatus(compare);

  // Current (working-tree) node files.
  let files = [];
  try {
    files = fs.readdirSync(NODES_DIR).filter((f) => /\.(sql|yml)$/i.test(f));
  } catch {
    files = [];
  }

  const nodes = new Map(); // id -> node record
  const contentByFile = new Map();

  function addNode(file, content, st) {
    const { location, name, id } = idFromFile(file);
    contentByFile.set(file, content);
    // Coalesce's own id for the node, used to open it in the editor.
    const nodeId = (content.match(/^id:\s*["']?([^"'\s]+)/m) || [])[1] || null;
    nodes.set(id, { id, name, location, file, status: st, nodeId });
  }

  for (const file of files) {
    let content = "";
    try {
      content = fs.readFileSync(path.join(NODES_DIR, file), "utf-8");
    } catch {}
    addNode(file, content, status.get(file) || "unchanged");
  }

  // Nodes removed in the current branch still belong on the graph — pull their
  // content from the compare branch so their edges resolve.
  for (const [file, st] of status) {
    if (st !== "removed") continue;
    if (nodes.has(idFromFile(file).id)) continue;
    let content = "";
    try {
      content = await git(["show", `${compare}:nodes/${file}`]);
    } catch {}
    addNode(file, content, "removed");
  }

  // name -> id index for single-arg ref() resolution.
  const byName = new Map();
  for (const n of nodes.values()) {
    if (!byName.has(n.name)) byName.set(n.name, []);
    byName.get(n.name).push(n.id);
  }

  const edgeSet = new Set();
  const edges = [];
  for (const [file, content] of contentByFile) {
    const toId = idFromFile(file).id;
    for (const r of parseRefs(content)) {
      let fromId = null;
      if (r.location) fromId = r.location + "." + r.name;
      else {
        const cands = byName.get(r.name);
        if (cands && cands.length) fromId = cands[0];
      }
      if (!fromId || fromId === toId || !nodes.has(fromId)) continue;
      const key = fromId + "->" + toId;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push({ from: fromId, to: toId });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

// --- http -------------------------------------------------------------------
function sendJson(res, body) {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname.replace(/^\/proxy(?=\/|$)/, "") || "/";
    try {
      if (p === "/api/branches") {
        const [current, branches] = await Promise.all([currentBranch(), listBranches()]);
        return sendJson(res, { current, branches });
      }
      if (p === "/api/graph") {
        const compare = url.searchParams.get("compare") || "";
        const current = await currentBranch();
        const { nodes, edges } = await buildGraph(compare);
        return sendJson(res, { current, compare, nodes, edges });
      }
      if (p === "/" || p === "/index.html") {
        res.setHeader("content-type", "text/html");
        return res.end(fs.readFileSync(path.join(__dirname, "index.html")));
      }
      res.statusCode = 404;
      res.end("Not found");
    } catch (err) {
      res.statusCode = 500;
      sendJson(res, { error: String((err && err.message) || err) });
    }
  })
  .listen(PORT, () => console.log(`Branch Diff on :${PORT}, workspace=${WORKSPACE}`));
