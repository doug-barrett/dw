---
name: coalesce-rename-node-cascade
description: Rename a Coalesce node and cascade the new name through every downstream ref(), job selector, and subgraph selector, with quote-agnostic matching and validation.
---
<!-- coalesce-node-managed: true -->

> **Prerequisite — load `coalesce-pipelines` first.** If you have not already
> loaded the `coalesce-pipelines` skill in this session, load it now, read its
> "Orient first" step, core `coa` loop, and Rules, then return here. This skill
> assumes those invariants (bare `@id`/`@nodeType` first lines, `fileVersion: 2`
> node types, one-node-at-a-time validate → dry-run → create loop) are already
> in context.

Renaming a node means renaming its file AND updating every reference to it.
A node is referenced in three places: downstream `ref()` macros, job
`includeSelector`/`excludeSelector` strings, and subgraph `steps` selector
strings. Miss one and you leave a dangling reference. Authoritative shapes
come from the `coa` CLI — `coa describe sql-format`, `coa describe selectors`,
`coa describe schema job`, and `coa describe schema subgraph` — NOT from the
bundled example files, which use legacy/stale shapes (see the warning in the
Job/Subgraph steps below). Treat `coa describe <topic>` and
`coa describe schema <type>` as the source of truth, and drive the work with
the core loop: define the edits -> `coa validate` -> verify -> iterate.

GUARDRAIL: renaming the requested node and editing its downstream node files
is IN SCOPE without asking. Jobs (`jobs/*`) and subgraphs (`subgraphs/*`) are
SHARED config — editing them can silently affect unrelated nodes. Order
matters: apply the in-scope edits (file move + `ref()` updates) FIRST, then
present the job/subgraph edits the rename requires and CONFIRM with the user
before applying them. Never hold in-scope edits hostage to a shared-config
confirmation. If the user's request explicitly covers every reference (e.g.
"update everything in this workspace that references it"), that constitutes
approval for the job/subgraph edits the rename requires — apply them without
asking again. (See `coa describe workflow`.)

## Steps

1. Read `.claude/workspace-context.json` (if present) to find the node's
   location, name, and downstream dependents; otherwise use
   `coa create -d <dir> --list-nodes` and a ref search. Names are
   UPPER_SNAKE_CASE and unique.

2. Read the current node file to confirm its contents and `@nodeType`.

3. Check the NEW name is free: no `nodes/<LOCATION>-<NEW_NAME>.sql` AND no
   `nodes/<LOCATION>-<NEW_NAME>.yml` may already exist (`.sql` and `.yml` for
   the same location+name cannot coexist; `nodes/` has no subdirectories).
   Abort if either exists.
   Also check for SAME-NAMED nodes at OTHER locations: list every
   `nodes/*-<OLD_NAME>.sql` / `.yml` besides the node being renamed. Names are
   only unique per location+name, so these can legitimately coexist (only
   `@id` is unique workspace-wide). If any exist, note them now — they change
   how the selector updates (steps 6–8) and the final sweep (step 9) apply.

4. Move the file: `nodes/<LOCATION>-<OLD_NAME>.sql` ->
   `nodes/<LOCATION>-<NEW_NAME>.sql` (or `.yml` for a V1 node). The filename —
   not any annotation — sets location+name. Leave `@id` and `@nodeType`
   UNCHANGED; never reuse or modify an existing `@id`. A bare `@location`
   annotation is ignored, so there is nothing to edit inside the file for the
   rename itself.

