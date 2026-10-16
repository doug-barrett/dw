---
name: dw-pipeline-development
description: >-
  Build and extend Coalesce Transform pipelines in the dw (NY taxi) demo repo,
  following this repo's own node conventions. Use this skill whenever the user
  wants to add a source, stage, dimension, fact, or view node here; build a
  "standard pipeline" over a BRONZE table; scaffold a new star (dim/fact);
  create a role-playing dimension view; or asks how nodes are structured,
  named, wired, or tested in this workspace. Trigger even when the user just
  names a BRONZE table and says "build the pipeline" or "add a dimension over
  it" — the medallion layout (BRONZE -> SILVER -> GOLD -> PLATINUM), V1 YAML
  shape, column wiring, system columns, and coa verification all live here.
---

# dw pipeline development

This repo (`dw`) is a Coalesce Transform demo built on NYC yellow-cab data. It
follows a strict medallion layout, and every node is a **V1 YAML** file under
`nodes/`, named `<LOCATION>-<NAME>.yml`. This skill captures the exact
conventions already in the repo so new work looks identical to what's there.

Before running `coa`, read `~/.coalesce/desktop/AGENTS.md` for the current CLI
entrypoint. In this workspace the shim is `~/.coalesce/desktop/coa`.

## The layer map

| Layer | locationName | Warehouse schema | sqlType | Naming | Job |
|-------|-------------|------------------|---------|--------|-----|
| Bronze | BRONZE | `NY_TAXI.BRONZE` | Source | `<TABLE>` | raw warehouse table, scaffolded |
| Silver | SILVER | `DOUG_DB.DEV_SILVER` | Stage | `STG_<NAME>` | 1:1 clean passthrough, truncate+reload |
| Silver | SILVER | `DOUG_DB.DEV_SILVER` | View | `<ROLE>_<NAME>` | role-playing view (e.g. PICKUP_LOCATION) |
| Gold | GOLD | `DOUG_DB.DEV_GOLD` | Dimension | `DIM_<NAME>` | conformed dim: surrogate + business key |
| Gold | GOLD | `DOUG_DB.DEV_GOLD` | Fact | `FCT_<NAME>` | measures + business key + system dates |
| Platinum | PLATINUM | `DOUG_DB.DEV_GOLD` | View | `V_<NAME>` | consumer-facing read layer |

`defaultStorageMapping` is `SILVER`. Locations are declared in `locations.yml`;
never invent a new one.

## Standard pipelines

**Dimension flavor** (business entity — driver, vendor, location, rate code):
```
BRONZE Source -> SILVER STG_<NAME> -> GOLD DIM_<NAME> -> PLATINUM V_<NAME>
```
**Fact flavor** (events / measures — trips, financials):
```
BRONZE Source -> SILVER STG_<NAME> -> GOLD FCT_<NAME> -> PLATINUM V_<NAME>
```
Pick dimension vs. fact by whether the source describes a *thing* (dimension) or
*something that happened and is measured* (fact).

## Workflow

1. **Scaffold the source** from the live warehouse — never hand-write a Source:
   ```bash
   ~/.coalesce/desktop/coa sources list --location BRONZE          # see what's available
   ~/.coalesce/desktop/coa sources add --location BRONZE --include '<TABLE>'
   ```
   This writes `nodes/BRONZE-<TABLE>.yml` with every column, its real
   `dataType`, and a unique `columnCounter` per column. Read it to grab the
   node `id` and each column's `columnCounter` — downstream nodes point back to
   them.

2. **Author the downstream nodes.** Because every node needs unique UUIDs and
   each column must reference its upstream `columnCounter`/node `id` exactly,
   generating the YAML by hand is error-prone. Use the bundled generator:
   `scripts/gen_pipeline.py` (see `references/generator.md`). It reads the
   source YAML and emits a correct Stage + Dimension/Fact + View. Edit the
   output if the model needs custom transforms, then re-verify.

