// Minimal YAML reader/writer so the app stays zero-dependency like data-peek.
// Covers what Coalesce and the model/ files use: block maps and sequences, plain and quoted
// scalars (including folded continuation lines), block scalars (| >), simple flow collections
// and comments. Anchors, aliases, tags and multi-document streams are not supported.

function parse(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const p = { lines, i: 0 };
  skipBlank(p);
  if (p.i >= lines.length) return null;
  if (/^---\s*$/.test(lines[p.i])) { p.i++; skipBlank(p); }
  return parseBlock(p, indentOf(lines[p.i]));
}

const indentOf = (l) => l.length - l.trimStart().length;
const isBlank = (l) => /^\s*(#.*)?$/.test(l);

function skipBlank(p) {
  while (p.i < p.lines.length && isBlank(p.lines[p.i])) p.i++;
}

function parseBlock(p, indent) {
  skipBlank(p);
  if (p.i >= p.lines.length) return null;
  const t = p.lines[p.i].slice(indent);
  return /^-(\s|$)/.test(t) ? parseSeq(p, indent) : parseMap(p, indent);
}

function parseSeq(p, indent) {
  const out = [];
  for (;;) {
    skipBlank(p);
    if (p.i >= p.lines.length) break;
    const line = p.lines[p.i];
    if (indentOf(line) !== indent || !/^-(\s|$)/.test(line.slice(indent))) break;
    const rest = line.slice(indent + 1);
    if (rest.trim() === "" || rest.trim().startsWith("#")) {
      p.i++;
      skipBlank(p);
      const next = p.i < p.lines.length ? indentOf(p.lines[p.i]) : -1;
      out.push(next > indent ? parseBlock(p, next) : null);
      continue;
    }
    // Re-read the item content as if it started its own line at the content column.
    const col = indent + 1 + (rest.length - rest.trimStart().length);
    const content = line.slice(col);
    if (/^-(\s|$)/.test(content) || splitKey(content)) {
      p.lines[p.i] = " ".repeat(col) + content;
      out.push(parseBlock(p, col));
    } else {
      p.i++;
      out.push(scalarWithContinuation(p, content, indent));
    }
  }
  return out;
}

function parseMap(p, indent) {
  const out = {};
  for (;;) {
    skipBlank(p);
    if (p.i >= p.lines.length) break;
    const line = p.lines[p.i];
    if (indentOf(line) !== indent) break;
    const kv = splitKey(line.slice(indent));
    if (!kv) throw new Error(`YAML: expected "key: value" at line ${p.i + 1}: ${line.trim()}`);
    p.i++;
    const [key, raw] = kv;
    const v = stripComment(raw).trim();
    if (v === "") {
      skipBlank(p);
      const next = p.i < p.lines.length ? p.lines[p.i] : null;
      if (next !== null && indentOf(next) > indent) out[key] = parseBlock(p, indentOf(next));
      else if (next !== null && indentOf(next) === indent && /^-(\s|$)/.test(next.slice(indent)))
        out[key] = parseSeq(p, indent);
      else out[key] = null;
    } else {
      out[key] = scalarWithContinuation(p, raw.trim(), indent);
    }
  }
  return out;
}

// Returns [key, rest] when the line is a mapping entry, else null.
function splitKey(s) {
  let key, rest;
  if (s[0] === '"' || s[0] === "'") {
    const end = quotedEnd(s, 0);
    if (end < 0) return null;
    const m = /^\s*:(\s|$)/.exec(s.slice(end + 1));
    if (!m) return null;
    key = scalar(s.slice(0, end + 1));
    rest = s.slice(end + 1 + m[0].length);
    return [String(key), rest];
  }
  if (/^[\[{]/.test(s)) return null;
  const m = /:(\s|$)/.exec(s);
  if (!m) return null;
  const k = s.slice(0, m.index);
  if (k.includes(" #")) return null;
  rest = s.slice(m.index + m[0].length);
  return [k.trim(), rest];
}

function quotedEnd(s, start) {
  const q = s[start];
  for (let j = start + 1; j < s.length; j++) {
    if (q === '"' && s[j] === "\\") { j++; continue; }
    if (s[j] === q) {
      if (q === "'" && s[j + 1] === "'") { j++; continue; }
      return j;
    }
  }
  return -1;
}

function stripComment(s) {
  const t = s.trimStart();
  if (t[0] === '"' || t[0] === "'") {
    const off = s.length - t.length;
    const end = quotedEnd(s, off);
    if (end >= 0) return s.slice(0, end + 1);
    return s;
  }
  const m = /(^|\s)#/.exec(s);
  return m ? s.slice(0, m.index) : s;
}

// A scalar that may continue on more-indented lines (folded plain/quoted, or a block scalar).
function scalarWithContinuation(p, first, parentIndent) {
  const block = /^([|>])([+-]?)(\d?)([+-]?)\s*(#.*)?$/.exec(first);
  if (block) return blockScalar(p, block[1], block[2] || block[4], parentIndent);
  const parts = [first];
  while (p.i < p.lines.length) {
    const l = p.lines[p.i];
    if (l.trim() !== "" && indentOf(l) <= parentIndent) break;
    if (l.trim() === "") {
      // Only consume blank lines if a continuation line follows.
      let j = p.i;
      while (j < p.lines.length && p.lines[j].trim() === "") j++;
      if (j >= p.lines.length || indentOf(p.lines[j]) <= parentIndent) break;
    } else if (!/^["']/.test(first) && /^#/.test(l.trim())) break;
    parts.push(l.trim());
    p.i++;
  }
  if (parts.length === 1) return scalar(stripComment(first).trim());
  // Fold: single newlines become spaces, blank lines become newlines.
  let joined = "";
  for (let k = 0; k < parts.length; k++) {
    const s = parts[k];
    if (s === "") joined += "\n";
    else if (k === 0 || joined.endsWith("\n")) joined += s;
    else joined += " " + s;
  }
  if (first[0] === '"') joined = joined.replace(/\\ (?=\S)/g, "");
  return scalar(stripComment(joined).trim());
}

function blockScalar(p, style, chomp, parentIndent) {
  const body = [];
  let ind = -1;
  while (p.i < p.lines.length) {
    const l = p.lines[p.i];
    if (l.trim() === "") { body.push(ind >= 0 ? l.slice(ind) : ""); p.i++; continue; }
    const li = indentOf(l);
    if (li <= parentIndent) break;
    if (ind < 0) ind = li;
    if (li < ind) break;
    body.push(l.slice(ind));
    p.i++;
  }
  let trailing = 0;
  while (body.length && body[body.length - 1] === "") { body.pop(); trailing++; }
  let s;
  if (style === "|") s = body.join("\n");
  else {
    // Folding: a break between two plain lines becomes a space, each blank line a newline,
    // and more-indented lines keep their breaks.
    s = body[0] || "";
    for (let k = 1; k < body.length; k++) {
      const cur = body[k], prev = body[k - 1];
      if (cur === "") s += "\n";
      else if (prev === "") s += cur;
      else if (/^\s/.test(cur) || /^\s/.test(prev)) s += "\n" + cur;
      else s += " " + cur;
    }
  }
  if (chomp === "-") return s;
  if (chomp === "+") return body.length ? s + "\n".repeat(trailing + 1) : "\n".repeat(trailing);
  return body.length ? s + "\n" : "";
}

function scalar(s) {
  if (s === "") return null;
  if (s[0] === '"') {
    const inner = s.slice(1, s.lastIndexOf('"'));
    return inner.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, e) => {
      const map = { n: "\n", t: "\t", r: "\r", "0": "\0", '"': '"', "\\": "\\", "/": "/", " ": " ", e: "\x1b", b: "\b", f: "\f", N: "\x85", _: "\xa0" };
      if (e[0] === "x" || e[0] === "u" || e[0] === "U") return String.fromCodePoint(parseInt(e.slice(1), 16));
      return e in map ? map[e] : e;
    });
  }
  if (s[0] === "'") return s.slice(1, s.lastIndexOf("'")).replace(/''/g, "'");
  if (s[0] === "[" || s[0] === "{") return flow(s);
  if (/^(null|Null|NULL|~)$/.test(s)) return null;
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?(0|[1-9][0-9]*)$/.test(s)) return Number(s);
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(s)) return Number(s);
  return s;
}

function flow(s) {
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const value = () => {
    ws();
    if (s[i] === "[") {
      i++; const arr = []; ws();
      if (s[i] === "]") { i++; return arr; }
      for (;;) { arr.push(value()); ws(); if (s[i] === ",") { i++; ws(); if (s[i] === "]") { i++; return arr; } continue; } if (s[i] === "]") { i++; return arr; } throw new Error("YAML: bad flow sequence: " + s); }
    }
    if (s[i] === "{") {
      i++; const obj = {}; ws();
      if (s[i] === "}") { i++; return obj; }
      for (;;) {
        const k = value(); ws();
        let v = null;
        if (s[i] === ":") { i++; v = value(); ws(); }
        obj[String(k)] = v;
        if (s[i] === ",") { i++; ws(); if (s[i] === "}") { i++; return obj; } continue; }
        if (s[i] === "}") { i++; return obj; }
        throw new Error("YAML: bad flow mapping: " + s);
      }
    }
    if (s[i] === '"' || s[i] === "'") {
      const end = quotedEnd(s, i);
      const tok = s.slice(i, end + 1); i = end + 1; return scalar(tok);
    }
    const start = i;
    while (i < s.length && !/[,\]}]/.test(s[i]) && !(s[i] === ":" && /[\s,\]}]/.test(s[i + 1] || " "))) i++;
    return scalar(s.slice(start, i).trim());
  };
  return value();
}

