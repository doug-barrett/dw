// Zero-dependency app: the watch server runs `npm start` with PORT and WORKSPACE_DIR set.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const WORKSPACE = process.env.WORKSPACE_DIR || path.resolve(__dirname, "../..");
const NODES_DIR = path.join(WORKSPACE, "nodes");

function listNodes() {
  try {
    return fs.readdirSync(NODES_DIR).filter((f) => /\.(sql|yml)$/.test(f)).sort();
  } catch {
    return [];
  }
}

http
  .createServer((req, res) => {
    // The proxy may forward a leading /proxy segment; strip it so routes work either way.
    const url = new URL(req.url, "http://x");
    const p = url.pathname.replace(/^\/proxy(?=\/|$)/, "") || "/";

    if (p === "/api/nodes") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ workspace: WORKSPACE, nodes: listNodes() }));
    }
    if (p === "/api/node") {
      const name = path.basename(url.searchParams.get("name") || "");
      try {
        res.setHeader("content-type", "text/plain");
        return res.end(fs.readFileSync(path.join(NODES_DIR, name), "utf-8"));
      } catch {
        res.statusCode = 404;
        return res.end("Not found");
      }
    }
    if (p === "/" || p === "/index.html") {
      res.setHeader("content-type", "text/html");
      return res.end(fs.readFileSync(path.join(__dirname, "index.html")));
    }
    res.statusCode = 404;
    res.end("Not found");
  })
  .listen(PORT, () => console.log(`Workspace Explorer on :${PORT}, workspace=${WORKSPACE}`));
