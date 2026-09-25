#!/bin/zsh
set -euo pipefail

# --force / --yes: skip the interactive "not on main" confirmation and deploy anyway.
DEPLOY_FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force|--yes|-f|-y) DEPLOY_FORCE=1 ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_DIR="/tmp/edu-workspace-auto-deploy.lock"
PID_FILE="$LOCK_DIR/pid"
LOG_FILE="/tmp/edu-workspace-auto-deploy.log"

# Try to acquire the lock. If a stale lock exists (owner process gone), reclaim it.
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ > "$PID_FILE"
    return 0
  fi
  local owner_pid
  owner_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$owner_pid" ]] && kill -0 "$owner_pid" 2>/dev/null; then
    return 1
  fi
  # Stale lock — the owner process no longer exists; reclaim it.
  rm -rf "$LOCK_DIR" 2>/dev/null || true
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ > "$PID_FILE"
    return 0
  fi
  return 1
}

if ! acquire_lock; then
  print -r -- "[deploy] Another deployment is already running; skipped."
  exit 0
fi
trap 'if [[ "$(cat "$PID_FILE" 2>/dev/null)" == "$$" ]]; then rm -rf "$LOCK_DIR"; fi' EXIT

log() {
  print -r -- "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

info() {
  print -r -- "[deploy] $*"
  log "$*"
}

wait_for_http() {
  local url="$1"
  local attempts=0
  while (( attempts < 15 )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

fail() {
  print -r -- "[deploy] FAILED: $*" >&2
  log "FAILED: $*"
  print -r -- "[deploy] Details: $LOG_FILE" >&2
  exit 1
}

cd "$ROOT_DIR"

CURRENT_BRANCH="$(git branch --show-current)"
DEPLOY_BRANCH="$CURRENT_BRANCH"

if [[ "$CURRENT_BRANCH" != "main" ]]; then
  if [[ "$DEPLOY_FORCE" == "1" ]]; then
    info "Current branch is '$CURRENT_BRANCH' (not main); --force set, will deploy this branch."
  elif [[ -t 0 ]]; then
    print -r -- "[deploy] [警告] 当前分支不是 main（而是 '$CURRENT_BRANCH'）。"
    print -rn -- "[deploy] 仍要发布该分支吗？[y/N] "
    read -r ans || ans=""
    case "$ans" in
      y|Y|yes|YES|是) info "Proceeding to deploy branch '$CURRENT_BRANCH'." ;;
      *) info "Skipped: 用户取消发布非 main 分支。"; exit 0 ;;
    esac
  else
    info "Skipped: current branch is not main and no interactive TTY to confirm."
    exit 0
  fi
fi

info "Checking origin/$DEPLOY_BRANCH..."
git fetch origin "$DEPLOY_BRANCH" >> "$LOG_FILE" 2>&1 || fail "Unable to fetch origin/$DEPLOY_BRANCH"
LOCAL_COMMIT="$(git rev-parse "$DEPLOY_BRANCH")"
REMOTE_COMMIT="$(git rev-parse "origin/$DEPLOY_BRANCH")"
BUILT_COMMIT="$(cat client/dist/build-commit.txt 2>/dev/null || true)"
NEEDS_BUILD=false
if [[ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]]; then
  NEEDS_BUILD=true
elif [[ "$BUILT_COMMIT" != "${LOCAL_COMMIT:0:8}" ]]; then
  NEEDS_BUILD=true
  info "Source is current, but the deployed build is ${BUILT_COMMIT:-missing}; rebuilding for ${LOCAL_COMMIT:0:8}."
else
  info "Already up to date (${LOCAL_COMMIT:0:8}). No deployment needed."
  exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL_COMMIT" "$REMOTE_COMMIT"; then
  info "Skipped: local $DEPLOY_BRANCH is ahead of or diverged from origin/$DEPLOY_BRANCH"
  exit 0
fi

if [[ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]]; then
  info "New commit found: ${LOCAL_COMMIT:0:8} -> ${REMOTE_COMMIT:0:8}"
  info "Pulling $DEPLOY_BRANCH (local changes will be auto-stashed and restored)..."
  git pull --ff-only --autostash origin "$DEPLOY_BRANCH" >> "$LOG_FILE" 2>&1 || fail "Git pull failed"
fi
# `npm install` is idempotent and cheap when nothing changed, so it is safe to run
# on every deploy: without it, a commit that only adds a dependency to
# package.json leaves node_modules stale and the build fails with TS2307.
info "Installing dependencies..."
npm install --no-audit --no-fund >> "$LOG_FILE" 2>&1 || fail "Dependency install failed"
info "Building server and client..."
npm run build >> "$LOG_FILE" 2>&1 || fail "Build failed"
info "Restarting production services..."
./scripts/start-lan-service.sh >> "$LOG_FILE" 2>&1 || fail "Service restart failed"
info "Checking production health..."
wait_for_http http://127.0.0.1:4000/api/health || fail "Backend health check failed"
wait_for_http http://127.0.0.1:5173/ || fail "Caddy health check failed"
info "Deployment completed successfully. Site: http://$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1):5173"
