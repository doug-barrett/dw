<!-- coalesce-node-managed: true -->
# coa CLI Reference

The `coa` CLI is the core toolset and the source of truth for working in a
Coalesce Transform repo. When unsure about a format, schema, or command, run the
relevant `coa describe` topic before guessing. Do NOT copy shapes from the
bundled example-repository — it currently FAILS `coa validate` (legacy
job/subgraph/location/env/nodeType shapes, missing `data.yml`).

## describe — built-in docs (always read-only)

- `coa describe` (overview), `coa describe concepts`, `coa describe sql-format`,
  `coa describe selectors`, `coa describe node-types`, `coa describe workflow`,
  `coa describe structure`
- These are STATIC manuals, not listings. `coa describe node-types` documents
  the node type format (folder layout, `definition.yml` fields, template
  patterns); it does not list the types this workspace has. For that, read
  `nodeTypes/` and `.coa/cache/packages/*/nodeTypes/` on disk.
- `coa describe schema <type>` — `node`, `nodeType`, `job`, `subgraph`,
  `locations`, `environment`, `macro`, `workspace`, `data`
- `coa describe command <name>` — `create`, `run`, `validate`, etc.

## Core loop (one node at a time)

Define → validate → dry-run → create → run → verify → iterate. Use `-d <repo>`
on every command (the repo root, where `data.yml`/`locations.yml`/`nodes/` live):

1. **Define** — write/edit `nodes/<LOCATION>-<NAME>.sql` (V2) or `.yml` (V1).
2. **Validate** — `coa validate -d <repo>` (add `--json` for machine output).
   Zod schema checks on every YAML file plus 15 offline graph scanners (broken
   refs, missing types, duplicate names, bad storage locations). No warehouse
   needed. `--include` scopes the graph scanners; schema validation always runs
   on all files. The graph scanners require a `workspace.yml` (it maps locations
   so refs resolve) — without it they report "setup failed" and you get schema
   validation only.
3. **Dry-run** — `coa create -d <repo> --include "{ NODE }" --dry-run`
   (add `--verbose` to see the generated SQL, `--json` for machine output).
   Confirms the DDL renders and columns are populated. Then
   `coa run -d <repo> --include "{ NODE }" --dry-run --verbose` for the DML —
   both are required. A node type's run template gates its DML on `config`
   values, so a node with an empty/incomplete `config` renders ZERO run SQL
   while `create --dry-run` still looks perfect.
4. **Create** — `coa create -d <repo> --include "{ NODE }"` — executes the DDL.
5. **Run** — `coa run -d <repo> --include "{ NODE }"` — executes the DML.
6. **Verify** — query the table (warehouse client or Coalesce web UI).
7. **Iterate** — move to the next downstream node.

`coa create -d <dir> --list-nodes` (or `coa run ... --list-nodes`) enumerates
nodes and IDs.

In a cold workspace (no `nodes/`, or `--list-nodes` empty) the loop starts one
step earlier: `coa sources list -d <dir> [--profile <p>]` lists the warehouse
tables available per location, and `coa sources add -d <dir>` scaffolds Source
nodes from them (always generate Source nodes this way, never by hand).

## Local development vs cloud deploy

`coa create` and `coa run` execute SQL DIRECTLY against the warehouse using
`~/.coa/config` credentials. This is LOCAL DEVELOPMENT, not deployment — never
call it "deploy" or "publish". Genuine plan/deploy is a separate process
against a deployed environment: git push, then plan/deploy in the Coalesce web
UI or CI (it diffs the pushed Git state against the deployed environment). The
CLI's Cloud Operations commands (`coa plan`, `coa deploy`, `coa refresh`, …)
drive that same cloud process, are NOT part of the local loop, and always
require explicit user approval. Their flags, the committed
`environments/<NAME>.yml` mapping file `coa plan` depends on, output shapes,
and failure modes are documented in the coalesce-deploy skill.

## Selectors (`--include` / `--exclude`)

Case-insensitive; minimatch globs supported. Quote selectors; escape inner
quotes in the shell (e.g. `--include "{ location: \"STG\" }"`).

- `{ NAME }`, `{ name: "X" }`, `{ location: "STG" }`, `{ nodeType: "Work" }`,
  `{ subgraph: "G" }`, `{ nodeID: "123" }`, `{ * }`
