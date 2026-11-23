// Reads what the modeler needs from a Coalesce workspace: node types (built-in Source,
// nodeTypes/ and the package cache) and every node in nodes/ with its columns.
const fs = require("fs");
const path = require("path");
const YAML = require("./yaml");

const SOURCE_TYPE = { id: "Source", name: "Source", color: "#D26000", origin: "Built-in", fileVersion: 1 };

const readYaml = (file) => {
  try {
    return YAML.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    if (e.code !== "ENOENT") console.warn(`Could not read ${file}: ${e.message}`);
    return null;
  }
};
const listDir = (dir, filter = () => true) => {
  try {
    return fs.readdirSync(dir).filter((f) => !f.startsWith(".") && filter(f)).sort();
  } catch {
    return [];
  }
};

// nodeMetadataSpec is YAML inside a string and not always valid YAML (tabs occur in packages),
// so read the few top-level keys we need line by line.
function specValue(spec, key) {
  const m = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(spec || "");
  if (!m) return "";
  return m[1].trim().replace(/^(['"])(.*)\1$/, "$2");
}

function readNodeType(file, origin, packageAlias) {
  const d = readYaml(file);
  if (!d || d.id === undefined || d.id === null) return null;
  const spec = d.metadata?.nodeMetadataSpec || "";
  let id = String(d.id);
  // Materialized package types already carry "<alias>:::<id>"; add it if a cache does not.
  if (packageAlias && !id.includes(":::")) id = `${packageAlias}:::${id}`;
  return {
    id,
    name: d.name || specValue(spec, "capitalized") || id,
    short: specValue(spec, "short"),
    color: specValue(spec, "tagColor") || "#8C8C8C",
    fileVersion: d.fileVersion || 1,
    origin,
    disabled: !!d.isDisabled,
  };
}

function loadNodeTypes(workspace) {
  const out = [SOURCE_TYPE];
  const wsDir = path.join(workspace, "nodeTypes");
  for (const dir of listDir(wsDir)) {
    const t = readNodeType(path.join(wsDir, dir, "definition.yml"), "Workspace");
    if (t) out.push(t);
  }
  const pkgDir = path.join(workspace, ".coa", "cache", "packages");
  for (const alias of listDir(pkgDir)) {
    const dir = path.join(pkgDir, alias, "nodeTypes");
    for (const sub of listDir(dir)) {
      const t = readNodeType(path.join(dir, sub, "definition.yml"), `Package: ${alias}`, alias);
      if (t) out.push(t);
    }
  }
  const seen = new Set();
  return out.filter((t) => !seen.has(t.id) && seen.add(t.id));
}

function loadNodes(workspace) {
  const dir = path.join(workspace, "nodes");
  const out = [];
  for (const f of listDir(dir, (f) => /\.(yml|sql)$/.test(f))) {
    const file = path.join(dir, f);
    try {
      const n = f.endsWith(".yml") ? readYamlNode(file) : readSqlNode(file, f);
      if (n) out.push(n);
    } catch (e) {
      console.warn(`Could not read ${file}: ${e.message}`);
    }
  }
  return out;
}

function readYamlNode(file) {
  const doc = readYaml(file);
  const op = doc?.operation;
  if (!op || doc.type !== "Node") return null;
  return {
    id: doc.id,
    location: op.locationName,
    name: op.name || doc.name,
    nodeType: String(op.sqlType || ""),
    format: "yml",
    description: op.description || "",
    columns: (op.metadata?.columns || []).map((c) => ({
      id: c.columnReference?.columnCounter || c.columnID || c.name,
      name: c.name,
      dataType: c.dataType || "",
      description: c.description || "",
      nullable: c.nullable !== false,
    })),
  };
}

// SQL nodes: identity comes from the filename and @id/@nodeType; columns are the aliases of the
// outermost SELECT. On a SQL node the column name is the column id. Data types are inferred by
// coa at render time and are not available from the file.
function readSqlNode(file, filename) {
  const text = fs.readFileSync(file, "utf-8");
  const m = /^(.+?)-(.+)\.sql$/.exec(filename);
  if (!m) return null;
  const ann = (name) => new RegExp(`^\\s*@${name}\\(\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*\\)`, "m").exec(text)?.[1];
  return {
    id: ann("id") || filename,
    location: m[1],
    name: m[2],
    nodeType: ann("nodeType") || "",
    format: "sql",
    description: ann("description") || "",
    columns: sqlColumns(text).map((c) => ({ id: c.name, name: c.name, dataType: "", description: c.description, nullable: !c.notNull })),
  };
}

function sqlColumns(text) {
  // Blank out comments and string literals (keeping offsets) so parsing only sees structure.
  let s = "";
  for (let i = 0; i < text.length; ) {
    if (text.startsWith("--", i)) {
      const j = text.indexOf("\n", i);
      const end = j < 0 ? text.length : j;
      s += " ".repeat(end - i);
      i = end;
    } else if (text.startsWith("/*", i)) {
      const j = text.indexOf("*/", i + 2);
      const end = j < 0 ? text.length : j + 2;
      s += text.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else if (text[i] === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      s += "'" + " ".repeat(Math.max(0, j - i - 1)) + (j < text.length ? "'" : "");
      i = j + 1;
    } else {
      s += text[i++];
    }
  }
  // Outermost SELECT: the first SELECT at paren depth 0 (CTEs live inside parentheses).
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /^select\b/i.test(s.slice(i, i + 7)) && !/\w/.test(s[i - 1] || " ")) {
      start = i + 6;
      break;
    }
  }
  if (start < 0) return [];
  const items = [];
  let cur = start;
  depth = 0;
  for (let i = start; i <= s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    const atEnd = i === s.length || (depth === 0 && /^from\b/i.test(s.slice(i, i + 5)) && /\s/.test(s[i - 1] || " "));
    if ((depth === 0 && ch === ",") || atEnd) {
      items.push([cur, i]);
      cur = i + 1;
      if (atEnd) break;
    }
  }
  const cols = [];
  for (const [a, b] of items) {
    const masked = s.slice(a, b);
    const raw = text.slice(a, b);
    // Annotations follow the alias: split at the first top-level "@".
    const at = masked.search(/@[A-Za-z_]/);
    const expr = (at < 0 ? masked : masked.slice(0, at)).trim();
    const annText = at < 0 ? "" : raw.slice(at);
    if (!expr || /^distinct$/i.test(expr)) continue;
    let name =
      /\bas\s+("(?:[^"]|"")+"|[A-Za-z_][\w$]*)\s*$/i.exec(expr)?.[1] ||
      /(?:^|\.)\s*("(?:[^"]|"")+"|[A-Za-z_][\w$]*)\s*$/.exec(expr)?.[1];
    if (!name || name === "*") continue;
    name = name.startsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : name.toUpperCase();
    cols.push({
      name,
      description: /@description\(\s*"((?:[^"\\]|\\.)*)"\s*\)/.exec(annText)?.[1] || "",
      notNull: /@notNull\b/.test(annText),
    });
  }
  return cols;
}

module.exports = { loadNodeTypes, loadNodes, sqlColumns, SOURCE_TYPE };
