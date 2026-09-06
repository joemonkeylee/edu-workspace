#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_AGENTS"

cp "$ROOT_DIR/deploy/com.edu-workspace.server.plist" "$LAUNCH_AGENTS/"
cp "$ROOT_DIR/deploy/com.edu-workspace.caddy.plist" "$LAUNCH_AGENTS/"

# Stop a Caddy instance that may have been started manually before launchd.
caddy stop --address 127.0.0.1:2019 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.edu-workspace.server" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.edu-workspace.caddy" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENTS/com.edu-workspace.server.plist"
launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENTS/com.edu-workspace.caddy.plist"

echo "LAN services installed and started."
echo "Open: http://$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1)/"
