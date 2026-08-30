#!/bin/bash
# start_overnight.sh - Launches BhuRakshak Continuous Autoresearch Daemon

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$SCRIPT_DIR/daemon.log"
PID_FILE="$SCRIPT_DIR/daemon.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "Autoresearch daemon is already running (PID: $PID)."
        echo "Logs: tail -f $LOG_FILE"
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
if [ ! -f "$PYTHON_BIN" ]; then
    PYTHON_BIN="python3"
fi

export PYTHONUNBUFFERED=1

echo "Starting BhuRakshak continuous autoresearch daemon..."
nohup "$PYTHON_BIN" -u "$SCRIPT_DIR/run_loop.py" --iterations 0 --delay 0.5 >> "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

echo "✅ Daemon successfully started with PID: $NEW_PID"
echo "📄 Streaming logs available at: $LOG_FILE"
echo "📊 Check status anytime with: $PYTHON_BIN $SCRIPT_DIR/status.py"
