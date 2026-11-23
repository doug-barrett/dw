// Model membership and model-type presets, shared by the server (DBML) and the browser.
//
// A model definition (model/models/<slug>.yml):
//   name: Sales star schema
//   type: Star Schema            # free text; the presets below pre-select node types
//   include:
//     nodeTypes: [Dimension, Fact]   # node type ids; empty = any type
//     locations: [DATAMART]          # storage locations; empty = any location
//   layout: { <LOC>-<NAME>: { x, y } }
(function (root) {
  // Presets match node types by name (or id), so they work against any workspace's types.
  const PRESETS = [
    { type: "Source", match: (t) => t.id === "Source" },
    { type: "Star Schema", match: (t) => /\b(dimension|fact)\b/i.test(t.name) },
    { type: "3NF", match: (t) => /persistent\s*stage/i.test(t.name) || t.id === "persistentStage" },
    { type: "Data Vault", match: (t) => /\b(hub|link|satellite)\b/i.test(t.name) },
  ];

  function presetNodeTypes(type, nodeTypes) {
    const p = PRESETS.find((x) => x.type.toLowerCase() === String(type || "").trim().toLowerCase());
    return p ? nodeTypes.filter(p.match).map((t) => t.id) : null;
  }

  // A node belongs to a model when it matches both lists; an empty list matches everything.
  // A model with neither list set includes nothing, so a new model never floods the canvas.
  function includes(def, node) {
    const types = def?.include?.nodeTypes || [];
    const locs = def?.include?.locations || [];
    if (!types.length && !locs.length) return false;
    return (!types.length || types.includes(node.nodeType)) && (!locs.length || locs.includes(node.location));
  }

  function slugify(name, taken = []) {
    const base = String(name || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "model";
    let slug = base;
    for (let i = 2; taken.includes(slug); i++) slug = `${base}-${i}`;
    return slug;
  }

  // Auto layout strategy for a model type: dimensional models get the star layout.
  const isDimensional = (def) => /\b(star|dimensional|snowflake|kimball|data\s*marts?)\b/i.test(def?.type || "");
  const isFactType = (t) => /\bfact\b/i.test(t?.name || "") || t?.id === "Fact";

  const isDataVault = (def) => /\b(data\s*vault|raw\s*vault|business\s*vault|dv2?)\b/i.test(def?.type || "");
  // Data Vault role of a node type, from its name (package types are e.g. "...: Hub", "...: Satellite v1").
  const vaultRole = (t) => {
    const name = t?.name || "";
    if (/\bhub\b/i.test(name)) return "hub";
    if (/\blink\b/i.test(name)) return "link";
    if (/\bsat(ellite)?\b/i.test(name)) return "sat";
    return undefined;
  };

  // Generic table type of a Coalesce node type, for exports (DBML): package prefixes ("Datavault by
  // Scalefree: …") and version suffixes ("v0", "v1") are dropped. Data Vault types get a subtype.
  function tableType(t) {
    const raw = String(t?.name || t?.id || "");
    const name = raw.replace(/^.*?:\s*/, "").replace(/\s+v\d+$/i, "").trim();
    const n = name.toLowerCase();
    if (t?.id === "Source" || n === "source") return { type: "Source" };
    if (/\bhub\b/.test(n)) return { type: "Hub", subtype: /reference/.test(n) ? "Reference Hub" : "Standard Hub" };
    if (/\blink\b/.test(n)) return { type: "Link", subtype: /non-historized/.test(n) ? "Non-Historized Link" : "Standard Link" };
    if (/\bsat(ellite)?\b/.test(n)) {
      const kind = name.replace(/\s*\bsat(ellite)?\b\s*/i, " ").trim();
      return { type: "Satellite", subtype: kind ? `${kind} Satellite` : "Standard Satellite" };
    }
    if (/\bpit\b/.test(n)) return { type: "PIT" };
    if (/\bsnapshot\b/.test(n)) return { type: "Snapshot" };
    if (/reference table/.test(n)) return { type: "Reference Table" };
    if (/\bfact\b/.test(n)) return { type: "Fact" };
    if (/\bdimension\b/.test(n)) return { type: "Dimension" };
    if (/persistent\s*stage/.test(n)) return { type: "Persistent Stage" };
    if (/\b(stage|work)\b/.test(n)) return { type: "Stage" };
    if (/\bview\b/.test(n)) return { type: "View" };
    return { type: name || "Table" };
  }

  const api = { PRESETS, presetNodeTypes, includes, slugify, isDimensional, isFactType, isDataVault, vaultRole, tableType };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Models = api;
})(typeof window !== "undefined" ? window : globalThis);
