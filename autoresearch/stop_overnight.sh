#!/bin/bash
# stop_overnight.sh - Stops BhuRakshak Continuous Autoresearch Daemon

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/daemon.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "No daemon PID file found ($PID_FILE). Daemon might not be running."
    exit 0
fi

PID=$(cat "$PID_FILE")
if ps -p "$PID" > /dev/null 2>&1; then
    echo "Stopping autoresearch daemon (PID: $PID)..."
    kill -15 "$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null
    rm -f "$PID_FILE"
    echo "✅ Daemon stopped successfully."
else
    echo "Process $PID is not running. Cleaning up PID file."
    rm -f "$PID_FILE"
fi
