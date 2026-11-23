---
name: coalesce-data-model
description: Use whenever the workspace has a model/ folder or the Data Modeler app is installed — while planning and building. It holds the designed data model: business keys and relationships of source nodes, business labels, PII and measure tags, and planned nodes or planned changes that are designs waiting to be built. Read it to choose grains, joins, keys, annotations, tests and names; build planned nodes exactly as designed. Also how to write model/: find the modeling style per layer, keep a data model per layer, add the future (planned) nodes while planning, and document what you build.
---

# Using the Data Modeler's `model/` metadata

The Data Modeler app keeps a designed data model next to the nodes, in `model/`. Coalesce itself
never reads it, but it is the person's (or a reviewed agent's) **intent**: which columns identify
rows, how nodes relate, what is personal data, and which nodes are designed but not built yet. Use
it whenever it covers what you are building. `nodes/` stays the truth for what exists.

You may write to `model/` (section 6 says what and how) — while planning too, when the guide says
the Data Modeler app is installed. The person sees those files on the plan and review cards, can
open them in the Data Modeler, and applies them with the nodes. When you build a planned node, leave its planned file
alone: the Data Modeler app notices the real node and rewrites the file into normal metadata
itself, keeping the design as history.

## 1. Find what applies (plan stage)

- `Glob model/**/*.yml`. No `model/` folder and no Data Modeler app (the guide says when it's
  installed) → this skill doesn't apply. App installed but no `model/` yet → start one (section 6).
- `model/tags.yml` — the vocabulary: role and tag keys with labels (and a comment block explaining
  the roles).
- `model/nodes/<LOCATION>-<NAME>.yml` — one per node. Read the files of every node you read from or
  build: the source nodes behind the request, their neighbours, and the targets.
- `model/models/<slug>.yml` — named views (`type: Source`, `Data Vault`, `Star Schema`…) and the
  node types / locations they include. Use them to understand which layer a request belongs to.
- Files with a `node.planned` block and **no `node.id`** are **planned nodes**: designs not built.
  Files of built nodes (with `node.id`) may hold **planned changes** (`planned:` on the node or on
  columns).

## 2. Planned nodes are the spec

