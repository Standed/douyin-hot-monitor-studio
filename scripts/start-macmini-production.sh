#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${DOUYIN_MONITOR_ROOT:-/Users/xys/work/company/douyin-hot-monitor-studio}"
NODE_HOME="${DOUYIN_NODE_HOME:-/Users/xys/.local/node-v24.14.0}"
UI_DIR="${ROOT_DIR}/douyin-monitor-ui"
HOST="${HOST:-127.0.0.1}"
UI_PORT="${DOUYIN_UI_PORT:-5174}"
API_PORT="${DOUYIN_API_PORT:-8787}"

export PATH="${NODE_HOME}/bin:/Users/xys/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOST

cd "${UI_DIR}"

if [[ ! -f "${UI_DIR}/dist/index.html" ]]; then
  echo "Missing ${UI_DIR}/dist/index.html; run npm run build before starting production." >&2
  exit 1
fi

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting Douyin monitor API on http://${HOST}:${API_PORT}"
node server.mjs &
API_PID=$!

echo "Starting Douyin monitor UI on http://${HOST}:${UI_PORT}"
cd "${ROOT_DIR}"
PORT="${UI_PORT}" API_BASE="http://${HOST}:${API_PORT}" node scripts/serve-ui-with-api-proxy.mjs &
UI_PID=$!

while kill -0 "${API_PID}" 2>/dev/null && kill -0 "${UI_PID}" 2>/dev/null; do
  sleep 2
done

wait "${API_PID}" "${UI_PID}"
