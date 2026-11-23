# Changelog

All notable changes to the Build with Agents app. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Future state data model with the Data Modeler app.** When the Data Modeler app is installed in the workspace, every thread designs the data model before it builds:
  - The agent works out the modeling style of each layer (source, staging, Data Vault, star schema, …) and builds into all layers unless your request says otherwise.
  - Each layer gets a data model in `model/` with its existing nodes and their relations, and the nodes the plan adds or changes are added as planned nodes (the Data Modeler's planned-node feature). Planning may write in `model/` and nowhere else: anything else it writes is put back.
  - The plan and review cards have a **Data model** section: the styles found, the models changed and their planned nodes. **Show in Data Modeler** puts just those `model/` files in your workspace (uncommitted) so you can check the design in the Data Modeler; **Take it out again** removes them. The preview follows plan revisions, and what you save in the Data Modeler (a layout, a changed planned node) goes back to the agent before its next step. Applying, discarding or deleting the thread handles the preview, and Undo after applying restores the original files.
- **Uses the Data Modeler's metadata** when building: business keys, relations, PII/measure/code tags and labels guide grains, joins, keys, annotations, checks and descriptions, planned nodes are built exactly as designed, and new nodes are documented in `model/`. The skill ships in `app-skills/` (a second plugin, so updating the vendored skills keeps it) and is listed on the setup page.

## [0.2.1] - 2026-11-19

### Fixed
- **Finding Claude Code and Cortex Code on Windows.** The app now finds an agent the way PowerShell and Command Prompt do: through `.cmd`, `.bat` and `.ps1` launchers as well as `.exe` files, so Cortex Code's installer (which puts only `cortex.cmd` on PATH) and npm installs of Claude Code (`claude.cmd`) are found. It runs the program the launcher starts rather than the launcher itself. It also looks in the usual install folders, and in Cortex Code's versioned install folder if the launcher can't be read.
- **Check again on Windows** reads PATH from the registry, so an agent installed or added to PATH after Coalesce started is found without restarting Coalesce.
- **The setup help on Windows** shows the PowerShell install command for each agent instead of the macOS and Linux one.
- **No console windows on Windows** flash up while the app checks or runs the agent.

### Added
- The agent page shows where the app found the agent.

## [0.2.0] - 2026-11-18

### Added
- **Cortex Code as the agent.** Pick Claude Code or Snowflake Cortex Code on the setup page or the agent page. Cortex Code runs on your Snowflake connection, and its usage is billed to that account as Cortex credits. It gets the same plan, build, validate and review steps, the same bundled skills, and the same limits: file tools only, no SQL and no shell. With only Cortex Code installed, the app uses it without being told.

## [0.1.1] - 2026-11-10

### Fixed
- **Thread names for requests typed without a title.** The thread is named by the agent's plan, like "Members by state and plan", instead of the first line of the request cut off at 64 characters.
- **The workspace's node count** in the sidebar now updates when you apply a thread or remove it again.

## [0.1.0] - 2026-11-10

First release.

### Added
- **Describe or attach a spec on Home**, or sketch one step by step in **Drafts**: what to start from, what it should produce, and anything else the agent should know.
- **Plan before building.** The agent reads the workspace and proposes the nodes it will create or reuse, the decisions it needs from you, and tests to add. Settle the decisions, then approve.
- **Build in a private copy.** The agent builds in a copy of the workspace using the bundled Coalesce Platform Skills. Coalesce's validator checks the result, and the agent gets one round to fix new problems.
- **Review and apply.** See each file the agent wrote, then apply the changes to your workspace, uncommitted. Remove them again until they're committed.
- **Threads** for every request, grouped by stage (Plans, Builds, Applied) with what's waiting on you. Stop, discard or delete a thread at any time.
- **Settings** for the model, effort, turn and budget limits, and compaction, plus a setup page that checks Claude Code, the workspace's sources and its storage locations.

