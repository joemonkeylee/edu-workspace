#!/bin/zsh
set -euo pipefail

launchctl bootout "gui/$(id -u)/com.edu-workspace.caddy" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.edu-workspace.server" 2>/dev/null || true

echo "LAN services stopped."
