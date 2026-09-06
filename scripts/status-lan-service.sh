#!/bin/zsh
set -euo pipefail

for service in com.edu-workspace.server com.edu-workspace.caddy com.edu-workspace.autodeploy; do
  if launchctl print "gui/$(id -u)/$service" >/dev/null 2>&1; then
    echo "$service: running"
  else
    echo "$service: stopped"
  fi
done
