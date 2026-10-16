# gen_pipeline.py

Generates a full standard pipeline from a scaffolded BRONZE source, with every
`columnCounter` / `stepCounter` wired correctly. Use it instead of hand-writing
the Stage/Gold/View YAML — the cross-references are the error-prone part, and
the script makes them deterministic.

## Prerequisites

- The BRONZE source node already exists (`coa sources add --location BRONZE
  --include '<TABLE>'`).
- `PyYAML` available (it is under the repo's default Python / anaconda).

## Run

```bash
cd /Users/dougy/GIT/dw
python .claude/skills/dw-pipeline-development/scripts/gen_pipeline.py \
    nodes/BRONZE-<TABLE>.yml --flavor dim --business-key <BK_COLUMN>
```

- `--flavor dim` → emits `GOLD-DIM_<NAME>.yml` with a surrogate key + business key.
- `--flavor fact` → emits `GOLD-FCT_<NAME>.yml` with the business key, no surrogate.
- `--business-key` → the natural key column (must exist in the source).
- `--name` → override the base name (default: the source node name).

It writes three files into `nodes/`:
`SILVER-STG_<NAME>.yml`, `GOLD-DIM_<NAME>.yml` (or `GOLD-FCT_`), `PLATINUM-V_<NAME>.yml`.

## What it does and doesn't do

- Maps **all** source columns 1:1 through every layer, copying each `dataType`
  verbatim. No transforms, filters, or renames — add those by editing the
  emitted YAML (set the column's `transform:` or the node's `join.joinCondition`
  / `customSQL`).
- Adds the business-key column tests (`hasNull`, `isDistinct`) on the Stage.
- Adds `SYSTEM_CREATE_DATE` / `SYSTEM_UPDATE_DATE` on the Gold node.
- Never calls the warehouse. After generating, always:
  ```bash
  coa validate
  coa create --include "{ STG_<NAME> }+" --dry-run --verbose
  ```

## When NOT to use it

- Multi-source facts (joins across several stages), role-playing views, or
  anything needing custom SQL — generate the simple chain first, then edit, or
  hand-author from `node_templates.md`.
- V2 `.sql` nodes — this repo and skill are V1 only.
