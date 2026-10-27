---
name: dw-datavault
description: >-
  Build and extend a raw Data Vault 2.0 over BRONZE in the dw (NY taxi) demo
  repo using the Scalefree datavault4coalesce package (alias DV). Use this
  skill whenever the user wants to add a hub, link, or satellite; build a DV
  Stage; vault a BRONZE table; add an entity to the raw vault; or asks how DV
  nodes are authored, named, wired, hashed, or verified in this workspace.
  Trigger on "data vault", "raw vault", "hub/link/satellite", "DV stage",
  "hash key", "hashdiff", "SATV0/SATV1", or naming a BRONZE table with "vault
  it" / "add the hub and sat". This is the V1-YAML + coa CLI path for THIS
  repo; it is not the MCP app-authoring coalesce-data-vault skill.
---

# dw Data Vault 2.0 development

This repo (`dw`) carries a raw Data Vault 2.0 subset over its BRONZE layer,
built with the Scalefree **datavault4coalesce** package (alias `DV`, installed
via `packages/DV.yml`). Every DV node is a **V1 YAML** file under `nodes/`,
named `SILVER-<NAME>.yml`. This skill captures the exact conventions the built
vault already follows, so new entities look identical to what's there.

Before running `coa`, read `~/.coalesce/desktop/AGENTS.md` for the current CLI
entrypoint. If Coalesce Desktop is running it publishes `agent.json` and a shim
at `~/.coalesce/desktop/coa` — prefer that. Otherwise use `coa` from PATH.

The companion skill `dw-pipeline-development` covers the medallion
Stage/Dim/Fact/View pipelines; this one is only the Data Vault layer. The
user-level `coalesce-data-vault` skill covers the Coalesce **MCP app** build
path (`create_workspace_node_from_predecessor`, `replace_workspace_node_columns`)
— a different workflow that fills in UUIDs for you. Here we author YAML files
directly, so every hash input and column reference is wired by hand (or by the
generator below).

## The layer map

All DV nodes live in **SILVER** (`DOUG_DB.DEV_SILVER`), sourced from BRONZE.

| Layer | sqlType | Naming | Materialization | Holds |
|-------|---------|--------|-----------------|-------|
| DV Stage | `DV:::4` | `DVSTG_<ENTITY>` | view | source cols + LDTS/RSRC + all hash columns |
| Hub | `DV:::6` | `HUB_<ENTITY>` | table | H key + business key + LDTS/RSRC |
| Link | `DV:::7` | `LINK_<REL>` | table | L key + participating H keys + business keys + LDTS/RSRC |
| Sat V0 | `DV:::8` | `SATV0_<ENTITY>` | table | H key + descriptive attrs + LDTS/RSRC + S hashdiff |
| Sat V1 | `DV:::9` | `SATV1_<ENTITY>` | view | V0 passthrough + LEDTS + IS_CURRENT end-dating |

Hash column names: `H_<ENTITY>_KEY` (hub hash), `L_<REL>_KEY` (link hash),
`S_<ENTITY>_HASH` (satellite change hash / hashdiff).

## What each source column becomes

For one source table:

- **business key** → the hub's business key, and the input to `H_<ENTITY>_KEY`.
- **foreign key(s)** → each gets its own `H_<HUBSHORT>_KEY` hash in the stage and
  joins the link. FK columns go into the **link, not the satellite**.
- **everything else** → descriptive attributes in the satellite, hashed together
  into `S_<ENTITY>_HASH`.

A plain dimension entity (no FK) produces **Stage → Hub → SatV0 → SatV1** (no
link). An entity with relationships adds one **Link** over all its FKs.

**Role-playing** is expressed by the hub short name differing from the column:
`PAYMENT_TYPE_ID → H_PAYMENT_KEY`, `PU_LOCATION_ID → H_PU_LOCATION_KEY`,
`DO_LOCATION_ID → H_DO_LOCATION_KEY`. A single transaction table gets ONE
unit-of-work link over all its FKs (e.g. `LINK_TRIP_VENDOR_PAYMENT_RATE_LOCATION`),
not one link per FK.

## Workflow

1. **Scaffold the BRONZE source** (if not already present) — never hand-write a
   Source. See `dw-pipeline-development` for `coa sources add`.

