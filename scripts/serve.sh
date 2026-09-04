#!/usr/bin/env bash
# BhuRakshak demo server watchdog — keeps the Next.js server alive.
# If the dev server crashes, this loop restarts it within 3 seconds.
#
# Usage:  bash scripts/serve.sh          (foreground, Ctrl-C to stop)
#         nohup bash scripts/serve.sh >/dev/null 2>&1 &   (background)

cd "$(dirname "$0")/.." || exit 1

PORT="${PORT:-3000}"

echo "[serve] BhuRakshak watchdog starting on port ${PORT} (pid $$)"

while true; do
  # if something is already healthy on the port, don't double-start
  if curl -sf -m 3 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    echo "[serve] server already healthy, supervising…"
    # wait until it dies, then restart
    while curl -sf -m 5 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; do
      sleep 5
    done
    echo "[serve] $(date '+%H:%M:%S') server went DOWN — restarting in 3s"
    sleep 3
  fi

  echo "[serve] $(date '+%H:%M:%S') starting next dev…"
  bun run dev >> dev.log 2>&1 &
  SERVER_PID=$!

  # give it up to 60 s to come up
  for i in $(seq 1 60); do
    if curl -sf -m 2 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
      echo "[serve] server is UP (pid ${SERVER_PID})"
      break
    fi
    sleep 1
  done

  # if the process died immediately, wait a beat before retrying
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[serve] process exited — retrying in 5 s"
    sleep 5
  else
    wait "$SERVER_PID" || true
    echo "[serve] $(date '+%H:%M:%S') server exited — restarting in 3 s"
    sleep 3
  fi
done