5. Update downstream `ref()` calls. Search every dependent node file for the
   node referenced by location+name and rewrite the NAME argument, preserving
   the existing quote style. Notes:
   - `ref()` takes BOTH args (location, name); there is no name-only or
     single-arg form, and the location arg never changes on a rename.
   - Quotes are QUOTE-AGNOSTIC: refs may be single- or double-quoted (the
     bundled repo uses single quotes; the spec examples show double quotes —
     both resolve). Match either style and KEEP whatever style the file uses.
     A literal search for only one quote style will miss the others and
     silently leave references dangling — the exact failure this skill exists
     to prevent.
   - Match with a quote-agnostic pattern, e.g. (regex):
     `ref(_link|_no_link)?\(\s*['"]<LOCATION>['"]\s*,\s*['"]<OLD_NAME>['"]\s*\)`
     and rewrite the name to `<NEW_NAME>` while leaving the surrounding quotes
     and whitespace intact.
   - This covers `ref()`, `ref_link()` (edge, no SQL), and `ref_no_link()`
     (no edge). Matching is case-insensitive, so search case-insensitively for
     the old name.

6. Update jobs (`jobs/*.yml`). Per `coa describe schema job`, a job has NO
   steps array — its node selection lives in two string fields,
   `includeSelector` and `excludeSelector`. Update any exact name token
   `{ <OLD_NAME> }` / `{ name: "<OLD_NAME>" }` in those strings to the new
   name. (Schema: `{ id (INTEGER string), type: "Job", fileVersion: 1, name,
   includeSelector, excludeSelector }`.)
   CAUTION — same name, different location: selectors match by NAME across
   ALL locations (`location:` is a separate filter combined with AND — see
   `coa describe selectors`). If step 3 found a same-named node at another
   location, a name-only token is AMBIGUOUS: rewriting it drops the other
   node from the selection; leaving it drops the renamed node. Do NOT rewrite
   it silently — report it for the user to decide (step 8).
   WARNING — stale shape: the bundled example job(s) currently use a
   `steps: [{ selector }]` array, which is NOT the schema shape and FAILS
   `coa validate`. If the target job is in that legacy form it has no
   `includeSelector` field to edit; do not invent one — flag the stale shape
   to the user (the job file itself likely needs migrating first) before
   touching it.

7. Update subgraphs (`subgraphs/*.yml`). Per `coa describe schema subgraph`, a
   subgraph stores selector STRINGS in a `steps` array (NOT a `nodes` array).
   Update any exact name token in each `steps` entry. The same-name/different-
   location caution from step 6 applies to `steps` selectors too. (Schema:
   `{ id, type: "Subgraph", fileVersion: 1, name, steps: [selector strings] }`.)
   WARNING — stale shape: the bundled example subgraphs currently use a
   `nodes:` list (bare name strings), which is NOT the schema shape and FAILS
   `coa validate`. If the target subgraph is in that legacy form, update the
   listed name and flag the stale shape (the subgraph file likely needs
   migrating to `steps:` first) before relying on it.

8. Report pattern/glob selectors that may be SILENTLY affected. Selector
   values support minimatch globs, so a rename can change which nodes a glob
   matches even though no literal old name appears. Scan every job selector and
   subgraph step for glob patterns (e.g. `{ name: "NATION_*" }`,
   `{ name: "?RDERS" }`, `{ location: "S*" }`) and list each one whose match
   set could shift when `<OLD_NAME>` becomes `<NEW_NAME>`. Also note lineage
   operators: `{ NODE }+` = node AND its downstream successors; `+{ NODE }` =
   node AND its upstream predecessors. These resolve by name and must be
   reported if they reference the old name. If step 3 found same-named nodes
   at other locations, include in this report every name-only selector
   matching the old name, left un-rewritten per steps 6–7, and ask the user
   which node(s) each selector should keep targeting.

