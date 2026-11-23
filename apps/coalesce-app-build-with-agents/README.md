# Build with Agents

A Coalesce workspace app. Describe the pipelines you need, or attach a spec, and your own coding agent (Claude Code or Snowflake Cortex Code) plans and builds them in a private copy of your workspace. You approve the plan, review what was built (Coalesce validates it), and apply it to your workspace when you're happy. Nothing in your workspace changes until you apply.

## What it needs

- Coalesce Desktop 7.51 or later, or `coa serve`.
- One coding agent installed and signed in on the same computer: [Claude Code](https://code.claude.com), or [Cortex Code](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli) with a Snowflake connection. The app runs your own agent, so usage counts against your Claude plan or API key, or is billed to your Snowflake account as Cortex credits. The app's setup page checks this and lets you pick which one to use.
- Source nodes and storage locations in the workspace.

## How it works

- Each request is a thread that moves through Draft, Plan, Build, Validate, Review and Apply.
- A thread works in two copies of the workspace: one as it was when the thread started, and one the agent writes to. The changes are the difference between them. Apply copies only those files into your workspace, uncommitted, and can take them back out until you commit.
- Agents use the bundled [Coalesce Platform Skills](https://github.com/Coalesce-Software-Inc/coalesce-platform-skills) (`vendor/`; update them with `scripts/update-skills.sh <tag>`). They work with file tools only: no shell and no network tools.
- Agents also load the app's own skills (`app-skills/`, a second plugin that `scripts/update-skills.sh` leaves alone).
- **With the Data Modeler app installed**, every thread plans a future state data model first: the agent works out the modeling style of each layer, makes sure each layer has a data model with its existing nodes and relations, and adds the nodes it will build as planned nodes in `model/` (planning may write there and nowhere else). The plan card shows the data model changes; **Show in Data Modeler** copies just those `model/` files into your workspace so you can check them in the Data Modeler, and takes them out again. Changes you save in the Data Modeler go back to the agent. The extra instructions are in `data-model-guide.md`.
- Threads are kept in `~/.coa/apps/build-with-agents/`, outside the workspace. The agent conversations are ordinary Claude Code or Cortex Code sessions.

## This repository

The app's source is in this folder: `server.js` (no dependencies), `locate.js` (finding the agent on each system) and the page in `public/`. Run the tests with `npm test` (Node's built-in test runner; the Windows cases run on any system).

To release a version: add the changes to the `## [Unreleased]` section of `CHANGELOG.md`, merge them, then run **Release app** in [coalesce-app-releases](https://github.com/coalesceio/coalesce-app-releases).
