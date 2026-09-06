#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_DIR="/tmp/edu-workspace-auto-deploy.lock"
LOG_FILE="/tmp/edu-workspace-auto-deploy.log"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

log() {
  print -r -- "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

cd "$ROOT_DIR"

if [[ "$(git branch --show-current)" != "main" ]]; then
  log "Skipped: current branch is not main"
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  log "Skipped: working tree is not clean"
  exit 0
fi

git fetch origin main >> "$LOG_FILE" 2>&1
LOCAL_COMMIT="$(git rev-parse main)"
REMOTE_COMMIT="$(git rev-parse origin/main)"
if [[ "$LOCAL_COMMIT" == "$REMOTE_COMMIT" ]]; then
  exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL_COMMIT" "$REMOTE_COMMIT"; then
  log "Skipped: local main is ahead of or diverged from origin/main"
  exit 0
fi

log "Deploying $LOCAL_COMMIT -> $REMOTE_COMMIT"
git pull --ff-only origin main >> "$LOG_FILE" 2>&1
npm run build >> "$LOG_FILE" 2>&1
./scripts/start-lan-service.sh >> "$LOG_FILE" 2>&1
log "Deploy completed"
