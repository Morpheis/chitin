#!/bin/bash
# Syncs the SKILL.md frontmatter version with package.json version.
# Called automatically by npm's "version" lifecycle hook.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SKILL_FILE="$ROOT_DIR/skill/SKILL.md"
PKG_VERSION=$(node -p "require('$ROOT_DIR/package.json').version")

if [ ! -f "$SKILL_FILE" ]; then
  echo "SKILL.md not found at $SKILL_FILE"
  exit 1
fi

# Replace the version line in YAML frontmatter
sed -i '' "s/^version: .*/version: $PKG_VERSION/" "$SKILL_FILE"

# Stage the change so npm's version commit includes it
git add "$SKILL_FILE"

echo "✓ SKILL.md version synced to $PKG_VERSION"
