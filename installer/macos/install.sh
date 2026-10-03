#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

STAGING_DIR=""
ASSUME_YES=false
CHECK_ONLY=false

cleanup_staging() {
  if [[ -n "$STAGING_DIR" ]]; then
    rm -rf -- "$STAGING_DIR"
    STAGING_DIR=""
  fi
}

parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --yes|-y)
        ASSUME_YES=true
        ;;
      --check)
        CHECK_ONLY=true
        ;;
      -h|--help)
        cat <<'EOF'
Usage: install.sh [--yes]

Install the packaged release. If another release is already installed,
confirmation is required before the service is upgraded.

Options:
  --yes, -y  Confirm an upgrade without an interactive prompt
  --check    Validate the release without installing it
EOF
        exit 0
        ;;
      *)
        print -u2 -- "Usage: install.sh [--yes]"
        exit 2
        ;;
    esac
  done
}

preflight() {
  [[ "$(uname -s)" == "Darwin" ]] || die "this installer only supports macOS"

  local node_bin
  node_bin="$(find_node)"
  [[ -n "$node_bin" && -x "$node_bin" ]] || die "Node.js was not found; install Node.js before running this installer"

  require_file "$SOURCE_ROOT/package.json"
  require_file "$SOURCE_ROOT/dist/server/server/index.js"
  require_file "$SOURCE_ROOT/dist/server/server/provider.js"
  require_file "$SOURCE_ROOT/dist/ui/index.html"
  require_file "$SOURCE_ROOT/package-lock.json"

  print -- "Preflight check passed"
  print -- "  Node: $node_bin"
  print -- "  Source: $SOURCE_ROOT"
}

confirm_upgrade() {
  local target_version="$1"
  local current_version="$(current_release_version 2>/dev/null || true)"
  local count="$(release_count)"
  local versions="$(release_versions | tr '\n' ' ' | sed 's/[[:space:]]*$//')"

  (( count > 0 )) || return 0

  if [[ "$ASSUME_YES" == true ]]; then
    print -- "Existing releases detected; upgrade confirmed by --yes"
    return 0
  fi

  if [[ ! -t 0 ]]; then
    die "upgrade from ${current_version:-an existing installation} to $target_version requires confirmation; existing releases: $versions; rerun with --yes"
  fi

  print -- "Existing releases: $versions"
  print -n -- "Upgrade ${current_version:-the existing installation} to $target_version and restart the service? [y/N] "
  local answer
  if ! read -r answer; then
    die "upgrade cancelled: no confirmation was received"
  fi
  [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]] \
    || die "upgrade cancelled"
}

install_dependencies() {
  local release_dir="$1"
  local npm_bin

  npm_bin="$(find_npm)"
  [[ -n "$npm_bin" ]] || die "npm was not found; install Node.js with npm before running this installer"
  (cd "$release_dir" && "$npm_bin" ci --omit=dev --no-audit --no-fund)
}

copy_release_files() {
  local release_dir="$1"
  cp -R "$SOURCE_ROOT/dist" "$release_dir/dist"
  cp "$SOURCE_ROOT/package.json" "$release_dir/package.json"
  cp "$SOURCE_ROOT/package-lock.json" "$release_dir/package-lock.json"
}

ensure_persistent_files() {
  mkdir -p "$CONFIG_DIR" "$RUNTIME_HOME" "$(dirname -- "$LAUNCH_AGENT_PATH")" "$(dirname -- "$ENV_PATH")"

  if [[ ! -f "$CONFIG_PATH" ]]; then
    if [[ -f "$SOURCE_ROOT/config.toml" ]]; then
      cp "$SOURCE_ROOT/config.toml" "$CONFIG_PATH"
    elif [[ -f "$SOURCE_ROOT/config.example.toml" ]]; then
      cp "$SOURCE_ROOT/config.example.toml" "$CONFIG_PATH"
    else
      die "configuration not found; create $CONFIG_PATH before installing"
    fi
  fi

  chmod 600 "$CONFIG_PATH"
  ensure_config_environment
}

env_file_has_name() {
  local name="$1"
  [[ -f "$ENV_PATH" ]] && grep -Eq "^[[:space:]]*(export[[:space:]]+)?${name}=" "$ENV_PATH"
}

