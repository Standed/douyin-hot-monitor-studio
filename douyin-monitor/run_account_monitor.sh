#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

cd "$SCRIPT_DIR"
"$PYTHON_BIN" douyin_monitor.py account-run "$@"