9. MANDATORY final sweep — search for the bare old identifier. Run BOTH a
   repo-wide, case-insensitive CONTENT search for `<OLD_NAME>` alone (no
   quotes, no `ref()` shape, no path restriction) AND a FILENAME search —
   `grep -r` matches file contents only, never file names, so a stale file
   still named after the old node (e.g. a forgotten `.yml` sibling) is
   invisible to the content search:

   ```
   grep -ri "<OLD_NAME>" .
   git ls-files | grep -i "<OLD_NAME>"
   ```

   First discard intentional matches from either output: hits where the
   matched text is a DIFFERENT identifier that merely contains the old name
   (e.g. the new name containing the old one, or an unrelated node like
   `<OLD_NAME>_ARCHIVE`). Then:
   - If step 3 found NO same-named node at another location, the rename is
     NOT complete until both searches return zero remaining hits.
   - If a same-named node DOES exist, zero hits is the WRONG target: that
     node's own filename (filename search), its location-qualified `ref()`s
     (content search), and any name-only selectors deliberately left for the
     user (step 8) are EXPECTED residue. Account for every remaining hit as
     one of those — any hit you cannot attribute to the other node is a
     missed reference. NEVER edit references to the other node just to force
     the count to zero.

   The shaped patterns in the earlier steps cannot match every reference
   form — e.g. `{ name: "<OLD_NAME>" }` inside a subgraph `steps` selector
   string — and `coa validate` reports 0 errors when a selector names a
   nonexistent node, so a green validate does NOT prove the sweep was
   complete. This crude search catches whatever the shaped searches missed.

10. Confirm no broken references remain by running validate:

   ```
   coa validate -d <workspace-dir>
   coa validate -d <workspace-dir> --json   # machine-readable
   ```

   Schema validation always runs on all files, but the broken-reference proof
   you rely on comes from the 15 offline GRAPH SCANNERS (broken column
   references, duplicate names, missing node types, etc.), and those require a
   `workspace.yml` (it maps locations so refs can resolve). If `workspace.yml`
   is missing, validate reports the graph scanners as "setup failed" and you
   get schema validation ONLY — not the reference scan. Bootstrap it with
   `coa doctor --fix` (a shared-config change — ask the user first), then
   re-run validate. If validate reports a broken reference or duplicate name,
   fix it and re-run until clean.

   NOTE: the bundled example-repository currently FAILS `coa validate` (legacy
   job/subgraph/location/env/nodeType shapes, missing data.yml). Use
   `coa describe schema <type>` as ground truth, not the example files.

10. Prove the renamed node still renders, on BOTH halves:

    ```
    coa create -d <workspace-dir> --include "{ <NEW_NAME> }+" --dry-run --verbose
    coa run    -d <workspace-dir> --include "{ <NEW_NAME> }+" --dry-run --verbose
    ```

    Validate alone is not enough, and neither is the create dry-run: run
    templates gate their DML on `config`, so empty run SQL is possible while
    the DDL looks fine. Include the `+` so downstream nodes render too.

## Cascade checklist

- [ ] File moved; `@id` and `@nodeType` untouched; new name collision-free.
- [ ] All downstream `ref` calls rewritten quote-AGNOSTICALLY (single OR
      double quotes matched; original quote style preserved; both args kept).
      Covers `ref` / `ref_link` / `ref_no_link`.
- [ ] Job `includeSelector` / `excludeSelector` strings updated (or stale
      `steps:` shape flagged for migration).
- [ ] Subgraph `steps` selector strings updated (or stale `nodes:` shape
      flagged for migration).
- [ ] Glob/pattern and lineage-operator selectors reviewed and reported.
- [ ] Same-named nodes at other locations checked (step 3); if any exist,
      name-only selectors were reported for user decision, NOT silently
      rewritten.
- [ ] Final sweep: repo-wide case-insensitive CONTENT grep AND FILENAME
      search (`git ls-files`) for the bare old name return ZERO hits after
      discarding different-identifier substring matches — or, when a
      same-named node exists at another location, every remaining hit is
      accounted to that node (a green `coa validate` does not prove this —
      it passes even when a selector names a nonexistent node).
- [ ] `coa validate` passes with no broken references (graph scanners actually
      ran — `workspace.yml` present, bootstrap with `coa doctor --fix` if not).
- [ ] `coa create --dry-run --verbose` AND `coa run --dry-run --verbose` both
      render non-empty SQL for `{ <NEW_NAME> }+`.
