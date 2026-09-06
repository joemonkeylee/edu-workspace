#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_AGENTS"
cp "$ROOT_DIR/deploy/com.edu-workspace.autodeploy.plist" "$LAUNCH_AGENTS/"
launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENTS/com.edu-workspace.autodeploy.plist" 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/com.edu-workspace.autodeploy"
echo "Auto deploy enabled."