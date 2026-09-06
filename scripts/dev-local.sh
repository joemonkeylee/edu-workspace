#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/scripts/stop-lan-service.sh"
restore_production() {
  echo "Restoring production LAN services..."
  "$ROOT_DIR/scripts/start-lan-service.sh" || true
}
trap restore_production EXIT INT TERM

cd "$ROOT_DIR"
npm run dev
