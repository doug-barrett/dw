# Data Modeler

A Coalesce workspace app. Model your Coalesce workspace as source models, star schemas, 3NF or Data Vault: tag columns with roles, give nodes and columns business labels, draw relations, plan nodes that are not built yet, and export one DBML file per model. Metadata is saved as YAML in `model/` in the workspace.

## Agent skill

`skills/data-modeling/` is a Claude Code skill for data modeling with this app: source models, Data Vault and spine diagrams, star schemas / data marts and other models, as planned nodes when they're not built yet. It includes `scripts/apply-spec.js` (writes `model/` from a names-only spec, resolving ids from the workspace) and `scripts/check-model.js` (validates `model/` and regenerates the DBML with the app's own generator). To use it in a workspace, link or copy the folder to `.claude/skills/data-modeling`.

## This repository

The app's source is at the top level.

To release a version: bump `version` in `package.json` and add a `CHANGELOG.md` entry.
