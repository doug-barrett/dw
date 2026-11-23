# Data Modeler file format (`model/`)

All files are YAML in the subset the app's parser reads: block maps and lists, flow `[a, b]` and
`{ k: v }`, quoted strings. Quote anything starting with `#`, `@`, `*` or containing `: `.
`scripts/apply-spec.js` writes these for you; this is the reference for reading and hand edits.

## `model/tags.yml` — vocabulary

```yaml
# leading comment block is preserved by the app
roles:                       # FIXED set — the app can only relabel/recolour them
  businessKeyPart: { label: Business key, emoji: 🔑, color: "#F5A623" }
  ...
tags:                        # free-form; add freely
  pii: { label: PII, emoji: 🔒, color: "#D0021B" }
```

| Role | Meaning | Typical downstream use |
|---|---|---|
| `businessKeyPart` | Column (set) that identifies one row — the grain / natural key. DBML pk. | Hub business key; dimension business key; MERGE key |
| `unitOfWorkMember` | References another entity's business key; the UoW columns of one node belong together as a relationship | Link; fact → dimension references |
| `dependentChildKey` | Qualifies a relationship/key without identifying an entity (line number, sequence) | Link dependent child; part of a fact grain |
| `drivingKey` | Side of a relationship whose change ends the previous relationship | Effectivity satellite |
| `changeTracking` | Attribute whose history must be kept | Satellite change detection; type-2 dimension column |
| `systemAudit` | Technical load metadata (LDTS, RSRC, hash diff, SCD dates) | System columns |
| `descriptive` | Plain descriptive attribute; history optional | Satellite / dimension attribute |
| `ignore` | Not carried downstream | Excluded |

A column can carry several roles (`[businessKeyPart, unitOfWorkMember]` for a key that is both the
grain and a foreign key). Tags in the template (`assets/tags.yml`): `pii`, `currency`, `measure`,
`code` (low-cardinality code/reference value), `eventDate`, `freeText`, `surrogateKey`, `deprecated`.

## `model/nodes/<LOC>-<NAME>.yml` — built node

```yaml
modelVersion: 1
node:
  id: 5ee3fc99-…            # the node's id from nodes/ (V2 .sql: its @id, else the file name)
  location: SRC_TPCH
  name: ORDERS
  label: Order              # business name (optional)
columns:                    # only columns with metadata; node's column order
  - id: 80822697-…          # columnReference.columnCounter in a V1 .yml node; column NAME in a .sql node
    name: O_ORDERKEY
    label: Order number
    roles: [businessKeyPart]
    tags: [code]
relations:                  # outgoing; this node is the referencing (many) side
  - id: 3f0c…               # any unique string; apply-spec uses a deterministic uuid
    label: placed by        # optional; becomes the DBML Ref name
    cardinality: many-to-one   # many-to-one | one-to-many | one-to-one | many-to-many
    target: { id: 6540ab88-…, location: EXTERNAL, name: CUSTOMER }
    columns:                # one pair per FK column, matching order for composite keys
      - source: { id: 21a6c59b-…, name: O_CUSTKEY }
        target: { id: 1bc35f70-…, name: c_custkey }
```

## Planned node (not built yet)

```yaml
modelVersion: 1
node:                       # NO id
  location: CORE
  name: HUB_CUSTOMER
  label: Customer
  planned:
    nodeType: Data-Vault:::6        # node type id (definition.yml `id`)
    description: Hub of customers
columns:                    # NO ids; every column has a planned: block
  - name: HK_CUSTOMER_H
    roles: [systemAudit]
    tags: [surrogateKey]
    planned: { dataType: STRING, description: Hash of C_CUSTKEY, derivedFrom: [EXTERNAL-CUSTOMER.c_custkey] }
relations:
  - id: …
    cardinality: many-to-one
    target: { location: CORE, name: HUB_NATION }   # planned or built; ids optional
    columns: [{ source: { name: HK_NATION_H }, target: { name: HK_NATION_H } }]
```

`derivedFrom` entries are `<LOC>-<NODE>.<COLUMN>` and are the build hint for whoever creates the
node. Models pick planned nodes up by `nodeType` and `location` like built nodes.

When a real node with the same location and name appears in `nodes/`, the app (on load) rewrites
the planned file in place: ids filled in, `planned:` renamed to `design:`, relations pointing at it
updated, designed-but-not-built columns kept and reported.

## Planned changes to a built node

In the built node's own file (has `node.id`):

```yaml
node:
  id: 331ebf44-…
  planned: { delete: true, reason: Replaced by FCT_ORDER_LINE }   # delete the node
  # or planned: { nodeType: Data-Vault:::9 }                      # change node type
columns:
  - name: SHIP_DATE_KEY                                 # not in the node: column to add
    planned: { dataType: NUMBER, derivedFrom: [STAGE-STG_X.SHIP_DATE_KEY] }
  - id: d8e23ecc-…
    name: QUANTITY
    planned: { dataType: NUMBER(18,2) }                 # type change
  - id: 32002654-…
    name: IS_DEEP_DISCOUNT
    planned: { delete: true }                           # column to remove
```

A change counts as done once the built node matches it; `planned:` then becomes `design:`
(`deleted: true` for removals).

## `model/models/<slug>.yml` — a model

```yaml
name: Order detail
type: Star Schema           # free text; presets: Source, Star Schema, 3NF, Data Vault
include:
  nodeTypes: [Dimension, Fact]   # node type ids; empty = any
  locations: [DATAMART]          # empty = any; both empty = NOTHING
layout: {}                  # app-managed positions; leave empty — auto layout fills it
# limitedLayout / compactLayout: app-managed variants, never write by hand
```

The slug (file name) is lowercase letters, digits, `-`, `_`.

## DBML export (`model/models/<slug>.dbml`)

Generated by the app on Save and by `check-model.js --write-dbml`. One `Table` per included node
(header colour = node type colour), `businessKeyPart` → `pk` / composite pk index, `not null` from
the node, column note = label | roles | tags | description, table note = label, generic table type
(Hub/Link/Satellite/Dimension/Fact/Source…), location, planned status. Relations between included
nodes become `Ref`s; a `TableGroup` per location. Relations to nodes outside the model are skipped.
