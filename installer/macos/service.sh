#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

usage() {
  cat <<'EOF'
Usage: service.sh <start|stop|restart|status>

Commands:
  start    Register and start the LaunchAgent
  stop     Stop and unregister the LaunchAgent
  restart  Restart the LaunchAgent
  status   Show the LaunchAgent status
EOF
}

require_plist() {
  [[ -f "$LAUNCH_AGENT_PATH" ]] || die "LaunchAgent is not installed: $LAUNCH_AGENT_PATH"
}

start_service() {
  require_plist
  if is_service_loaded; then
    "$LAUNCHCTL_BIN" kickstart -k "$LAUNCHD_DOMAIN/$LAUNCH_AGENT_LABEL"
  else
    [[ -n "$LAUNCHCTL_BIN" ]] || die "launchctl was not found"
    "$LAUNCHCTL_BIN" bootstrap "$LAUNCHD_DOMAIN" "$LAUNCH_AGENT_PATH"
  fi
  print -- "LaunchAgent started: $LAUNCH_AGENT_LABEL"
}

stop_service() {
  require_plist
  if is_service_loaded; then
    "$LAUNCHCTL_BIN" bootout "$LAUNCHD_DOMAIN" "$LAUNCH_AGENT_PATH"
    print -- "LaunchAgent stopped: $LAUNCH_AGENT_LABEL"
  else
    print -- "LaunchAgent is not running: $LAUNCH_AGENT_LABEL"
  fi
}

status_service() {
  require_plist
  if is_service_loaded; then
    "$LAUNCHCTL_BIN" print "$LAUNCHD_DOMAIN/$LAUNCH_AGENT_LABEL"
  else
    print -u2 -- "LaunchAgent is installed but not running: $LAUNCH_AGENT_LABEL"
    return 1
  fi
}

main() {
  case "${1:-}" in
    start)
      start_service
      ;;
    stop)
      stop_service
      ;;
    restart)
      require_plist
      if is_service_loaded; then
        "$LAUNCHCTL_BIN" bootout "$LAUNCHD_DOMAIN" "$LAUNCH_AGENT_PATH"
      fi
      [[ -n "$LAUNCHCTL_BIN" ]] || die "launchctl was not found"
      "$LAUNCHCTL_BIN" bootstrap "$LAUNCHD_DOMAIN" "$LAUNCH_AGENT_PATH"
      print -- "LaunchAgent restarted: $LAUNCH_AGENT_LABEL"
      ;;
    status)
      status_service
      ;;
    -h|--help|"")
      usage
      [[ -n "${1:-}" ]] || return 2
      ;;
    *)
      usage >&2
      return 2
      ;;
  esac
}

main "$@"