- Globs: `{ name: "STG_*" }`, `{ name: "?RDERS" }`, `{ location: "S*" }`
- Combine: OR via `||` / `OR` (union); AND via `,` / space / `AND`
  (intersection), e.g. `{ name: "ORDERS", location: "SRC" }`.
- **Lineage operators** (do not get these backwards):
  - `{ NODE }+` — the node AND all downstream successors (blast radius).
  - `+{ NODE }` — the node AND all upstream predecessors.

## init — bootstrap a workspace

`coa init -d <dir>` writes `~/.coa/config` (token, environmentID, warehouse
credentials), scaffolds `data.yml` / `locations.yml` / `workspace.yml` /
`.gitignore`, optionally hydrates packages, and verifies via doctor. Phases are
skipped silently when already satisfied. ALWAYS use `--non-interactive` (plus
per-field flags like `--token`, `--environmentID`, `--snowflakeAccount`) so it
fails fast instead of prompting. `init` and `coa profile create` share one set
of per-field warehouse flags, so `--platformKind Snowflake|Databricks|BigQuery`
plus that platform's flags works on either. `--skip-install` / `--skip-doctor` /
`--force` are available.

Without `--profile`, init writes into whichever profile the chain below already
resolves to (a bound workspace keeps its binding). With `--profile <name>` it
writes into THAT section and binds the workspace to it — the binding is written
after the credential phases, so a failed init leaves no new binding. It CAN
leave a half-written profile: phase 1 stores the token before phase 2 tests the
warehouse. `coa init --profile <name>` is also how you rewrite an existing
profile's credentials, since `coa profile create` refuses a name that already
exists.

init writes credentials and shared config — ask the user before running it.

## doctor — diagnose config/auth/warehouse

`coa doctor -d <dir> [--profile <p>]` checks project files (`data.yml`,
`locations.yml`, `workspace.yml`), cloud auth (`~/.coa/config`), connection
credentials, and live warehouse connectivity. `--json` for machine-readable
output. doctor (without `--fix`) is non-mutating but DOES reach the cloud and
live warehouse with your token — treat it as low-risk read-only. `--fix`
repairs what it can (bootstrap a missing `workspace.yml`, update `.gitignore`)
— that mutates shared config, so ask the user first.

## profile — manage `~/.coa/config` profiles

Every section of `~/.coa/config` is a profile. Manage them with the CLI; NEVER
hand-edit the ini file. Every subcommand accepts the global `--config <path>`
and `--json`.

- `coa profile list [-d <dir>]` — every section with its platform and whether it
  carries cloud credentials, plus which profile a command run in `-d` would use
  and why. Each row shows that section's OWN fields, so a profile that inherits
  its platform or token from `[default]` shows `-` in those columns.
- `coa profile show <name>` — one section's fields AND the effective profile
  (that section layered over `[default]`). Secrets redacted in both. No `-d`.
- `coa profile use <name> [-d <dir>]` — bind this workspace to a profile by
  writing `profile: <name>` into its `workspace.yml`, so local commands in that
  directory use it without `--profile`.
- `coa profile unset [-d <dir>]` — remove the binding; selection falls back
  through the chain below.
- `coa profile create <name> <per-field flags>` — runs a LIVE connection test
  and writes the new section only if it passes. Warehouse half only; the cloud
  half is `set-cloud`'s job. Refuses a name the config already has (rewrite one
  with `coa init --profile <name>`). No `-d`.
- `coa profile set-cloud <name> --token <t> [--domain <d>] [--environmentID
  <id>] [-d <dir>]` — write the cloud half into a section, leaving the rest of
  the file as it was.
- `coa profile delete <name> [-d <dir>]` — refuses `default`. Appends the
  section to `<config>.backup` BEFORE removing it (a delete that cannot be
  archived does not happen), then clears the binding in `-d <dir>` if it named
  that profile — that ONE workspace only; other workspaces bound to it are left
  dangling.
- `coa profile rename <old> <new> [-d <dir>]` — refuses `default`. Rewrites the
  binding in `-d <dir>` if it named `<old>`. Writes NO backup, and does NOT
  rewrite a `[default] profile=<old>` key — that reference is left dangling and
  falls through the chain.

Pass `--non-interactive` to `create` and `set-cloud` so a missing value fails
instead of prompting — they fail differently. `create` (like `init`) aborts with
`Required value missing in --non-interactive mode: <field>`; `set-cloud` reports
`A token is required. Pass --token, or drop --non-interactive to be prompted for
it.` `init` takes the flag too; no other command does.

