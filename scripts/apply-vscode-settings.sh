#!/bin/bash
# Apply VS Code settings to prevent crashes from large storage/dist dirs.
# Run this from your own terminal (NOT inside VS Code), then restart VS Code.

SETTINGS="/Users/{user}/工作/github/edu-workspace/.vscode/settings.json"

cat > "$SETTINGS" << 'EOF'
{
  "chat.tools.terminal.autoApprove": {
    "npx prisma": true,
    "git add": true,
    "git commit": true
  },
  "files.watcherExclude": {
    "**/.git/objects/**": true,
    "**/.git/subtree-cache/**": true,
    "**/node_modules/**": true,
    "**/dist/**": true,
    "**/server/storage/**": true
  },
  "search.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/server/storage": true
  },
  "files.exclude": {
    "**/dist": false
  },
  "github.copilot.chat.workspace.indexing.enabled": false
}
EOF

echo "✅ settings.json updated. Contents:"
cat "$SETTINGS"
echo ""
echo "⚠️  Now FULLY quit VS Code (Cmd+Q) and reopen the project."
