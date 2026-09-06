#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENTS/com.edu-workspace.server.plist" 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/com.edu-workspace.server"
launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENTS/com.edu-workspace.caddy.plist" 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/com.edu-workspace.caddy"

echo "LAN services started: http://$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1):5173"