// ---------- writer ----------

function stringify(value) {
  if (value === null || typeof value !== "object") return emitScalar(value) + "\n";
  const lines = [];
  emit(value, 0, lines);
  return lines.join("\n") + "\n";
}

function emit(v, indent, out) {
  const pad = " ".repeat(indent);
  if (Array.isArray(v)) {
    for (const item of v) {
      if (isEmptyOrScalar(item)) out.push(`${pad}- ${emitScalar(item)}`);
      else {
        const sub = [];
        emit(item, indent + 2, sub);
        sub[0] = `${pad}- ${sub[0].slice(indent + 2)}`;
        out.push(...sub);
      }
    }
    return;
  }
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    const key = emitScalar(k);
    if (isEmptyOrScalar(val)) out.push(`${pad}${key}: ${emitScalar(val)}`);
    else {
      out.push(`${pad}${key}:`);
      emit(val, indent + 2, out);
    }
  }
}

const isEmptyOrScalar = (v) =>
  v === null || typeof v !== "object" || (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0);

function emitScalar(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[]";
  if (typeof v === "object") return "{}";
  if (typeof v !== "string") return String(v);
  const needsQuote =
    v === "" ||
    v !== v.trim() ||
    /[\n\t\r\\"]/.test(v) ||
    /^[-?:,\[\]{}#&*!|>'%@`]/.test(v) ||
    /: |:$| #/.test(v) ||
    scalar(v) !== v;
  return needsQuote ? JSON.stringify(v) : v;
}

module.exports = { parse, stringify };
