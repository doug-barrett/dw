#!/usr/bin/env bash
# Vendor Coalesce Platform Skills into the app at a pinned release.
# The app loads them with `--plugin-dir` (Claude Code and Cortex Code take the same flag), so they ship and update with the app.
# Only skills that work without a shell and stay inside nodes/ are kept.
# Usage: scripts/update-skills.sh <tag>   (for example 0.1.13)
set -euo pipefail
TAG="${1:?usage: scripts/update-skills.sh <tag>}"
REPO="Coalesce-Software-Inc/coalesce-platform-skills"
KEEP=(
  coalesce-pipelines
  coalesce-create-stage-node
  coalesce-add-column
  coalesce-sql-transformation
  coalesce-pipeline-structure
  coalesce-v1-yaml-nodes
  coalesce-rename-node-cascade
  coalesce-quality-test-authoring
  coalesce-review-risk
)
APP="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$APP/vendor/coalesce-platform-skills"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/tags/$TAG" | tar xz -C "$TMP"
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
rm -rf "$DEST"
mkdir -p "$DEST/skills"
cp -R "$SRC/.claude-plugin" "$SRC/LICENSE" "$DEST/"
rm -f "$DEST/.claude-plugin/marketplace.json"
for s in "${KEEP[@]}"; do cp -R "$SRC/skills/$s" "$DEST/skills/"; done
echo "Vendored $REPO@$TAG (${#KEEP[@]} skills) into vendor/coalesce-platform-skills"
