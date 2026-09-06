#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_DIR="/tmp/edu-workspace-auto-deploy.lock"
LOG_FILE="/tmp/edu-workspace-auto-deploy.log"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  print -r -- "[deploy] Another deployment is already running; skipped."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

log() {
  print -r -- "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

info() {
  print -r -- "[deploy] $*"
  log "$*"
}

fail() {
  print -r -- "[deploy] FAILED: $*" >&2
  log "FAILED: $*"
  print -r -- "[deploy] Details: $LOG_FILE" >&2
  exit 1
}

cd "$ROOT_DIR"

if [[ "$(git branch --show-current)" != "main" ]]; then
  info "Skipped: current branch is not main"
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  info "Skipped: working tree is not clean"
  exit 0
fi

info "Checking origin/main..."
git fetch origin main >> "$LOG_FILE" 2>&1 || fail "Unable to fetch origin/main"
LOCAL_COMMIT="$(git rev-parse main)"
REMOTE_COMMIT="$(git rev-parse origin/main)"
if [[ "$LOCAL_COMMIT" == "$REMOTE_COMMIT" ]]; then
  info "Already up to date (${LOCAL_COMMIT:0:8}). No deployment needed."
  exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL_COMMIT" "$REMOTE_COMMIT"; then
  info "Skipped: local main is ahead of or diverged from origin/main"
  exit 0
fi

info "New commit found: ${LOCAL_COMMIT:0:8} -> ${REMOTE_COMMIT:0:8}"
info "Pulling main..."
git pull --ff-only origin main >> "$LOG_FILE" 2>&1 || fail "Git pull failed"
info "Building server and client..."
npm run build >> "$LOG_FILE" 2>&1 || fail "Build failed"
info "Restarting production services..."
./scripts/start-lan-service.sh >> "$LOG_FILE" 2>&1 || fail "Service restart failed"
info "Checking production health..."
curl -fsS http://127.0.0.1:4000/api/health >> "$LOG_FILE" 2>&1 || fail "Backend health check failed"
curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1 || fail "Caddy health check failed"
info "Deployment completed successfully. Site: http://$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1):5173"
