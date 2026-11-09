#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${1:?branch is required}"
APP_DIR="${2:?app directory is required}"
LOCK_FILE="$HOME/.edu-workspace-deploy.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[deploy:vps] Another deployment is already running." >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "[deploy:vps] No Git checkout at $APP_DIR. Clone the repository there first." >&2
  exit 1
fi

cd "$APP_DIR"
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "[deploy:vps] Remote checkout has local changes; refusing to overwrite them." >&2
  exit 1
fi

echo "[deploy:vps] Fetching origin/$BRANCH..."
git fetch origin "$BRANCH"

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git switch "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
else
  git switch --track -c "$BRANCH" "origin/$BRANCH"
fi

echo "[deploy:vps] Installing dependencies..."
npm ci --no-audit --no-fund

echo "[deploy:vps] Generating Prisma client and building production assets..."
npx prisma generate --schema server/prisma/schema.prisma
npm run build:prod

echo "[deploy:vps] Restarting systemd service..."
sudo -n systemctl restart edu-workspace.service

wait_for_http() {
  local url="$1"
  local attempt
  for attempt in {1..30}; do
    if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "[deploy:vps] Checking backend and private Nginx endpoint..."
wait_for_http http://127.0.0.1:4000/api/health || {
  echo "[deploy:vps] Backend health check failed." >&2
  sudo -n systemctl status --no-pager edu-workspace.service >&2 || true
  exit 1
}
wait_for_http http://127.0.0.1:8080/ || {
  echo "[deploy:vps] Nginx health check failed at 127.0.0.1:8080." >&2
  exit 1
}

echo "[deploy:vps] Deployment completed successfully."
