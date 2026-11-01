#!/usr/bin/env bash
# Tests in one command from any worktree (#2490): pinned Node (.nvmrc), node_modules
# from the lockfile cache when missing, then vitest.
#   scripts/test.sh [vitest args]             the whole suite (or the files named)
#   scripts/test.sh --watch [vitest args]     watch mode
#   scripts/test.sh --changed [vitest args]   what a PR runs (#2386): tests the change
#     reaches plus every file-scanning test, or everything when a non-module file
#     changed. Base: TEST_BASE (CI: HEAD^1), else the merge-base with origin/next;
#     uncommitted and untracked files count as changed.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
# shellcheck source=lib/dev-env.sh
source scripts/lib/dev-env.sh
use_pinned_node "$root"
ensure_node_modules "$root"

vitest() { node node_modules/vitest/vitest.mjs "$@"; }

case "${1:-}" in
  --watch) shift; vitest "$@"; exit ;;
  --changed) shift ;;
  *) vitest run "$@"; exit ;;
esac

base="${TEST_BASE:-$(git merge-base HEAD origin/next)}"
changed="$( (git diff --name-only "$base"; git ls-files --others --exclude-standard) | sort -u)"
if [[ -z "$changed" ]]; then
  echo "No changes since $base; nothing to test."
  exit 0
fi
# Modules also read JSON, fonts, SQL and AGENTS.md with fs, outside the import graph.
if grep -qvE '^docs/|\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|css)$' <<<"$changed"; then
  echo "Non-module files changed; running the whole suite."
  vitest run "$@"
  exit
fi
vitest run --changed "$base" --passWithNoTests "$@"
scans=()
while IFS= read -r file; do scans+=("$file"); done < <(grep -rlE "readFileSync|readdirSync|globSync|existsSync" tests --include='*.test.ts' --include='*.test.tsx' | sort)
echo "${#scans[@]} file-scanning tests"
[[ ${#scans[@]} -gt 0 ]] || exit 0
vitest run --passWithNoTests "$@" "${scans[@]}"
