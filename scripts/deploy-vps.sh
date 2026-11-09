#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_SCRIPT="$ROOT_DIR/scripts/deploy-vps-remote.sh"
HOST="${1:-${DEPLOY_VPS_HOST:-}}"
BRANCH="${2:-$(git -C "$ROOT_DIR" branch --show-current)}"
APP_DIR="${VPS_APP_DIR:-/opt/edu-workspace}"

usage() {
  cat <<'EOF'
Usage: npm run deploy:vps -- <ssh-host> [branch]

Examples:
  npm run deploy:vps -- deploy@203.0.113.10
  VPS_APP_DIR=/srv/edu-workspace npm run deploy:vps -- deploy@my-vps main

Environment:
  DEPLOY_VPS_HOST  Default SSH host if omitted
  VPS_APP_DIR      Remote checkout path (default: /opt/edu-workspace)
EOF
}

if [[ -z "$HOST" || -z "$BRANCH" ]]; then
  usage >&2
  exit 2
fi

if [[ ! "$HOST" =~ ^[A-Za-z0-9._@:-]+$ ]]; then
  echo "[deploy:vps] Invalid SSH host. Use a host or SSH config alias without spaces." >&2
  exit 2
fi

if [[ ! "$BRANCH" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ || "$BRANCH" == *".."* ]]; then
  echo "[deploy:vps] Invalid branch name." >&2
  exit 2
fi

if [[ ! "$APP_DIR" =~ ^/[A-Za-z0-9._/-]+$ || "$APP_DIR" == *"/../"* || "$APP_DIR" == */.. ]]; then
  echo "[deploy:vps] VPS_APP_DIR must be an absolute path without spaces or '..' segments." >&2
  exit 2
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "[deploy:vps] ssh is required but was not found." >&2
  exit 1
fi

if [[ ! -f "$REMOTE_SCRIPT" ]]; then
  echo "[deploy:vps] Remote deployment script not found: $REMOTE_SCRIPT" >&2
  exit 1
fi

printf -v REMOTE_COMMAND 'bash -s -- %q %q' "$BRANCH" "$APP_DIR"
echo "[deploy:vps] Deploying branch '$BRANCH' to $HOST:$APP_DIR"
ssh "$HOST" "$REMOTE_COMMAND" < "$REMOTE_SCRIPT"
