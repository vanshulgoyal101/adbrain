#!/usr/bin/env bash
# New worktree for an issue (#390): branch work/issue-<n> from origin/main under
# ~/Development/copilot/adbrain-wt/<n>, node_modules cloned from a per-lockfile cache
# (APFS copy-on-write, seconds), else npm ci. Prints the path.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo 'Usage: scripts/wt.sh <issue-number> [base-branch]' >&2
  exit 1
fi

issue="$1"
base="${2:-origin/main}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$HOME/Development/copilot/adbrain-wt/$issue"
branch="work/issue-$issue"

if [[ -e "$target" ]]; then
  echo "Worktree path already exists: $target" >&2
  exit 1
fi

if [[ "$base" == origin/* ]]; then
  git -C "$repo" fetch origin "${base#origin/}"
fi
if ! git -C "$repo" rev-parse --verify --quiet "${base}^{commit}" >/dev/null; then
  echo "Unknown base branch: $base" >&2
  exit 1
fi

git -C "$repo" worktree add -b "$branch" "$target" "$base"
lock_hash="$(shasum -a 256 "$target/package-lock.json" | cut -d ' ' -f 1)"
cache_root="$HOME/Library/Caches/adbrain/node_modules"
cache="$cache_root/$lock_hash"

if [[ -f "$cache/.package-lock.json" ]]; then
  if ! cp -cR "$cache" "$target/node_modules"; then
    rm -rf "$target/node_modules"
    (cd "$target" && npm ci --prefer-offline --no-audit --no-fund)
  fi
else
  (cd "$target" && npm ci --prefer-offline --no-audit --no-fund)
  mkdir -p "$cache_root"
  seed="$cache_root/.seed-$lock_hash-$$"
  if cp -cR "$target/node_modules" "$seed"; then
    if [[ ! -e "$cache" ]]; then mv "$seed" "$cache"; else rm -rf "$seed"; fi
  else
    rm -rf "$seed"
  fi
fi

# Keep only lockfile caches used in the last 14 days.
find "$cache_root" -mindepth 1 -maxdepth 1 -type d ! -name '.seed-*' -mtime +14 -exec rm -rf {} + 2>/dev/null || true
touch "$cache" 2>/dev/null || true

echo "$target"
