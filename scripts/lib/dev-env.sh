# Sourced by scripts/wt.sh and scripts/test.sh (#2490): the pinned Node and node_modules
# for one worktree, so any worktree runs tests in one command.

# Put the Node major in .nvmrc (CI's version) first in PATH. jsdom fails to load on
# Node 22, the shell default on the team Mac.
use_pinned_node() {
  local root="$1" want have dir
  want="$(tr -d ' v\n' < "$root/.nvmrc")"
  have="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)"
  [[ "$have" == "$want" ]] && return 0
  dir="$(ls -d "${NVM_DIR:-$HOME/.nvm}/versions/node/v$want".* 2>/dev/null | sort -V | tail -n 1)"
  [[ -z "$dir" && -x "/opt/homebrew/opt/node@$want/bin/node" ]] && dir="/opt/homebrew/opt/node@$want"
  if [[ -z "$dir" ]]; then
    echo "Node $want is required (found $have). Install it: nvm install $want" >&2
    return 1
  fi
  export PATH="$dir/bin:$PATH"
}

# Fill <dir>/node_modules from a per-lockfile cache (APFS copy-on-write clone), else
# npm ci, which seeds the cache. A symlink to the cache would be instant, but Turbopack
# refuses a node_modules that points outside the project.
#   ensure_node_modules <worktree> [<prepared-clone> <its-lockfile-hash>]
# A prepared clone of a cache, made ahead on the same volume (wt.sh clones while git
# checks out), is moved into place when its hash matches the lockfile, else deleted.
ensure_node_modules() {
  local root="$1" prepared="${2:-}" prepared_hash="${3:-}" cache_root cache seed
  if [[ -e "$root/node_modules" ]]; then
    if [[ -n "$prepared" ]]; then rm -rf "$prepared"; fi
    return 0
  fi
  cache_root="$HOME/Library/Caches/adbrain/node_modules"
  cache="$cache_root/$(lockfile_hash "$root")"
  if [[ -n "$prepared" && -f "$prepared/.package-lock.json" && "$prepared_hash" == "$(basename "$cache")" ]]; then
    mv "$prepared" "$root/node_modules"
  else
    if [[ -n "$prepared" ]]; then rm -rf "$prepared"; fi
    if [[ -f "$cache/.package-lock.json" ]] && cp -cR "$cache" "$root/node_modules"; then
      :
    else
      rm -rf "$root/node_modules"
      (cd "$root" && npm ci --prefer-offline --no-audit --no-fund)
      mkdir -p "$cache_root"
      seed="$cache_root/.seed-$(basename "$cache")-$$"
      if cp -cR "$root/node_modules" "$seed"; then
        if [[ ! -e "$cache" ]]; then mv "$seed" "$cache"; else rm -rf "$seed"; fi
      else
        rm -rf "$seed"
      fi
    fi
  fi
  # Keep only lockfile caches used in the last 14 days.
  find "$cache_root" -mindepth 1 -maxdepth 1 -type d ! -name '.seed-*' -mtime +14 -exec rm -rf {} + 2>/dev/null || true
  touch "$cache" 2>/dev/null || true
}

lockfile_hash() {
  shasum -a 256 "$1/package-lock.json" | cut -d ' ' -f 1
}
