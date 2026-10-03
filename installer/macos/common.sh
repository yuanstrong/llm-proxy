#!/bin/bash

set -u

INSTALLER_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_ROOT="${LLM_PROXY_SOURCE_ROOT:-$(cd -- "$INSTALLER_DIR/../.." && pwd)}"
INSTALL_ROOT="${LLM_PROXY_INSTALL_ROOT:-$HOME/Library/Application Support/llm-proxy}"
RELEASES_DIR="$INSTALL_ROOT/releases"
CURRENT_LINK="$INSTALL_ROOT/current"
CONFIG_DIR="$INSTALL_ROOT/config"
CONFIG_PATH="${LLM_PROXY_CONFIG:-$CONFIG_DIR/config.toml}"
ENV_PATH="${LLM_PROXY_ENV:-$CONFIG_DIR/.env}"
RUNTIME_HOME="${LLM_PROXY_HOME:-$INSTALL_ROOT/runtime}"
LAUNCH_AGENT_LABEL="${LLM_PROXY_LAUNCHD_LABEL:-com.example.llm-proxy}"
LAUNCH_AGENT_PATH="${LLM_PROXY_LAUNCH_AGENT:-$HOME/Library/LaunchAgents/$LAUNCH_AGENT_LABEL.plist}"
LAUNCHD_DOMAIN="${LLM_PROXY_LAUNCHD_DOMAIN:-gui/$(id -u)}"
LAUNCHCTL_BIN="${LLM_PROXY_LAUNCHCTL_BIN:-$(command -v launchctl || true)}"

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_macos() {
  [[ "$(uname -s)" == "Darwin" || "${LLM_PROXY_ALLOW_NON_MACOS_TEST:-}" == "1" ]] \
    || die "this installer only supports macOS"
}

find_node() {
  if [[ -n "${LLM_PROXY_NODE_BIN:-}" ]]; then
    printf '%s\n' "$LLM_PROXY_NODE_BIN"
    return
  fi
  command -v node || true
}

find_npm() {
  if [[ -n "${LLM_PROXY_NPM_BIN:-}" ]]; then
    printf '%s\n' "$LLM_PROXY_NPM_BIN"
    return
  fi
  command -v npm || true
}

find_curl() {
  if [[ -n "${LLM_PROXY_CURL_BIN:-}" ]]; then
    printf '%s\n' "$LLM_PROXY_CURL_BIN"
    return
  fi
  command -v curl || true
}

package_version() {
  local node_bin="$1"
  "$node_bin" -e 'process.stdout.write(require(process.argv[1]).version)' "$SOURCE_ROOT/package.json"
}

require_file() {
  [[ -f "$1" ]] || die "required file not found: $1"
}

is_service_loaded() {
  [[ -n "$LAUNCHCTL_BIN" ]] || return 1
  "$LAUNCHCTL_BIN" print "$LAUNCHD_DOMAIN/$LAUNCH_AGENT_LABEL" >/dev/null 2>&1
}

stop_existing_service() {
  if is_service_loaded; then
    "$LAUNCHCTL_BIN" bootout "$LAUNCHD_DOMAIN" "$LAUNCH_AGENT_PATH"
  fi
}

start_service() {
  [[ -n "$LAUNCHCTL_BIN" ]] || die "launchctl was not found"
  "$LAUNCHCTL_BIN" bootstrap "$LAUNCHD_DOMAIN" "$LAUNCH_AGENT_PATH"
}

current_release_target() {
  [[ -L "$CURRENT_LINK" ]] || return 1
  readlink "$CURRENT_LINK"
}

current_release_version() {
  local target
  target="$(current_release_target)" || return 1
  basename "$target"
}

release_dirs_by_mtime() {
  [[ -d "$RELEASES_DIR" ]] || return 0

  local -a dirs records
  local dir mtime version
  shopt -s nullglob
  dirs=( "$RELEASES_DIR"/[0-9]* )
  shopt -u nullglob
  ((${#dirs[@]} > 0)) || return 0

  # Sort by mtime, then by version for equal timestamps. The explicit
  # secondary key avoids filesystem- and ls-specific tie ordering when rapid
  # installs share the same timestamp precision.
  records=()
  for dir in "${dirs[@]}"; do
    case "$(uname -s)" in
      Darwin)
        mtime="$(stat -f '%m' "$dir")" || continue
        ;;
      *)
        mtime="$(stat -c '%Y' "$dir")" || continue
        ;;
    esac
    version="$(basename "$dir")"
    records+=( "$mtime"$'\t'"$version"$'\t'"$dir" )
  done

  ((${#records[@]} > 0)) || return 0
  printf '%s\n' "${records[@]}" | sort -t $'\t' -k1,1rn -k2,2r | cut -f3-
}

release_versions() {
  local dir
  while IFS= read -r dir; do
    [[ -n "$dir" ]] || continue
    basename "$dir"
  done < <(release_dirs_by_mtime)
}

release_count() {
  local count=0 dir
  while IFS= read -r dir; do
    [[ -n "$dir" ]] || continue
    ((count += 1))
  done < <(release_dirs_by_mtime)
  printf '%s\n' "$count"
}

previous_release_version() {
  local current_version="${1:-$(current_release_version 2>/dev/null || true)}"
  local version
  while IFS= read -r version; do
    [[ -n "$version" && "$version" != "$current_version" ]] || continue
    printf '%s\n' "$version"
    return 0
  done < <(release_versions)
  return 1
}

validate_release_version() {
  local version="$1"
  [[ -n "$version" && "$version" != */* && "$version" != "." && "$version" != ".." ]] \
    || die "invalid release version: $version"
}

wait_for_health() {
  [[ "${LLM_PROXY_SKIP_HEALTHCHECK:-}" == "1" ]] && return 0

  local curl_bin attempt attempts delay
  curl_bin="$(find_curl)"
  [[ -n "$curl_bin" ]] || die "curl was not found; cannot verify the service health"
  attempts="${LLM_PROXY_HEALTHCHECK_ATTEMPTS:-30}"
  delay="${LLM_PROXY_HEALTHCHECK_DELAY:-1}"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if "$curl_bin" --fail --silent --show-error --max-time 2 \
      "${LLM_PROXY_HEALTHCHECK_URL:-http://127.0.0.1:3000/}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

prune_releases() {
  local current_target="$(current_release_target 2>/dev/null || true)"
  local -a dirs keep
  local dir kept should_keep kept_dir
  dirs=()
  while IFS= read -r dir; do
    [[ -n "$dir" ]] || continue
    dirs+=("$dir")
  done < <(release_dirs_by_mtime)
  keep=()

  if [[ -n "$current_target" && -d "$current_target" ]]; then
    keep+=("$current_target")
  fi

  for dir in "${dirs[@]}"; do
    kept=false
    for kept_dir in "${keep[@]}"; do
      if [[ "$dir" == "$kept_dir" ]]; then
        kept=true
        break
      fi
    done
    if [[ "$kept" == true ]]; then
      continue
    fi
    if ((${#keep[@]} < 5)); then
      keep+=("$dir")
    fi
  done

  for dir in "${dirs[@]}"; do
    should_keep=false
    for kept_dir in "${keep[@]}"; do
      if [[ "$dir" == "$kept_dir" ]]; then
        should_keep=true
        break
      fi
    done
    if [[ "$should_keep" == false ]]; then
      rm -rf -- "$dir"
    fi
  done
}
