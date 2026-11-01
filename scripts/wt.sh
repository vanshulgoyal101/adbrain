#!/usr/bin/env bash
# New worktree for an issue (#390): branch work/issue-<n> from origin/next (#461) under
# ~/Development/copilot/adbrain-wt/<n>, node_modules cloned from a per-lockfile cache
# (APFS copy-on-write, seconds; cloned while git checks out, #2490), else npm ci on the
# pinned Node (.nvmrc). Prints the path.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo 'Usage: scripts/wt.sh <issue-number> [base-branch]' >&2
  exit 1
fi

issue="$1"
base="${2:-origin/next}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$HOME/Development/copilot/adbrain-wt/$issue"
branch="work/issue-$issue"
# shellcheck source=lib/dev-env.sh
source "$repo/scripts/lib/dev-env.sh"

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

# Clone the cached node_modules beside the target while git checks out the tree.
lock_hash="$(git -C "$repo" show "$base:package-lock.json" | shasum -a 256 | cut -d ' ' -f 1)"
cache="$HOME/Library/Caches/adbrain/node_modules/$lock_hash"
prepared=""
clone_pid=""
cleanup() {
  if [[ -n "$clone_pid" ]]; then kill "$clone_pid" 2>/dev/null || true; wait "$clone_pid" 2>/dev/null || true; fi
  if [[ -n "$prepared" ]]; then rm -rf "$prepared"; fi
}
trap cleanup EXIT
if [[ -f "$cache/.package-lock.json" ]]; then
  mkdir -p "$(dirname "$target")"
  prepared="$target.node_modules.$$"
  cp -cR "$cache" "$prepared" &
  clone_pid=$!
fi

git -C "$repo" worktree add -b "$branch" "$target" "$base"
if [[ -n "$clone_pid" ]]; then
  wait "$clone_pid" || rm -rf "$prepared"
  clone_pid=""
fi

use_pinned_node "$target"
ensure_node_modules "$target" "$prepared" "$lock_hash"

echo "$target"
