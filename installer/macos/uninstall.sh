#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PURGE_DATA=false
ACTION=""

usage() {
  cat <<'EOF'
Usage: uninstall.sh [--purge-data] [--yes|--rollback]

When multiple releases are installed, interactive uninstall asks whether to
remove all releases or remove only the active release and roll back one.

Options:
  --purge-data  Also remove persistent configuration and runtime data
  --yes, -y     Remove all releases without an interactive prompt
  --rollback    Remove the active release and run a rollback to the previous one
EOF
}

parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --purge-data)
        PURGE_DATA=true
        ;;
      --yes|-y|--all)
        ACTION="all"
        ;;
      --rollback)
        [[ "$ACTION" != "all" ]] || die "choose either --yes/--all or --rollback"
        ACTION="rollback"
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        exit 2
        ;;
    esac
  done
}

select_action() {
  local count="$1"
  local versions="$2"

  [[ -n "$ACTION" ]] && return 0
  if (( count <= 1 )); then
    ACTION="all"
    return 0
  fi

  if [[ ! -t 0 ]]; then
    die "multiple releases are installed: $versions; choose all releases or rollback one interactively, or pass --yes/--rollback"
  fi

  printf 'Multiple releases are installed: %s\n' "$versions"
  printf '1) Remove all releases and stop the service\n'
  printf '2) Remove the active release and roll back one version\n'
  printf '3) Cancel\n'
  printf 'Choose [1-3]: '

  local choice
  if ! read -r choice; then
    die "uninstall cancelled: no choice was received"
  fi
  case "$choice" in
    1|all)
      ACTION="all"
      ;;
    2|rollback)
      ACTION="rollback"
      ;;
    3|cancel|q|Q)
      die "uninstall cancelled"
      ;;
    *)
      die "uninstall cancelled: choose all, rollback, or cancel"
      ;;
  esac
}

uninstall_all() {
  if is_service_loaded; then
    "$LAUNCHCTL_BIN" bootout "$LAUNCHD_DOMAIN" "$LAUNCH_AGENT_PATH"
  fi

  rm -f "$LAUNCH_AGENT_PATH"
  rm -f "$CURRENT_LINK"
  rm -rf "$RELEASES_DIR"

  if [[ "$PURGE_DATA" == true ]]; then
    rm -rf "$CONFIG_DIR" "$RUNTIME_HOME"
    printf 'LLM Proxy uninstalled; configuration and runtime data removed\n'
  else
    printf 'LLM Proxy uninstalled; configuration and runtime data preserved\n'
    printf '  Config: %s\n' "$CONFIG_DIR"
    printf '  Runtime: %s\n' "$RUNTIME_HOME"
  fi
}

rollback_one() {
  [[ "$PURGE_DATA" == false ]] || die "--purge-data cannot be combined with --rollback"

  local active_target previous_version
  active_target="$(current_release_target 2>/dev/null || true)"
  [[ -n "$active_target" ]] || die "cannot roll back: no active release is installed"
  previous_version="$(previous_release_version 2>/dev/null || true)"
  [[ -n "$previous_version" ]] || die "cannot roll back: no historical release is available"

  "$SCRIPT_DIR/rollback.sh" "$previous_version" --yes

  [[ "$active_target" == "$RELEASES_DIR/"* ]] || die "active release is outside the managed releases directory: $active_target"
  rm -rf -- "$active_target"
  printf 'Removed the previous active release; service remains on %s\n' "$previous_version"
}

main() {
  parse_args "$@"

  local count versions
  count="$(release_count)"
  versions="$(release_versions | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  select_action "$count" "$versions"

  case "$ACTION" in
    all)
      uninstall_all
      ;;
    rollback)
      rollback_one
      ;;
    *)
      die "unknown uninstall action: $ACTION"
      ;;
  esac
}

main "$@"