3. **Verify without touching Snowflake:**
   ```bash
   ~/.coalesce/desktop/coa validate                                  # schema + lineage/type checks
   ~/.coalesce/desktop/coa create --include "{ STG_<NAME> }+" --dry-run   # preview DDL for the whole chain
   ```
   `{ STG_<NAME> }+` means "this node and everything downstream" — one selector
   covers stage, gold, and view. Only after a clean dry-run offer the real
   `coa create` (DDL) and `coa run` (DML); those mutate the warehouse, so
   confirm with the user first.

When validate reports pre-existing issues on *other* nodes, filter to the nodes
you just touched before reporting — don't claim your work failed because the
YELLOW_CAB nodes already have drift.

## The wiring rule (the thing that breaks most often)

Every non-source column carries a `sourceColumnReferences` block. Two IDs link
the DAG together:

- `stepCounter` -> the **upstream node's `id`**
- `columnCounter` (inside `columnReferences`) -> the **upstream column's own `columnCounter`**

The column's own `columnReference.stepCounter` is **this** node's `id`, and its
`columnReference.columnCounter` is a fresh UUID unique within this node. Get
these right and Coalesce resolves lineage; get them wrong and validate reports
`sourceNodeMissing` or `dataTypeMismatch`.

`sourceMapping.aliases` maps the upstream node *name* -> its node `id`, and
`join.joinCondition` references it with `{{ ref('<LOCATION>', '<NODE>') }}`.

## Node-type conventions

See `references/node_templates.md` for complete YAML skeletons. The
repo-specific config blocks are:

- **Stage** — `materializationType: table`; config `insertStrategy: INSERT`,
  `truncateBefore: true`, `testsEnabled: true`; `enabledColumnTestIDs:
  [hasNull, isDistinct]` with `hasNull`/`isDistinct` applied to the business
  key. All source columns passed through 1:1.
- **Dimension** — `materializationType: table`; config `insertStrategy:
  "UNION DISTINCT"`, `selectDistinct: false`, `groupByAll: false`,
  `truncateBefore: false`, `orderby: false`, `orderbycolumn.items: [{}]`.
  First column is the **surrogate key** `DIM_<NAME>_KEY` (`dataType: NUMBER`,
  `isSurrogateKey: true`, **empty** source refs — the node type auto-generates
  `NUMBER identity`). Exactly one **business key** column (`isBusinessKey:
  true`), also listed under the required `businessKeyColumns:`. Then all
  attributes 1:1, then `SYSTEM_CREATE_DATE`/`SYSTEM_UPDATE_DATE` (TIMESTAMP,
  `isSystemCreateDate`/`isSystemUpdateDate`, empty refs, transform
  `CAST(CURRENT_TIMESTAMP AS TIMESTAMP)`).
- **Fact** — `materializationType: table`; config `postSQL`/`preSQL`/
  `testsEnabled: true`. Natural key marked `isBusinessKey: true`; measures and
  attributes mapped 1:1 from the stage; same two `SYSTEM_*` date columns as the
  dimension. No surrogate key.
- **View** (PLATINUM `V_` and SILVER role-playing) —
  `materializationType: view`; config `insertStrategy: UNION`,
  `selectDistinct: false`. Every upstream column passed through 1:1, including
  surrogate key and system dates.

Role-playing views (e.g. `PICKUP_LOCATION`, `DROPOFF_LOCATION` over a single
location dimension/stage) live in SILVER and follow the View pattern with a
role prefix instead of `V_`.

## Guardrails

- **V1 only.** Every node here is `fileVersion: 1`, `type: sql`,
  `sqlType: <...>`. Do **not** create V2 `.sql` nodes unless the user asks.
- **Don't edit `nodeTypes/`** to fix drift — those are copied from the Node
  Library by a human; report drift, let the user decide.
- This is a demo workspace that gets reset; work locally with `coa`, keep it
  quick, and don't push without the user resolving the GitHub credential (the
  remote authenticates as a non-writer by default).