Profile **names** are validated by round-tripping `[name]` through the ini
parser, before any prompt and before any connection is dialed. Letters, digits,
`-`, `_`, spaces, `@` and parentheses are fine. Refused: `.`, `;`, `#`, `]`,
line breaks, a leading or trailing space, and the empty name.

`set-cloud`'s domain, highest precedence first: `--domain`, the section's own
stored `domain`, one inherited from `[default]`, then the built-in default. It
reports which one it used (`domain set to …` / `unchanged` / `inherited from
[default]` / `defaulted`) and writes a `domain` key only for `set` and
`defaulted` — a token-only `set-cloud` never repoints an existing domain.

```
coa profile create staging --platformKind Snowflake      # prompts for the rest
coa profile create dbx --non-interactive --platformKind Databricks \
  --databricksHost <h> --databricksPath <p> --databricksToken <t>
coa profile create bq --non-interactive --platformKind BigQuery \
  --bigQueryServiceAccountKey ./key.json
coa profile set-cloud dbx --non-interactive --token <t> --environmentID 42
coa profile use dbx -d ./my-workspace
```

## install — hydrate packages

`coa install -d <dir> [--profile <p>]` fetches package contents from the
Coalesce cloud API and caches them locally so `create`/`run` can render
package-provided node types. REQUIRED for any workspace that uses packages:
run it after init or after pulling a repo that uses packages. It only fetches
and caches (no shared-config mutation), so it is safe to run without asking.
It hydrates ONLY packages already declared under `packages/`: with no
declaration it is a no-op that prints "No packages to install." `coa init`
writes the base package's declaration, so if `packages/` is absent,
re-running `coa init` (or asking the user to) is the fix. Additional
Marketplace packages are declared per the coalesce-install-package skill
(registry lookup for the release ID, then `packages/<alias>.yml`) — never
improvise the declaration or other shared config.
This is how the base node types package for the platform (declared by
`coa init` in `packages/base-node-types.yml`) becomes usable — it is the fix
for "no V2 node type available", never hand-writing one. It materializes each
package type as a READ-ONLY file tree at
`.coa/cache/packages/<alias>/nodeTypes/<Name>-<id>/` (definition.yml plus
`create.sql.j2` / `run.sql.j2`), and every materialized `definition.yml`
carries the resolvable `<alias>:::<id>` id to put in `@nodeType()`. Node type
discovery is file-system based: read that tree and `nodeTypes/`. The tree is
derived — `coa install` regenerates it, so never edit it.

## Credentials

Platform credentials, `token`, `domain`, and `environmentID` live in
`~/.coa/config` (INI; every section is a profile, selected via `--profile`;
override the file path with the global `--config <path>`). Manage sections with
`coa profile` — never by editing the ini.

Profile resolution, highest precedence first:

1. `--profile <name>` on the command.
2. The workspace's binding — `profile: <name>` in its `workspace.yml`, written
   by `coa profile use <name> -d <dir>` or by `coa init --profile <name>`.
3. The config's own `[default] profile=` key.
4. `default`.

**Only the commands that act on a workspace directory see step 2**: `run`,
`create`, `sources`, `install`, `serve`, `doctor`, `init`, `auth warehouse
login` (it takes `-d/--dir` for exactly this), and `coa profile` itself. The
Cloud Operations commands (`deploy`, `plan`, `refresh`, `rerun`, `cancel`,
`runs`, …) deliberately do NOT read the binding — they resolve from flags
alone, so pass `--profile` on those. `coa validate` reads no profile at all and
needs no warehouse.

**Check the binding before reaching for `--profile`.** Run `coa profile list -d
<dir>` first: it names the profiles that exist and which one that directory
resolves to. If the workspace is already bound, run local commands WITHOUT
`--profile` — the flag outranks the binding, so passing one out of habit
silently overrides the profile the user chose for that workspace. Pass
`--profile <name>` when nothing is bound, and on every cloud command.

`coa doctor` reports the same answer on its header line —
`coa <version> | platform: snowflake | profile: prod (workspace.yml)` — where
the parenthetical is one of `--profile flag`, `workspace.yml`, `config default
key`, `default`. A named profile inherits any field it omits from `[default]`;
`coa profile show <name>` prints that effective, inherited view.

