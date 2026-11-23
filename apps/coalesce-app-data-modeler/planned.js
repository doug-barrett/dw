// Planned nodes: entities designed in model/nodes/<LOC>-<NAME>.yml (a `planned:` block on the node
// and its columns) before a real node exists in nodes/. See AGENTS.md "Data Modeler: planned nodes".
//
//   node:    { location, name, label?, planned: { nodeType, description? } }
//   columns: [{ name, label?, roles?, tags?, planned: { dataType?, description?, derivedFrom? } }]
//
// Once a real node with the same location and name exists, upgrade() rewrites the doc in place into
// a normal metadata file for that node: ids filled in from the real node, columns matched by name,
// and every `planned:` block kept as `design:` so no information is lost.
//
// Planned changes to a BUILT node live in its metadata file (which has node.id):
//   node.planned: { delete: true }            the node is to be deleted
//   node.planned: { nodeType }                 the node type is to change
//   column planned: { dataType, ... }          a column to add (not in the node yet) or retype
//   column planned: { delete: true }           a column to remove
// A change counts as carried out once the built node matches it; its `planned:` then becomes
// `design:` (a deleted column or node keeps its entry, marked `deleted: true`).

const docKey = (key, doc) => [doc?.node?.location, doc?.node?.name].every(Boolean) ? `${doc.node.location}-${doc.node.name}` : key;
// A planned NEW node has no id yet; files of built nodes always have one.
const isPlanned = (doc) => !!doc?.node?.planned && !doc.node.id && !doc.node.planned.delete;
const normType = (t) => String(t || "").toUpperCase().replace(/\s+/g, "");

function findColumn(node, ref) {
  if (!node || !ref) return null;
  return (
    node.columns.find((c) => ref.id && c.id === ref.id) ||
    node.columns.find((c) => c.name === ref.name) ||
    node.columns.find((c) => String(c.name).toLowerCase() === String(ref.name).toLowerCase()) ||
    null
  );
}

// Real node with the same location and name (exact, then case-insensitive).
function findReal(realNodes, location, name) {
  return (
    realNodes.find((n) => n.location === location && n.name === name) ||
    realNodes.find((n) => n.location.toLowerCase() === String(location).toLowerCase() && n.name.toLowerCase() === String(name).toLowerCase()) ||
    null
  );
}

// Nodes to show for planned docs that have no real node yet; same shape as workspace.loadNodes().
function plannedNodes(model, realNodes) {
  const out = [];
  for (const [key, doc] of Object.entries(model)) {
    if (!isPlanned(doc)) continue;
    const [location, name] = [doc.node.location, doc.node.name];
    if (!location || !name || findReal(realNodes, location, name)) continue;
    out.push({
      id: `planned:${docKey(key, doc)}`,
      location,
      name,
      nodeType: String(doc.node.planned.nodeType || ""),
      format: "planned",
      planned: true,
      status: "new",
      description: doc.node.planned.description || "",
      columns: (doc.columns || [])
        .filter((c) => c?.name)
        .map((c) => ({
          id: c.name, // like SQL nodes: a planned column is identified by its name
          name: c.name,
          dataType: c.planned?.dataType || "",
          description: c.planned?.description || "",
          nullable: c.planned?.nullable !== false,
        })),
    });
  }
  return out;
}

const ordered = (obj, first) => {
  const o = {};
  for (const k of first) if (obj[k] !== undefined) o[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in o)) o[k] = obj[k];
  return o;
};

// Rewrites planned docs whose real node now exists. Returns the changed docs and the upgraded keys;
// relations in other docs that point at an upgraded node get its real ids too.
function upgrade(model, realNodes) {
  const changed = {};
  const upgraded = [];
  const byKey = new Map(); // upgraded key -> real node
  for (const [key, doc] of Object.entries(model)) {
    if (!isPlanned(doc)) continue;
    const real = findReal(realNodes, doc.node.location, doc.node.name);
    if (!real) continue;
    const { planned, ...nodeRest } = doc.node;
    const design = { ...(doc.node.design || {}), ...planned };
    const next = { ...doc };
    next.node = ordered({ ...nodeRest, id: real.id, location: real.location, name: real.name, design }, ["id", "location", "name", "label", "design"]);
    next.columns = (doc.columns || []).map((m) => {
      const col = findColumn(real, m);
      const { planned: colPlanned, ...rest } = m;
      const out = { ...rest };
      if (col) Object.assign(out, { id: col.id, name: col.name });
      if (colPlanned) out.design = { ...(m.design || {}), ...colPlanned };
      return ordered(out, ["id", "name", "label", "roles", "tags", "design"]);
    });
    changed[key] = next;
    upgraded.push(key);
    byKey.set(`${real.location}-${real.name}`, real);
  }
  if (!upgraded.length) return { changed, upgraded };

  // Fix relation ends that point at upgraded nodes (in any doc, including the upgraded ones).
  const realFor = (location, name) => byKey.get(`${location}-${name}`);
  for (const [key, original] of Object.entries(model)) {
    const doc = changed[key] || original;
    if (!doc?.relations?.length) continue;
    let touched = false;
    const ownReal = byKey.get(docKey(key, doc));
    const relations = doc.relations.map((r) => {
      const target = r.target && realFor(r.target.location, r.target.name);
      if (!target && !ownReal) return r;
      const nr = { ...r };
      if (target && r.target.id !== target.id) (nr.target = ordered({ ...r.target, id: target.id }, ["id", "location", "name"])), (touched = true);
      nr.columns = (r.columns || []).map((p) => {
        const np = { ...p };
        const s = ownReal && findColumn(ownReal, p.source);
        const t = target && findColumn(target, p.target);
        if (s && p.source?.id !== s.id) (np.source = { id: s.id, name: s.name }), (touched = true);
        if (t && p.target?.id !== t.id) (np.target = { id: t.id, name: t.name }), (touched = true);
        return np;
      });
      return nr;
    });
    if (touched) changed[key] = { ...doc, relations };
  }
  return { changed, upgraded };
}

