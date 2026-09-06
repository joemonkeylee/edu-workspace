#!/bin/zsh
set -euo pipefail

SERVICE="${1:-server}"
case "$SERVICE" in
  server)
    tail -f /tmp/edu-workspace-server.log /tmp/edu-workspace-server.error.log
    ;;
  caddy)
    tail -f /tmp/edu-workspace-caddy.log /tmp/edu-workspace-caddy.error.log
    ;;
  *)
    echo "Usage: $0 [server|caddy]"
    exit 1
    ;;
esac