append_env_value() {
  local name="$1"
  local value="$2"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* && "$value" != *'"'* ]] \
    || die "value for $name contains unsupported quote or newline characters"
  print -r -- "$name=\"$value\"" >> "$ENV_PATH"
}

ensure_config_environment() {
  [[ -f "$ENV_PATH" ]] || : > "$ENV_PATH"
  chmod 600 "$ENV_PATH"

  local references reference name value
  references="$(grep -Eo '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "$CONFIG_PATH" | sort -u || true)"
  for reference in ${(f)references}; do
    name="${reference#\${}"
    name="${name%\}}"
    env_file_has_name "$name" && continue

    if printenv "$name" >/dev/null 2>&1; then
      value="$(printenv "$name")"
      append_env_value "$name" "$value"
      continue
    fi

    if [[ ! -t 0 ]]; then
      die "required environment variable $name is missing; set it or add it to $ENV_PATH"
    fi

    print -n -- "Enter value for $name: "
    read -r -s value
    print
    [[ -n "$value" ]] || die "a value is required for $name"
    append_env_value "$name" "$value"
  done
}

restore_previous_release() {
  local previous_target="$1"
  local release_dir="$2"
  local backup_dir="$3"

  stop_existing_service || true
  rm -f "$CURRENT_LINK"
  rm -rf -- "$release_dir"
  if [[ -n "$backup_dir" && -d "$backup_dir" ]]; then
    mv "$backup_dir" "$release_dir"
  fi
  if [[ -n "$previous_target" ]]; then
    ln -s "$previous_target" "$CURRENT_LINK"
  fi

  if [[ -n "$previous_target" ]]; then
    start_service || true
    wait_for_health || true
  fi
}

main() {
  parse_args "$@"

  if [[ "$CHECK_ONLY" == true ]]; then
    preflight
    return 0
  fi

  preflight

  local node_bin version release_dir previous_target backup_dir=""
  node_bin="$(find_node)"
  version="$(package_version "$node_bin")"
  validate_release_version "$version"
  release_dir="$RELEASES_DIR/$version"

  mkdir -p "$RELEASES_DIR"
  confirm_upgrade "$version"

  STAGING_DIR="$(mktemp -d "$RELEASES_DIR/.staging-$version.XXXXXX")"
  trap cleanup_staging EXIT

  copy_release_files "$STAGING_DIR"
  install_dependencies "$STAGING_DIR"
  ensure_persistent_files

  previous_target="$(current_release_target 2>/dev/null || true)"
  stop_existing_service

  if [[ -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]]; then
    die "current path exists and is not a symlink: $CURRENT_LINK"
  fi

  if [[ -d "$release_dir" ]]; then
    backup_dir="$RELEASES_DIR/.backup-$version.$$"
    [[ ! -e "$backup_dir" ]] || die "temporary backup path already exists: $backup_dir"
    mv "$release_dir" "$backup_dir"
  fi
  mv "$STAGING_DIR" "$release_dir"
  STAGING_DIR=""
  rm -f "$CURRENT_LINK"
  ln -s "$release_dir" "$CURRENT_LINK"

  if ! "$node_bin" "$SCRIPT_DIR/render-plist.mjs" \
    "$LAUNCH_AGENT_PATH" \
    "$LAUNCH_AGENT_LABEL" \
    "$node_bin" \
    "$CURRENT_LINK" \
    "$CONFIG_PATH" \
    "$RUNTIME_HOME" \
    "$ENV_PATH"; then
    restore_previous_release "$previous_target" "$release_dir" "$backup_dir"
    die "upgrade failed while generating the LaunchAgent; the previous release was restored"
  fi
  chmod 600 "$LAUNCH_AGENT_PATH"

  if ! start_service || ! wait_for_health; then
    restore_previous_release "$previous_target" "$release_dir" "$backup_dir"
    die "upgrade failed health verification; the previous release was restored"
  fi

  [[ -z "$backup_dir" ]] || rm -rf -- "$backup_dir"
  prune_releases

  print -- "LLM Proxy installed and started"
  print -- "  Version: $version"
  print -- "  Management UI: http://127.0.0.1:3000/"
  print -- "  Install root: $INSTALL_ROOT"
}

main "$@"
