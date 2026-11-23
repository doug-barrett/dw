# Star schemas, data marts and other models

## Star schema / data mart

Design from the tagged source model (or the vault). Read the workspace's own mart conventions first
(the workspace `AGENTS.md` / `CLAUDE.md` often has layering and key rules) — they override this.

| Source / vault metadata | Dimensional object |
|---|---|
| Node with `businessKeyPart` describing a business concept | **Dimension** `DIM_<ENTITY>`: surrogate key (`surrogateKey` tag) + business key (`businessKeyPart`) + attributes |
| `changeTracking` columns | Type-2 candidates — make the dimension type-2 only when the user needs history |
| `descriptive` columns | Type-1 attributes |
| Hierarchy via relations (customer → nation → region) | Flatten into the dimension (snowflaking only on request) |
| Node at a `unitOfWorkMember` grain with `measure`s | **Fact** `FCT_<PROCESS>` at that grain |
| `dependentChildKey`, order numbers | Degenerate dimensions in the fact |
| `eventDate` columns | Role-playing references to `DIM_DATE` (plan it if missing) |
| `code` columns with no entity | Small or junk dimension (`DIM_SHIP_MODE`) or keep on the fact |
| `pii` | Keep out of marts unless required; mention it |

Roles on mart columns: dimension business key → `businessKeyPart`; surrogate key → `surrogateKey`
tag; fact foreign keys → `unitOfWorkMember`; fact grain (when one exists, e.g. a type-1 dimension's
key + a degenerate line number) → `businessKeyPart`; SCD columns → `systemAudit`; measures →
`measure` tag. Relations: **fact → each dimension**, many-to-one on the surrogate key.

Model definition:

```yaml
models:
  star-schema:
    name: Order detail                    # name the business process
    type: Star Schema                     # → star auto layout (facts centre, dims around)
    include: { nodeTypes: [Dimension, Fact], locations: [DATAMART] }
```

Use one model per business process (fact + its dimensions) when the mart grows; conformed
dimensions simply appear in several models. Planned dimensions/facts use the workspace's
Dimension/Fact type ids (`Dimension`, `Fact` here).

When the mart is built from the planned design, remember the Coalesce node flags are separate from
the modeler roles: `isBusinessKey` / `isSurrogateKey` / `isChangeTracking` are top-level column
properties on the real node. The modeler roles document intent; they do not configure the node.

## 3NF / integration layer

Type `3NF` (preset includes Persistent Stage). Same recipe as a source model: entity labels,
`businessKeyPart` per grain, relations for every foreign key, `changeTracking` where the persistent
stage keeps history (`systemAudit` on its SCD columns).

## Other models (conceptual, lineage, subject areas)

- A model is just `include` + layout, so any slice works: by location (`locations: [STAGE]`), by a
  mix of types, or a subject area (all types, a set of locations).
- For a **conceptual model** with no physical nodes, plan nodes in a non-built location (e.g.
  `CONCEPT`), with business labels, a key column each and relations; nodeType can be any existing
  type id. Say clearly that these are not meant to be built.
- Type text not matching star/data vault gets the layered layout (referencing nodes left of the
  referenced ones).

## Reviewing an existing model

Run `check-model.js`, then read: nodes without labels or business keys, relations without labels,
`unitOfWorkMember` columns with no relation, planned nodes whose `derivedFrom` no longer resolves,
and planned changes already carried out. Report findings before editing.
