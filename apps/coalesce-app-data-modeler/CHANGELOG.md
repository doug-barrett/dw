# Changelog

All notable changes to the Data Modeler app. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Data modeling skill for agents** in `skills/data-modeling/`: how to build source models, Data Vault models and spine diagrams, star schemas / data marts and other models in this app, with the file format, role meanings and derivation rules per model type.
  - `scripts/apply-spec.js` writes `model/` from a compact spec that names nodes and columns only. Ids come from the workspace, existing files are merged (layouts and unknown keys kept), and re-applying the same spec changes nothing.
  - `scripts/check-model.js` checks `model/` against the workspace (ids, roles and tags, relation targets and columns, node type ids, `derivedFrom`, missing business keys) and regenerates each model's DBML exactly as Save does.
  - `examples/tpch-source.spec.yml`: the TPC-H source model as a worked example.

## [0.9.2] - 2026-11-03

### Changed
- **The package name is now the app id, `data-modeler`** (it was "Data Modeler"), as the official Coalesce app store requires: the name must be lowercase letters, numbers and dashes, and becomes the app's id. Coalesce's Build › Apps menu shows this name, so it now lists the app as `data-modeler`.

## [0.9.1] - 2026-11-03

### Removed
- **The Coalesce bridge** (following the node selected in Coalesce, selecting nodes in Coalesce's node list, **Open node** and double-click to open a node). Since Coalesce 7.50 every app runs on its own address (`data-modeler.localhost`), and Coalesce offers apps no way to see or change what is selected, so the bridge can no longer connect. The connection dot is gone too. Modelling, layouts, planned nodes and DBML are unchanged.

### Known limits
- On Coalesce 7.50 the app can't read Coalesce's theme setting (it lives on Coalesce's own address), so it follows the system's light or dark mode.

## [0.9.0] - 2026-10-27

### Added
- **Follows the Coalesce theme (light/dark).** The app takes Coalesce's light or dark mode and switches along with it straight away. Its dark colours are Coalesce's own, so it matches the rest of the UI. Opened outside Coalesce, it uses the theme saved in the Coalesce UI, or the system setting if none is saved.

## [0.8.1] - 2026-10-15

### Fixed
- **DBML imports into tools with older DBML parsers.** The generated files now stick to the long-supported core of DBML, and parse with every `@dbml/core` release from 2.0 to the latest.
  - Tables are no longer schema-qualified (`Table HUB_CUSTOMER`, not `Table CORE.HUB_CUSTOMER`); schemas only exist since DBML 2.4. The Coalesce location stays in the table note and in a `TableGroup` per location. A node name used in two locations of one model becomes `LOCATION_NAME`.
  - Composite business keys no longer put a note on the index, which needs DBML 3.x. The note is now a comment.

### Changed
- **DBML uses generic table types instead of Coalesce node types.** The table note says `Type: Hub | Subtype: Standard Hub`, `Type: Satellite | Subtype: Multi-active Satellite`, `Type: Dimension`, `Type: Fact`, `Type: Source` and so on, following the style of other Data Vault tools. Package prefixes and versions are dropped (Satellite v0 and v1 are both a Standard Satellite). The header comment lists the generic table types of the model.

## [0.8.0] - 2026-10-15

### Added
- **Planned nodes:** entities that are not built in Coalesce yet, for example a Data Vault an AI derives from the source model, so the design can be reviewed in the app first. The format is documented for agents in `AGENTS.md`.
  - **Where they live:** a planned node is a normal metadata file `model/nodes/<LOC>-<NAME>.yml` with a `planned:` block on the node (node type, description) and on each column (data type, description, `derivedFrom`). Labels, roles, tags and relations work as for built nodes.
  - **How they look:** like built nodes, plus a dashed outline, a striped type band and a **PLANNED** tag. They are included by models, layouts and DBML (with a "planned" note).
  - **What changes for them:** a Status filter (Built / Planned) appears once a model has planned nodes. Open node is disabled, and the Coalesce node list isn't asked to select them.
- **Upgrading planned nodes:** once a real node with the same location and name exists in `nodes/`, the planned file is rewritten in place into a normal metadata file for it.
  - Columns are matched by name: the node and column ids are filled in, and `planned:` is kept as `design:`. Relations pointing at the node, in any file, get the real ids.
  - No information is lost: designed columns that weren't built stay in the file.
  - The node's details show what was designed but not built, what was built but not designed, and data types that differ from the design.
  - The status line reports which planned nodes were built.
- **Planned changes and deletions of built nodes**, written in the built node's own metadata file: columns to add, data type changes, columns to remove (`planned: { delete: true }`), a node type change, or `node.planned: { delete: true }` for the whole node.
- **Planning status shadows:** planned new nodes get a green shadow, nodes with planned changes an orange one, and nodes planned for deletion a red one, each with a NEW / CHANGED / DELETE tag.
  - In the cards, columns to add appear as extra rows (green marker, italic), changed columns get an orange marker, and columns to remove are struck through in red.
  - The details pane lists the planned changes, and the Planned status filter covers Unchanged / New / Changed / To delete.
  - DBML notes the status of each table.
- **Carrying out planned changes:** once the built node matches a planned change (the column exists, the type matches, the column or node is gone), its `planned:` becomes `design:`, with `deleted: true` for removals. Nothing is lost.

## [0.7.0] - 2026-10-14

### Changed
- **Toolbar like the Coalesce graph.** The "Data Modeler" title is gone.
  - The model picker is now a **Data model** selector built to the measurements of the graph's "View as" control: a grey label, a white dropdown with an icon and a light ▾.
  - The sidebar toggle is now a funnel **filter button** like the one next to "View as". It turns blue while the panel is open and shows a red badge with the number of active filters. `B` still toggles it.
- **The left sidebar is a filters panel.** The node list is gone.
  - Filter by node or column: matching nodes stay, and matching columns are outlined.
  - Storage locations and the new node types filter: click to toggle, double-click to show only one.
  - Tags: clicking a tag now shows only the nodes that have it, and its columns are highlighted.
  - **Clear all** resets every filter.
  - Auto layout, Fit and the Coalesce link work on the filtered nodes. A node selected in Coalesce that is hidden by the filters gets its own note.
- **Focus centres the node.** A node the model jumps to (for example one selected in Coalesce) is centred. A node taller than the view is aligned to the top so its title stays visible.
- **Plain grey canvas** (`#f0f0f0`) like the Coalesce graph, without the dot grid.

## [0.6.0] - 2026-10-14

### Added
- **8-columns view.** A toggle in the floating graph controls, next to the Columns button, shows at most 8 columns per node, so nodes with many columns stay compact. Remembered per model.
  - Larger nodes scroll their column list inside the card. Over such a node the mouse wheel scrolls the list; elsewhere it zooms. Pinch always zooms.
  - The scroll position survives re-renders. Selecting a relation scrolls both of its columns into view.
  - A line to a column scrolled out of view is pinned to the top or bottom of the list and drawn dashed. Lines follow as you scroll.
  - The view keeps its own positions, saved as `limitedLayout` in the model file. The first time, it starts from the all-columns arrangement.
  - The toggle is disabled in the compact (no columns) view.

## [0.5.0] - 2026-10-14

### Changed
- **Slimmer top bar:** model picker with edit (✎) and new (+) icon buttons, the status (cut off with "…" when long), the Coalesce connection dot, DBML and Save.
- **Status notes clear themselves.** Confirmations ("Saved", "Opened … in Coalesce", "Reloaded from disk") disappear after 3 seconds. Problem notes ("… is not in this model", "Not connected", errors) stay until your next successful action, such as a selection, an edit or a save. "Unsaved changes" stays as long as it's true.
- **Always follows Coalesce:** selecting a node in Coalesce always selects it in the Data Modeler. The Follow Coalesce toggle is gone.
- **Floating graph controls**, laid out like the Coalesce node graph: small white button groups at the top right of the canvas, using the same Ant Design icons.
  - Columns and business labels toggles. The labels choice is now remembered too.
  - Reload, auto layout, zoom out, zoom in and fit.
  - The zoom percentage is gone, as in Coalesce.
- **Scroll wheel zooms like the Coalesce graph:** x1.1 per wheel notch towards the mouse pointer, with pinch zoom on trackpads. Scrolling no longer pans; drag the background to pan.

## [0.4.0] - 2026-10-14

### Added
- **Coalesce bridge (proof of concept).** Not a Coalesce API: it relies on Coalesce UI internals seen in 7.48 and can break with any Coalesce release.
  - When the Data Modeler runs inside Coalesce (Build › Apps, which opens it as a tab), it injects `bridge.js` into the Coalesce page. That works because apps run on the same origin as Coalesce.
  - The bridge stays in the Coalesce page while you work and talks to every Data Modeler window on that origin over a BroadcastChannel.
  - **Open node:** a button in the node details, or double-click anywhere on a node (its title or a column). Coalesce opens (or focuses) that node's tab by navigating to `/build/nodes/<id>`. If the embedded app has unsaved changes, it asks to save first, because Coalesce reloads the app when you switch back to its tab.
  - **Follow Coalesce:** select a node in Coalesce (graph or node list) or open its tab, and the Data Modeler selects and centres it, if the model contains it. Turn it off with the toolbar toggle.
  - **Selection in Coalesce:** selecting a node, or a column of a node, also selects that node in Coalesce's node list, scrolling the list to it.
  - A green dot in the toolbar shows when the bridge is connected. Reloading the Coalesce page removes the bridge; open the Data Modeler inside Coalesce once to reconnect.

## [0.3.0] - 2026-10-14

### Added
- **Multiple models.** Switch models from the toolbar, and create, edit or delete them with "+ New model" / "Edit model". Each model has a name, a model type, the node types and/or storage locations it includes, and its own canvas layout.
  - A node is in a model when it matches both the selected node types and the selected locations. A list left empty matches anything, but at least one of the two lists must be set.
  - Picking a known model type pre-selects its node types: **Source** (Source), **Star Schema** (Dimension and Fact types), **3NF** (Persistent Stage) and **Data Vault** (Hub, Link and Satellite types). Any other type name is allowed.
  - Saved as `model/models/<slug>.yml`, with the DBML next to it as `model/models/<slug>.dbml`. Every model's DBML is regenerated on save, because column metadata is shared between models.
  - The app remembers which model was open, and keeps a separate location filter for each model.
- **All node types.** Node types are read from the built-in Source type, `nodeTypes/`, and the package cache in `.coa/cache/packages/*/nodeTypes/`. Cards and DBML table headers use each type's colour.
- **Hide columns.** Untick "Columns" in the toolbar to show compact nodes that look exactly like nodes in the Coalesce graph: a 200×40 card with a band in the node type's colour on the left, the name cut off with "…" when too long, and blue borders on the nodes related to the selection.
  - Relations are drawn node to node, one line per relation.
  - The setting is remembered for each model.
  - The compact view keeps its own positions, saved as `compactLayout` in the model file, so switching views never disturbs either arrangement.
  - Adding a relation still needs the columns view, because relations connect columns.
- **Star layout for dimensional models.** Auto layout recognises models whose type is Star Schema, dimensional, snowflake, Kimball or data mart.
  - The fact goes in the centre (several facts stack in the centre column). A fact is a node with a Fact node type, or else the node with the most outgoing many-to-one relations.
  - Dimensions go around it on both sides, ordered by the fact row they join so lines don't cross, and curve slightly into a ring.
  - Snowflake outriggers go one ring further out. Nodes not connected to a fact get the normal layout to the side.
  - Other model types keep the layered layout.
- **Spine layout for Data Vault models.** Auto layout recognises Data Vault model types (Data Vault, raw/business vault, DV) and arranges hubs in columns with the links between them, modelled on a hand-made diagram.
  - Hubs, links and satellites are recognised from the node type name, or from the relations when the name doesn't say.
  - Hubs are split into balanced columns (two for small vaults) with as few links crossing between columns as possible, so related hubs stay together.
  - Links joining two hub columns go in the column between them (the spine). Links within one column also go in the spine, unless they are wide (3+ hubs) or are a hub's only link; those go on the outer side.
  - Satellites sit next to their parent.
- **Hide the sidebar.** The ◧ button at the left of the toolbar or the `B` key hides or shows the left sidebar, matching the ◨ / `I` toggle for the details pane. The choice is remembered.
- **SQL (.sql) nodes.** Columns are read from the aliases of the outermost `SELECT`, and `@description` / `@notNull` are picked up. Data types are not available for these nodes.

### Fixed
- The model type picker in the model dialog only listed the selected type. It is now a dropdown with every preset plus "Other…" for a custom type name.

### Changed
- Column labels, tags and relations still belong to the node (`model/nodes/*.yml`), so they appear in every model that includes it. A relation is drawn, and exported to DBML, only in models that contain both of its nodes.
- **Migration:** without any model files, the app starts with a "Source" model that uses the old `model/layout.yml`. The first save writes `model/models/source.yml`. It then deletes `model/layout.yml`, and deletes `model/model.dbml` too if this app generated it.

## [0.2.0] - 2026-10-14

### Added
- **Hide the details pane.** The ◨ toolbar button or the `I` key hides or shows the right-hand pane. The choice is remembered.
- **Reload from YAML.** A Reload button re-reads `model/` and `nodes/` from disk. It asks first if you have unsaved changes.
- **Picks up file changes automatically.** The app checks the files every few seconds. With no unsaved changes it reloads quietly and keeps your view and selection. With unsaved changes it shows a banner so you can reload or keep editing.
- **Edit tags.** Hover a tag in the sidebar and click ✎ to change its label or colour.
  - Free-form tags can also be renamed (every column using the tag is updated) or deleted.
  - Role keys can't be changed, because generators read them from `model/nodes/*.yml`.
  - Other settings in `tags.yml` (such as emoji) and its header comment are kept.
- **Storage location filter.** Show or hide nodes per location from the sidebar. Double-click a location to show only that one; "All" shows everything again.
  - Lines to hidden nodes, the node list and the tag counts follow the filter.
  - The filter only affects the view: `model/model.dbml` still contains every node.

### Changed
- **Auto layout rewritten** (`layout.js`) to keep lines short and avoid crossings:
  - Parents are placed to the right of children, and each node sits next to the nodes it relates to.
  - Lines that skip a layer get their own lane instead of running through cards.
  - Nodes are ordered to reduce line crossings, based on the actual position of the connected columns.
  - Each node lines up with the rows it connects to, without overlapping other nodes.
  - Cycles are handled, and unrelated nodes are parked to one side.
- Auto layout now only arranges the visible nodes. Nodes in a hidden location keep their saved positions.

### Fixed
- The details pane could show a stray "null" for nodes and relations.
- Nodes without a saved position no longer appear at the top-left corner when their location is shown again.

## [0.1.0] - 2026-10-14

### Added
- Canvas showing the workspace's Source nodes, styled like Coalesce column lineage. You can pan, zoom, drag nodes and fit the view.
- Column tagging with the roles and tags from `model/tags.yml`, shown as coloured squares. Shift/⌘-click to tag several columns at once.
- Business labels for columns and entities, with a toggle to show labels instead of technical names.
- Relations between columns, created by dragging from a column handle. Each relation has a label and a cardinality (N:1, 1:N, 1:1, N:N), and can be reversed or deleted.
- Metadata saved to `model/nodes/<LOCATION>-<NAME>.yml` (`label`, `roles`, `tags`, `relations`), with canvas positions in `model/layout.yml`. Unchanged files are never rewritten.
- `model/model.dbml` regenerated on every save, with a preview in the app. Business-key columns become `pk`, labels and tags become notes, and relations become `Ref`s.
- Runs under `coa serve` at `/api/v1/watch/apps/data-modeler/`, with no npm dependencies.