2. **Generate the DV chain** with the bundled generator `scripts/gen_dv.py`. It
   reads the BRONZE source YAML, auto-discovers every column's `columnCounter`
   and `dataType`, mints fresh UUIDs, and wires all hash/ref blocks correctly:

   ```bash
   # plain dimension entity (hub + satellite, no link)
   python3 scripts/gen_dv.py nodes/BRONZE-VENDOR.yml --entity VENDOR --business-key VENDOR_ID

   # entity with one relationship (adds a link)
   python3 scripts/gen_dv.py nodes/BRONZE-DRIVERS.yml --entity DRIVER \
       --business-key DRIVER_ID --fk VENDOR_ID:VENDOR --link-name DRIVER_VENDOR

   # transaction / unit-of-work link over several FKs (role-playing)
   python3 scripts/gen_dv.py nodes/BRONZE-YELLOW_CAB_TRIPS.yml --entity TRIP \
       --business-key TRIP_ID \
       --fk VENDOR_ID:VENDOR --fk PAYMENT_TYPE_ID:PAYMENT --fk RATE_CODE_ID:RATE \
       --fk PU_LOCATION_ID:PU_LOCATION --fk DO_LOCATION_ID:DO_LOCATION \
       --link-name TRIP_VENDOR_PAYMENT_RATE_LOCATION
   ```

   `--fk COLUMN:HUBSHORT` is repeatable; any `--fk` emits a link. `--exclude COL`
   drops a source column entirely. Edit the emitted files for custom transforms,
   then re-verify. See `references/generator.md` for every flag.

3. **Verify without touching Snowflake:**
   ```bash
   coa validate
   coa create --include "{ DVSTG_<ENTITY> }+" --dry-run --verbose
   coa run    --include "{ DVSTG_<ENTITY> }+" --dry-run
   ```
   `{ DVSTG_<ENTITY> }+` means "this node and everything downstream" — one
   selector covers the whole chain. Stage and SatV1 are views, so `run` shows
   "no DML to preview — the warehouse maintains the dv:::N"; that is expected,
   not an error.

Only after a clean dry-run offer the real `coa create` (DDL) and `coa run`
(DML); those mutate the warehouse, so confirm with the user first.

## The two things that break DV authoring here

1. **Node-type selector — use `DV:::<id>`, never the bare id.** `sqlType: "4"`
   collides with this repo's local `nodeTypes/DateStage-4` and silently renders
   a date-generator CTE with NULL hashes. Correct: `DV:::4` (Stage), `DV:::6`
   (Hub), `DV:::7` (Link), `DV:::8` (Sat V0), `DV:::9` (Sat V1).

2. **Hash inputs go in a sibling `hashedColumns:` list, not `hashDetails`.** A
   hash column carries `hashDetails: {hashAlgorithm: ...}` AND a separate
   `hashedColumns:` list of `{columnCounter, name, stepCounter}` refs pointing at
   the in-stage source columns. Putting inputs under `hashDetails` renders the
   column as a literal NULL.

See `references/node_templates.md` for the exact column blocks and config flags.

## Hash algorithm (known gotcha)

The emitted nodes carry `hashDetails.hashAlgorithm: SHA1`, but **this
datavault4coalesce version does not honor the node-level setting** — the
rendered SQL uses the `"hash"` value in `packages/DV.yml` global config, which
is **MD5**. So every hash currently renders as `MD5(...)` regardless of the
node YAML. To change the algorithm for the whole vault, edit the package global
config, not the node files. (The hashes render correctly either way; only the
algorithm name differs from what the node claims.)

## Guardrails

- **V1 only.** Every DV node is `fileVersion: 1`, `type: sql`, `sqlType: DV:::<id>`.
- **Don't edit `nodeTypes/`** to fix drift — report it, let the user decide.
- `coa validate` reports a pre-existing `SYNQ_AUDIT` `storageMappingInvalid`
  error from `environments/` — it is unrelated to DV nodes and only blocks
  deploy. Filter it out before reporting your work as passing.
- This is a demo workspace that gets reset; work locally with `coa`, keep it
  quick, and don't push without the user resolving the GitHub credential.