// Pending planned changes of a built node, from its metadata doc.
function pendingChanges(node, doc) {
  const out = { deleteNode: false, nodeType: null, add: [], retype: [], remove: [] };
  if (!doc) return out;
  const np = doc.node?.planned;
  if (np?.delete) out.deleteNode = true;
  if (np?.nodeType && String(np.nodeType) !== String(node.nodeType)) out.nodeType = String(np.nodeType);
  for (const m of doc.columns || []) {
    if (!m?.planned) continue;
    const col = findColumn(node, m);
    if (m.planned.delete) {
      if (col) out.remove.push(col.name);
    } else if (!col) out.add.push(m);
    else if (m.planned.dataType && normType(m.planned.dataType) !== normType(col.dataType)) out.retype.push({ name: col.name, from: col.dataType, to: m.planned.dataType });
  }
  return out;
}

// Adds planning status to built nodes: status "deleted" / "changed" / "unchanged", per-column
// `change` ("new" / "changed" / "deleted") and rows for columns that are to be added.
function decorate(realNodes, model) {
  return realNodes.map((n) => {
    const doc = model[`${n.location}-${n.name}`];
    const p = pendingChanges(n, doc);
    const changed = p.nodeType || p.add.length || p.retype.length || p.remove.length;
    const status = p.deleteNode ? "deleted" : changed ? "changed" : "unchanged";
    if (status === "unchanged") return n;
    const retyped = new Map(p.retype.map((r) => [r.name, r]));
    const columns = n.columns.map((c) =>
      p.remove.includes(c.name) ? { ...c, change: "deleted" } : retyped.has(c.name) ? { ...c, change: "changed", plannedType: retyped.get(c.name).to } : c,
    );
    for (const m of p.add)
      columns.push({ id: m.name, name: m.name, dataType: m.planned.dataType || "", description: m.planned.description || "", nullable: m.planned.nullable !== false, change: "new" });
    return { ...n, status, columns, pending: p };
  });
}

// Moves carried-out changes of built nodes from `planned:` to `design:`. Returns changed docs.
function applyChanges(model, realNodes) {
  const changed = {};
  for (const [key, doc] of Object.entries(model)) {
    if (!doc?.node?.id) continue; // planned new nodes are handled by upgrade()
    const hasPlanned = doc.node.planned || (doc.columns || []).some((m) => m?.planned);
    if (!hasPlanned) continue;
    const real = realNodes.find((n) => n.id === doc.node.id) || findReal(realNodes, doc.node.location, doc.node.name);
    let touched = false;
    const next = { ...doc, node: { ...doc.node } };
    const toDesign = (obj, extra = {}) => {
      const { planned, ...rest } = obj;
      const { delete: _carriedOut, ...plan } = planned; // a done deletion is recorded as deleted: true
      touched = true;
      return { ...rest, design: { ...(obj.design || {}), ...plan, ...extra } };
    };
    if (!real) {
      // Node gone: a planned deletion was carried out (other plans stay as they were).
      if (doc.node.planned?.delete) next.node = ordered(toDesign(doc.node, { deleted: true }), ["id", "location", "name", "label", "design"]);
    } else {
      const np = doc.node.planned;
      if (np && !np.delete && (!np.nodeType || String(np.nodeType) === String(real.nodeType)))
        next.node = ordered(toDesign(doc.node), ["id", "location", "name", "label", "design"]);
      next.columns = (doc.columns || []).map((m) => {
        if (!m?.planned) return m;
        const col = findColumn(real, m);
        let done;
        if (m.planned.delete) done = !col && toDesign(m, { deleted: true });
        else done = col && (!m.planned.dataType || normType(m.planned.dataType) === normType(col.dataType)) && toDesign({ ...m, id: col.id, name: col.name });
        return done ? ordered(done, ["id", "name", "label", "roles", "tags", "design"]) : m;
      });
    }
    if (touched) changed[key] = next;
  }
  return changed;
}

module.exports = { plannedNodes, upgrade, applyChanges, decorate, pendingChanges, isPlanned, findColumn };
