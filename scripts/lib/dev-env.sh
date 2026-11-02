# Sourced by scripts/wt.sh and scripts/test.sh (#2490): the pinned Node and node_modules
# for one worktree, so any worktree runs tests in one command.

# Put the Node major in .nvmrc (CI's version) first in PATH. jsdom fails to load on
# Node 22, the shell default on the team Mac.
use_pinned_node() {
  local root="$1" want have dir
  want="$(tr -d ' v\n' < "$root/.nvmrc")"
  have="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)"
  [[ "$have" == "$want" ]] && return 0
  dir="$(ls -d "${NVM_DIR:-$HOME/.nvm}/versions/node/v$want".* 2>/dev/null | sort -V | tail -n 1 || true)"
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
  local root="$1" prepared="${2:-}" prepared_hash="${3:-}" cache_root cache seed hash stamp
  hash="$(lockfile_hash "$root")"
  stamp="$root/node_modules/.lock-sha256"
  # A finished install writes node_modules/.package-lock.json last; anything else is partial. The stamp, written
  # here, says which lockfile it came from, so a pull that changes dependencies reinstalls.
  if [[ -f "$root/node_modules/.package-lock.json" ]] && { [[ ! -f "$stamp" ]] || [[ "$(cat "$stamp")" == "$hash" ]]; }; then
    if [[ -n "$prepared" ]]; then rm -rf "$prepared"; fi
    return 0
  fi
  rm -rf "$root/node_modules"
  cache_root="$HOME/Library/Caches/adbrain/node_modules"
  cache="$cache_root/$hash"
  if [[ -n "$prepared" && -f "$prepared/.package-lock.json" && "$prepared_hash" == "$(basename "$cache")" ]]; then
    mv "$prepared" "$root/node_modules"
  else
    if [[ -n "$prepared" ]]; then rm -rf "$prepared"; fi
    # Clone beside the target, then rename, so an interrupted copy never looks installed.
    if [[ -f "$cache/.package-lock.json" ]] && rm -rf "$root/.node_modules.tmp" && cp -cR "$cache" "$root/.node_modules.tmp"; then
      mv "$root/.node_modules.tmp" "$root/node_modules"
    else
      rm -rf "$root/.node_modules.tmp"
      rm -rf "$root/node_modules"
      (cd "$root" && npm ci --prefer-offline --no-audit --no-fund)
      mkdir -p "$cache_root"
      seed="$cache_root/.seed-$(basename "$cache")-$$"
      if cp -cR "$root/node_modules" "$seed"; then
        if [[ ! -e "$cache" ]]; then mv "$seed" "$cache"; fi
        # A seeder that lost the race moved its copy inside the winner's cache.
        rm -rf "$seed" "$cache/$(basename "$seed")"
      else
        rm -rf "$seed"
      fi
    fi
  fi
  echo "$hash" > "$stamp"
  # Mark this cache used (-c: never create it as a file), then keep only caches used in the last 14 days.
  touch -c "$cache" 2>/dev/null || true
  find "$cache_root" -mindepth 1 -maxdepth 1 -type d ! -name '.seed-*' -mtime +14 -exec rm -rf {} + 2>/dev/null || true
}

lockfile_hash() {
  shasum -a 256 "$1/package-lock.json" | cut -d ' ' -f 1
}
