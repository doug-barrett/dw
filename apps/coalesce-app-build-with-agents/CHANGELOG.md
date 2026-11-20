# Changelog

All notable changes to the Build with Agents app. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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