Per-workspace bindings are how several workspaces on different platforms coexist
on one machine, so the platform is checked up front. `coa profile use` refuses a
profile whose platform disagrees with the workspace, as does `coa init`:

- No `data.yml` at all — any platform is allowed (a scaffolding `coa init` then
  records the one it configured).
- `data.yml` present but recording no `platformKind` (or one coa does not
  recognize) — the workspace counts as Snowflake.
- `data.yml` naming a platform — that platform and only that one. `coa init`
  refuses rather than rewriting a platform already recorded there.

A profile's platform is its declared `platformKind`, else the one implied by
whichever auth-type field it carries — `snowflakeAuthType`,
`databricksAuthType`, `bigQueryAuthType`, and only those, so a section holding
just `snowflakeAccount` reads as having no platform at all. The check reads the
EFFECTIVE profile (the section layered over `[default]`), so a section with no
platform of its own inherits `[default]`'s — which is why `coa profile list` can
print `-` in the PLATFORM column for a profile that `coa profile use` then
reports a platform for.
The mismatch reads `Profile "dbx" is for databricks, but this is a snowflake
workspace.` — at bind time from `use`/`init`, at load time from `run`/`create`.
Binding a profile with no warehouse credentials of its own or inherited succeeds
with a warning; local execution fails until they are added.

Supported: Snowflake (`Basic`, `KeyPair`, `OAuth`), Databricks (`Token`,
`OAuthM2M`), BigQuery (`ServiceAccount`, `ApplicationDefault`). Every field has
a CLI flag, and `coa init` and `coa profile create` share one set of them, so
`--platformKind <Snowflake|Databricks|BigQuery>` plus that platform's flags
works on either. Snowflake `OAuth` is the exception to "credentials live in the
config": the profile stores `snowflakeAuthType=OAuth` (plus the optional
`--snowflakeOAuthClientID` / `--snowflakeOAuthClientSecret` /
`--snowflakeOAuthRedirectUri`), and the tokens come from `coa auth warehouse
login -d <dir>`, a browser flow that caches them outside the config. It refuses
any profile whose auth type is not `OAuth`.

Beyond the profile binding, `workspace.yml` holds only local storage mappings
(location → database/schema) and runtime parameters — never credentials. NEVER
put secrets in repo files.

## Config and profile failure modes

- **A value of literally `true`, `false`, or `null`** cannot live in the config
  — the ini parser reads it back as a boolean/null, not a string. A write is
  refused whole (`Refusing to change <path>: the edit would not read back as
  intended, so nothing was written`), and a hand-edited one aborts commands with
  `Expected profile <p> field <f> to be a string, but it is of type boolean`.
  `coa profile list` still renders, but silently drops that field.
- **A binding or `[default] profile=` naming a profile that is gone** fails
  every command that reads credentials: `Unable to find profile <name>` from
  `run`/`create`, `profile "<name>" not found. Available: …` from `doctor`.
  Only `coa serve` spells out the repair. Fix it with `coa profile list` then
  `coa profile use <name> -d <dir>` (or `unset`).
- **`coa doctor` prints `Issues found — see above` for any warning**, including
  the single nit of `workspace.yml` / `.coa/` not being gitignored, and it exits
  0 either way. Read the checks; do not treat that line as a failed connection.
- **`coa plan` prompts** to continue when the repo has uncommitted changes, and
  it has no `--non-interactive`. Piped or captured, it hangs with no output.
  Give it a TTY, commit first, or pass `--gitsha <sha>`: that supplies the
  commit metadata directly, so the git check — and its prompt — is skipped
  entirely. The sha only labels the plan; the files planned still come from the
  working directory either way.

## Approval gates (`coa describe workflow`)

- Allowed without asking: `coa validate`, `coa describe`, any `--dry-run`
  preview, `coa install`, `coa doctor` without `--fix`, and `coa profile
  list` / `coa profile show` (read-only, secrets redacted).
- ASK FIRST: anything that writes credentials or shared config — `coa init`,
  `coa doctor --fix`, `coa profile create` / `set-cloud` / `delete` / `rename` /
  `use` / `unset`, editing `data.yml` / `locations.yml` / `workspace.yml`,
  node types (creating one included), jobs, macros, environments, and every
  Cloud Operations command. Never auto-bootstrap, auto-fix, or push to a remote
  without explicit approval.
