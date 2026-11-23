---
name: data-modeling
description: Use when designing or documenting a data model in the Coalesce Data Modeler app (model/ folder of a Coalesce Transform workspace) — source data models, Data Vault models and spine diagrams, star schemas / data marts, 3NF or any other model; tagging columns with roles and tags, business labels, relations, planned (not yet built) nodes and planned changes, model definitions and DBML export. Not for building the Coalesce nodes themselves (use the coalesce-* skills for that).
---

# Data modeling with the Coalesce Data Modeler

The Data Modeler app (`apps/<data-modeler>/` in a Coalesce Transform workspace) draws models over
the workspace's nodes. Everything it knows beyond the nodes lives in **`model/`**, which `coa`
never reads:

| File | Holds |
|---|---|
| `model/tags.yml` | Vocabulary: the 8 fixed **roles** and free-form **tags** (label, emoji, colour) |
| `model/nodes/<LOC>-<NAME>.yml` | Per node: business label, per-column label/roles/tags, outgoing **relations**, and `planned:` designs |
| `model/models/<slug>.yml` | A model: name, type, which node types/locations it includes, saved layouts |
| `model/models/<slug>.dbml` | Generated export of a model — never edit, regenerate |

Node metadata is **shared**: a node's labels, roles and relations show in every model that includes
it. A model is only a filter (`include`) plus a layout.

Paths below are relative to this skill's folder (`skills/data-modeling/` inside the app).

## Workflow

1. **Survey.** Read the workspace: `nodes/` (every node and column), `locations.yml`, the node
   types (`nodeTypes/*/definition.yml` and `.coa/cache/packages/*/nodeTypes/*/definition.yml` —
   use each definition's `id`, e.g. `Data-Vault:::6`, `Dimension`, `"357"`), and whatever already
   exists in `model/`. Run `node scripts/check-model.js` to see the current state.
2. **Understand the data** before tagging: grain of each node, natural keys, foreign keys,
   codes, measures, PII. Read descriptions; when the warehouse is reachable, profile key
   uniqueness rather than trusting names. Note anomalies (wrong data types, nullable keys) for the
   user instead of silently modelling around them.
3. **Design** with the recipe for the model type:
   - Source model (documents what exists) → [references/source-models.md](references/source-models.md)
   - Data Vault, raw/business vault, spine diagram → [references/data-vault.md](references/data-vault.md)
   - Star schema, data mart, other (3NF, conceptual) → [references/dimensional-and-other.md](references/dimensional-and-other.md)
4. **Write a spec and apply it.** Describe the model in a compact YAML spec (names only, no ids)
   and run `node scripts/apply-spec.js <spec.yml>`. It resolves every node and column id from the
   workspace, merges into existing files, keeps layouts and unknown keys, and is idempotent.
   Full spec format in the script header; worked example in
   [examples/tpch-source.spec.yml](examples/tpch-source.spec.yml). Put the spec in a scratch
   folder (not in `model/`), unless the user wants it kept. Hand-editing `model/` is fine for small
   changes — see [references/file-format.md](references/file-format.md).
5. **Check and export.** `node scripts/check-model.js --write-dbml` validates every file against
   the workspace (ids, roles/tags in the vocabulary, relation targets and columns, node type ids,
   `derivedFrom` references, missing business keys) and regenerates each model's DBML with the
   app's own generator. Fix every ERROR; read every warning.
6. **Hand over.** Tell the user which model to open in the app (Data model selector). Layout is
   automatic: leave `layout: {}` — the app places nodes without a position when the model opens,
   and saves positions when the user saves. Report what you decided and what is uncertain.

## Rules that are easy to get wrong

- **Roles are fixed** — exactly `businessKeyPart`, `unitOfWorkMember`, `dependentChildKey`,
  `drivingKey`, `changeTracking`, `systemAudit`, `descriptive`, `ignore`. Never invent a role; add
  a **tag** instead (tags must be declared in `model/tags.yml` first — `apply-spec.js` does that
  from the spec's `tags:`). Meanings are in [references/file-format.md](references/file-format.md).
- `businessKeyPart` **is the DBML primary key**: one column → `pk`, several → composite pk index.
  Put it on the column set that identifies a row (the grain), nothing else.
- **Relations point from the referencing (many) side to the referenced (one) side**, stored in the
  referencing node's file, `cardinality: many-to-one`. Composite foreign keys are one relation with
  several column pairs, in matching order.
- **Ids:** built nodes and their columns carry the real ids from `nodes/` (on V2 `.sql` nodes the
  column id is the column name). **Planned** nodes and their columns carry **no** `id` — they are
  matched by location + name and column name.
- **Model type text drives auto layout:** a type matching star/dimensional/kimball/data mart gets
  the star layout, data vault/raw vault/business vault/DV the spine layout, anything else the
  layered (lineage-like) layout. Use the presets `Source`, `Star Schema`, `3NF`, `Data Vault`.
- **An `include` with neither node types nor locations shows nothing.** Both lists set means a node
  must match both.
- **Don't touch `nodes/`** from this skill. Proposing nodes = planned metadata; building them is a
  separate step with the `coalesce-*` skills (create the real node with the same location, name and
  column names — the app then upgrades the planned file in place, keeping the design as `design:`).
- The `model/nodes` file name must equal `node.location-node.name`; one file per node.
- Never edit the `.dbml` files, and don't hand-write layouts.

## Scripts

| Script | Use |
|---|---|
| `scripts/apply-spec.js <spec> [--dry-run] [--workspace <dir>]` | Write/merge model metadata from a names-only spec |
| `scripts/check-model.js [--write-dbml] [--model <slug>] [--json] [--workspace <dir>]` | Validate `model/`; regenerate DBML; exit 1 on errors |

Both reuse the app's own modules (`yaml.js`, `workspace.js`, `planned.js`, `dbml.js`), so what they
write and check is exactly what the app reads. Node only, zero dependencies. The workspace is found
from `--workspace`, `$WORKSPACE_DIR`, or the nearest parent of the current directory with `data.yml`.
