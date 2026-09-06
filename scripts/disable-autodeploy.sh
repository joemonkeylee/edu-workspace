#!/bin/zsh
set -euo pipefail

launchctl bootout "gui/$(id -u)/com.edu-workspace.autodeploy" 2>/dev/null || true
echo "Auto deploy disabled."