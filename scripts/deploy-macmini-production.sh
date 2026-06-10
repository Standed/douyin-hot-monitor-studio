#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${DOUYIN_MONITOR_ROOT:-/Users/xys/work/company/douyin-hot-monitor-studio}"
NODE_HOME="${DOUYIN_NODE_HOME:-/Users/xys/.local/node-v24.14.0}"
LABEL="${DOUYIN_LAUNCHD_LABEL:-company.douyin-hot-monitor-studio}"
DEV_LABEL="${DOUYIN_DEV_LAUNCHD_LABEL:-company.douyin-hot-monitor-studio.dev}"
PLIST="${DOUYIN_PLIST:-/Users/xys/Library/LaunchAgents/${LABEL}.plist}"
DEV_PLIST="${DOUYIN_DEV_PLIST:-/Users/xys/Library/LaunchAgents/${DEV_LABEL}.plist}"
TEMPLATE="${ROOT_DIR}/ops/launchd/${LABEL}.plist"
HOST="${DOUYIN_HOST:-127.0.0.1}"
UI_PORT="${DOUYIN_UI_PORT:-5174}"

export PATH="${NODE_HOME}/bin:/Users/xys/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "${ROOT_DIR}/douyin-monitor-ui"

echo "Using node: $(command -v node) ($(node -v))"
echo "Using npm: $(command -v npm) ($(npm -v))"
echo "Root dir: ${ROOT_DIR}"

if [[ ! -d node_modules ]]; then
  npm ci
fi

npm run lint
npm run build

mkdir -p /Users/xys/logs/douyin-hot-monitor-studio
cp "${TEMPLATE}" "${PLIST}"
plutil -lint "${PLIST}"

launchctl bootout "gui/$(id -u)" "${DEV_PLIST}" 2>/dev/null || launchctl remove "${DEV_LABEL}" 2>/dev/null || true
launchctl bootout "gui/$(id -u)" "${PLIST}" 2>/dev/null || launchctl remove "${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"
sleep 5

curl -fsS -o /dev/null -w "GET / -> %{http_code}\n" "http://${HOST}:${UI_PORT}/"
curl -fsS -o /dev/null -w "GET /api/dashboard -> %{http_code}\n" "http://${HOST}:${UI_PORT}/api/dashboard"

echo "LaunchAgent status:"
launchctl list | grep "${LABEL}" || true

echo "Douyin monitor production deploy finished."
