#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ASSUME_YES=false
TARGET_VERSION=""

usage() {
  cat <<'EOF'
Usage: rollback.sh [version] [--yes]

Switch the service to a historical release. Without a version, the newest
release other than current is selected.

Options:
  --yes, -y  Confirm without an interactive prompt
EOF
}

parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --yes|-y)
        ASSUME_YES=true
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        [[ -z "$TARGET_VERSION" ]] || die "only one rollback version may be specified"
        TARGET_VERSION="$arg"
        ;;
    esac
  done
}

confirm_rollback() {
  local current_version="$1"
  local target_version="$2"

  [[ "$ASSUME_YES" == true ]] && return 0
  if [[ ! -t 0 ]]; then
    die "rollback from $current_version to $target_version requires confirmation; rerun with --yes"
  fi

  printf 'Rollback from %s to %s and restart the service? [y/N] ' "$current_version" "$target_version"
  local answer
  if ! read -r answer; then
    die "rollback cancelled: no confirmation was received"
  fi
  [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]] || die "rollback cancelled"
}

main() {
  parse_args "$@"

  local current_target current_version target_version target_dir
  current_target="$(current_release_target 2>/dev/null || true)"
  [[ -n "$current_target" ]] || die "no active release found at $CURRENT_LINK"
  current_version="$(current_release_version)"

  if [[ -z "$TARGET_VERSION" ]]; then
    target_version="$(previous_release_version "$current_version" 2>/dev/null || true)"
    [[ -n "$target_version" ]] || die "no historical release is available for rollback"
  else
    target_version="$TARGET_VERSION"
  fi
  validate_release_version "$target_version"
  target_dir="$RELEASES_DIR/$target_version"
  [[ -d "$target_dir" ]] || die "release not found: $target_version"
  [[ "$target_dir" != "$current_target" ]] || die "release $target_version is already active"
  confirm_rollback "$current_version" "$target_version"

  stop_existing_service
  rm -f "$CURRENT_LINK"
  ln -s "$target_dir" "$CURRENT_LINK"

  if ! start_service || ! wait_for_health; then
    stop_existing_service || true
    rm -f "$CURRENT_LINK"
    ln -s "$current_target" "$CURRENT_LINK"
    start_service || true
    wait_for_health || true
    die "rollback failed health verification; the current release was restored"
  fi

  printf 'LLM Proxy rolled back and started\n'
  printf '  Version: %s\n' "$target_version"
}

main "$@"