When the request asks for what the model designs ("build the planned data vault", "build
DIM_DATE", or the request overlaps planned nodes), build those nodes **as designed**:

| Design | Build |
|---|---|
| `node.location`, `node.name` | The node file `nodes/<LOCATION>-<NAME>.*` — exactly these, so the app links design and node |
| `node.planned.nodeType` | The node type id. Its `fileVersion` decides `.sql` (2) or `.yml` (1), as usual |
| `node.planned.description` | The node description |
| column `name` | Column names, exactly (case included) |
| column `planned.dataType` / `description` | Data type and description |
| column `planned.derivedFrom: [<LOC>-<NODE>.<COLUMN>]` | Where the column comes from: `ref('<LOC>', '<NODE>')` and that column (combine several for hashes/concatenations) |
| `relations` between planned/built nodes | Join keys and the foreign-key columns the node must carry |
| column `roles` / `tags` | Keys and annotations, see section 3 |

List every planned node you will build in the plan, with "as designed in the data model". Build
order follows `derivedFrom` and relations. Anything you must change from the design (a column that
can't be derived, a type that doesn't exist) is a **decision** in the plan or review — never a
silent deviation. Planned nodes the request doesn't ask for: leave them, and mention them only if
they matter for the request.

**Planned changes** on built nodes — `columns[].planned` for a column not in the node (add it), a
`dataType` differing from the node's (retype), `planned: { delete: true }` (remove the column),
`node.planned: { delete: true }` or `{ nodeType }` — are carried out only when the request asks
for them or they are necessary for it. Otherwise mention them if relevant.

## 3. Roles and tags → building decisions

Roles are a fixed set; tags are the workspace's own (read their labels in `model/tags.yml`).

| Metadata | Use it for |
|---|---|
| `businessKeyPart` | The grain: the column set that identifies one row. Business key of dimensions, hubs and persistent stages (the node type's business-key flag, e.g. `isBusinessKey`, only where the type declares it); MERGE/dedupe key; a uniqueness check candidate |
| `unitOfWorkMember` + `relations` | Join paths. A relation's column pairs are the join condition (all pairs for a composite key). `many-to-one` from A to B: joining A to B keeps A's grain; joining B to A **fans out** — that's a check worth proposing. Fact/link foreign keys |
| `dependentChildKey` | Part of the grain under a parent key (line number) — degenerate dimension, link dependent child |
| `drivingKey` | The side whose change ends a relationship (effectivity) |
| `changeTracking` | History matters: type-2 / change-tracking columns (`isChangeTracking` where the type declares it), satellite payload. Make a dimension type-2 only when the request wants history |
| `descriptive` | Ordinary attributes (type-1) |
| `systemAudit` | Technical load columns — never business attributes, never join keys |
| `ignore` | Leave the column out downstream |
| `pii` tag | Apply the workspace's PII annotation/flags if its nodes use one; keep out of marts and reports unless asked; separate PII satellites in a vault. Raise it as a decision when unclear |
| `measure` / `currency` tags | Facts' measures and aggregations; currency amounts keep their precision |
| `code` tag | Low-cardinality codes: lookups, small/junk dimensions, accepted-values checks |
| `eventDate` tag | Date keys / date dimension roles |
| `surrogateKey` tag | Generated keys — don't treat as business keys |

Node and column **labels** are business names: use them for descriptions (`@description` or the
description field) and, when the request asks for business-friendly output names, for column
names (in the workspace's naming style, e.g. `Order date` → `ORDER_DATE`).

## 4. Checks from the model

The highest-value checks usually come straight from the metadata: uniqueness of the
`businessKeyPart` columns at the node's grain, and that a join along a relation doesn't fan out or
drop rows (every foreign key finds its parent). Propose those only where the pipeline relies on
them, as the guide says.

## 5. When the model and the workspace disagree

`nodes/` wins for what exists. If metadata points at a column or node that isn't there, or a
planned design conflicts with the request, follow the request and the real nodes, and say so in
the plan's or review's decisions. Fix the metadata yourself only when the request covers it.

## 6. Writing to `model/`

**When.** Whenever the Data Modeler app is installed (the guide then has a "Future state data
model" section: follow its order), and in any workspace with `model/` for requested metadata
changes. Without the app and without `model/`, don't start one.

### 6a. Modeling style per layer

A layer is a storage location. Its style comes from the node types its nodes use (read each type's
`name` in its definition.yml), or — for a layer without nodes yet — from the workspace's
conventions and the installed types that default to it (`packages/*.yml` →
`defaultStorageLocation`).

| Node type names | Style | Model `type` (drives the auto layout) |
|---|---|---|
| Source (built-in) | Source | `Source` |
| Stage, SQL Stage, View, …: Stage | Staging | `Staging` |
| Persistent Stage | 3NF / history | `3NF` |
| …: Hub, …: Link, …: Satellite, PIT, Reference … | Data Vault | `Data Vault` |
| Dimension…, Fact… | Star schema / data mart | `Star Schema` |

### 6b. A data model per layer

For every layer the pipeline reads from or builds into, one `model/models/<slug>.yml`:

```yaml
name: Data Vault                 # the layer's business name
type: Data Vault                 # from the table above
include:
  nodeTypes: [Data-Vault:::6, Data-Vault:::7, Data-Vault:::8]   # definition ids of the layer's types
  locations: [CORE]              # the layer's location(s)
layout: {}                       # always empty in new files; the app lays nodes out
```

Reuse an existing model whose include already covers the layer (add a missing type id or location
to its include rather than creating a second one). Slugs: lowercase, digits, `-`. A Data Vault
layer can also get a `spine` model (hubs and links only, `type: Data Vault`).

Then document the layer's **existing** nodes that have no metadata file yet: entity label, a
label per column, `businessKeyPart` on the grain, `unitOfWorkMember` on foreign keys, other roles
and tags (section 3), and a relation per foreign key. That is what makes the model show the current
state with its relations.

### 6c. Future nodes

Every node in the plan becomes design in `model/` while planning:

- **New node** → planned node file (no ids), `node.planned: { nodeType, description }`, every
  column with `planned: { dataType, description?, derivedFrom: [<LOC>-<NODE>.<COLUMN>] }`, roles and
  tags, and relations to the nodes it references (planned or built).
- **Modified node** → planned changes in its existing metadata file (columns to add, retype or
  delete; see the file shapes).
- Derivation per style: hubs from `businessKeyPart` entities, links from `unitOfWorkMember` sets
  (with `dependentChildKey`s), satellites from the remaining columns split by `pii` tag and rate of
  change, satellites → their hub/link and links → each hub as many-to-one relations; dimensions
  from business-key entities (surrogate key tagged `surrogateKey`), facts at a `unitOfWorkMember`
  grain with `measure`s and a relation to each dimension; staging nodes 1:1 with their source,
  same roles, relation to the source's relations' targets in staging.
- Use the workspace's naming conventions (existing nodes, AGENTS.md); hash key, load date and
  record source names from the Data Vault package variables when there is one.

### 6d. While building

- **Planned nodes**: build them exactly as designed and leave the planned files; the Data Modeler
  upgrades them. A deviation → update the planned file and raise it as a decision.
- **Nodes built without a design** (no Data Modeler, or a node added later): write a normal
  metadata file for each (ids, labels, roles, tags, relations) — skip it for nodes built from a
  planned file.
- **Requested metadata changes**: labels, roles, tags or relations on existing nodes, planned
  changes (`planned:` on a built node's columns or node).

### 6e. No `model/` yet

Create `model/tags.yml` with exactly this content, then the models and node files:

```yaml
# Coalesce Data Modeler vocabulary.
# roles: the fixed structural vocabulary (businessKeyPart = grain / DBML pk, unitOfWorkMember =
# reference to another entity's key, dependentChildKey, drivingKey, changeTracking = keep history,
# systemAudit = load metadata, descriptive, ignore). tags: free-form classification.

roles:
  businessKeyPart: { label: Business key, emoji: 🔑, color: "#F5A623" }
  unitOfWorkMember: { label: Unit of work member, emoji: 🔗, color: "#4C8BF5" }
  dependentChildKey: { label: Dependent child key, emoji: 🧩, color: "#F8E71C" }
  drivingKey: { label: Driving key, emoji: 🚦, color: "#BD10E0" }
  changeTracking: { label: Change tracking, emoji: 📈, color: "#50E3C2" }
  systemAudit: { label: System / audit, emoji: ⚙️, color: "#9B9B9B" }
  descriptive: { label: Descriptive, emoji: 📝, color: "#B8B8B8" }
  ignore: { label: Ignore, emoji: 🚫, color: "#6E6E6E" }
tags:
  pii: { label: PII, emoji: 🔒, color: "#D0021B" }
  currency: { label: Currency amount, emoji: 💶, color: "#7ED321" }
  measure: { label: Measure, color: "#722ED1" }
  code: { label: Code / reference value, color: "#FA8C16" }
  eventDate: { label: Event date, color: "#2F54EB" }
  freeText: { label: Free text, color: "#8C8C8C" }
  surrogateKey: { label: Surrogate key, color: "#13C2C2" }
  deprecated: { label: Deprecated, emoji: ⚠️, color: "#000000" }
```

**Rules — the Data Modeler reads these files strictly:**

- File name = `node.location` + `-` + `node.name` + `.yml`. Start with `modelVersion: 1`.
- **Ids.** Built node: `node.id` is the node's id — a V2 `.sql` node's `@id(...)`, a V1 `.yml`
  node's top-level `id`. Column `id`: in a `.sql` node the **column name**; in a `.yml` node the
  column's `columnReference.columnCounter`. Relation `target.id` and column-pair ids follow the same
  rules. **Planned** nodes and their columns have **no ids**. Each relation needs its own `id`
  (any unique string, e.g. a new UUID).
- **Roles are fixed**: `businessKeyPart`, `unitOfWorkMember`, `dependentChildKey`, `drivingKey`,
  `changeTracking`, `systemAudit`, `descriptive`, `ignore`. Tags must exist in `model/tags.yml`;
  to add one, add it there (`label`, `color`) without changing anything else in the file.
- Relations live in the referencing node's file, pointing at the referenced node,
  `cardinality: many-to-one`; a composite key is one relation with several column pairs.
- **Merge, don't rewrite.** In an existing file change only what you need; keep every other key,
  column entry and relation exactly as it is. Never touch `layout`, `limitedLayout` or
  `compactLayout` in model definitions (new models get `layout: {}` — the app lays them out),
  never write or edit `*.dbml` (the app regenerates them on Save), and never remove `design:`
  blocks.
- In a model definition, `include` lists node type ids and/or locations; with both empty the
  model shows nothing. Models pick up new nodes by type and location — usually no edit is needed.
- Keep the YAML simple: block style, two-space indents, flow lists like `[a, b]`; quote values
  starting with `#`, `@` or `*` or containing `: `.
- Finish by re-reading each model file you wrote: ids match the nodes, every role and tag exists,
  every relation's target node and columns exist (built or planned).

## File shapes (reference)

```yaml
# model/nodes/SRC_TPCH-ORDERS.yml — built node
modelVersion: 1
node: { id: 5ee3fc99-…, location: SRC_TPCH, name: ORDERS, label: Order }
columns:
  - { id: 80822697-…, name: O_ORDERKEY, label: Order number, roles: [businessKeyPart] }
  - { id: 21a6c59b-…, name: O_CUSTKEY, label: Customer number, roles: [unitOfWorkMember] }
relations:                                   # from this (many) node to the referenced (one) node
  - id: …
    label: placed by
    cardinality: many-to-one
    target: { id: 6540ab88-…, location: EXTERNAL, name: CUSTOMER }
    columns: [{ source: { name: O_CUSTKEY }, target: { name: c_custkey } }]

# model/nodes/CORE-HUB_CUSTOMER.yml — planned node (no ids)
modelVersion: 1
node:
  location: CORE
  name: HUB_CUSTOMER
  planned: { nodeType: Data-Vault:::6, description: Hub of customers }
columns:
  - name: C_CUSTKEY
    roles: [businessKeyPart]
    planned: { dataType: NUMBER(38,0), derivedFrom: [EXTERNAL-CUSTOMER.c_custkey] }
```

Column metadata is matched to the node's columns by `id`
(V1 `.yml` nodes: `columnReference.columnCounter`; V2 `.sql` nodes: the column name) or by `name`.
