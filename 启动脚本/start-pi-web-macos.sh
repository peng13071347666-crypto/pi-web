#!/bin/bash
set -euo pipefail

# pi-web macOS launcher / keeper
# Usage:
#   ./start-pi-web-macos.sh           start (or restart if stale) and open browser
#   ./start-pi-web-macos.sh stop      stop the background service
#   ./start-pi-web-macos.sh status    check whether it is responding
#   ./start-pi-web-macos.sh launchd   foreground mode for launchd (keeps service alive)

PORT=30141
URL="http://localhost:${PORT}/"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NEXT_BIN="${PROJECT_DIR}/node_modules/next/dist/bin/next"
BUILD_DIR="${PROJECT_DIR}/.next"
BUILD_ID_FILE="${BUILD_DIR}/BUILD_ID"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
STATE_DIR="${SCRIPT_DIR}/state"
STDOUT_LOG="${LOG_DIR}/pi-web-${PORT}.out.log"
STDERR_LOG="${LOG_DIR}/pi-web-${PORT}.err.log"
PID_FILE="${STATE_DIR}/pi-web-${PORT}.pid"

NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"

# Verify node exists, fall back to PATH if the hard-coded path is missing
if [[ ! -x "${NODE_BIN}" ]]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [[ ! -x "${NODE_BIN}" ]]; then
  echo "ERROR: node executable not found. Set NODE_BIN or add node to PATH."
  exit 1
fi

# Ensure child processes (Pi Agent SDK) can find npm/npx.
# launchd starts with a minimal PATH; homebrew binaries must be added explicitly.
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"

is_ready() {
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --noproxy "*" "${URL}" 2>/dev/null || true)
  [[ "${code}" == 2* || "${code}" == 3* ]]
}

get_port_pids() {
  lsof -ti tcp:"${PORT}" 2>/dev/null || true
}

stop_stale_port_owners() {
  local pids
  pids=$(get_port_pids)
  if [[ -n "${pids}" ]]; then
    echo "Stopping stale processes on port ${PORT}: ${pids}"
    kill -TERM ${pids} 2>/dev/null || true
    sleep 2
    kill -KILL $(lsof -ti tcp:"${PORT}" 2>/dev/null) 2>/dev/null || true
  fi
}

stop_recorded() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid=$(cat "${PID_FILE}" 2>/dev/null || true)
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "Stopping recorded pi-web launcher (PID ${pid})..."
      kill -TERM "${pid}" 2>/dev/null || true
      sleep 1
      kill -KILL "${pid}" 2>/dev/null || true
    fi
    rm -f "${PID_FILE}"
  fi
}

case "${1:-start}" in
  status)
    if is_ready; then
      echo "pi-web is running and responding at ${URL}"
      exit 0
    else
      echo "pi-web is NOT responding at ${URL}"
      exit 1
    fi
    ;;

  stop)
    stop_recorded
    stop_stale_port_owners
    echo "pi-web stopped."
    exit 0
    ;;

  start|""|restart|launchd)
    IS_LAUNCHD=false
    if [[ "${1:-start}" == "launchd" ]]; then
      IS_LAUNCHD=true
    fi

    if ! ${IS_LAUNCHD} && is_ready; then
      echo "pi-web is already running at ${URL}"
      open "${URL}"
      exit 0
    fi

    stop_recorded
    stop_stale_port_owners

    if [[ ! -f "${NEXT_BIN}" ]]; then
      echo "ERROR: Next.js not found at ${NEXT_BIN}. Run: cd ${PROJECT_DIR} && npm install"
      exit 1
    fi

    if [[ -f "${BUILD_ID_FILE}" ]]; then
      NEXT_MODE="start"
    else
      NEXT_MODE="dev"
      echo "WARNING: no build found; starting in dev mode. For production-like stability run: cd ${PROJECT_DIR} && npm run build"
    fi

    # Rotate logs
    [[ -f "${STDOUT_LOG}" ]] && mv "${STDOUT_LOG}" "${STDOUT_LOG}.prev"
    [[ -f "${STDERR_LOG}" ]] && mv "${STDERR_LOG}" "${STDERR_LOG}.prev"

    echo "Starting pi-web (next ${NEXT_MODE}) on port ${PORT}..."
    echo "Logs:"
    echo "  ${STDOUT_LOG}"
    echo "  ${STDERR_LOG}"

    if ${IS_LAUNCHD}; then
      # Foreground mode: launchd monitors this process and restarts on crash.
      exec "${NODE_BIN}" "${NEXT_BIN}" "${NEXT_MODE}" -p "${PORT}" \
        > "${STDOUT_LOG}" 2> "${STDERR_LOG}"
    else
      nohup "${NODE_BIN}" "${NEXT_BIN}" "${NEXT_MODE}" -p "${PORT}" \
        > "${STDOUT_LOG}" 2> "${STDERR_LOG}" &
      echo $! > "${PID_FILE}"
    fi

    for i in $(seq 1 45); do
      if ! ${IS_LAUNCHD} && ! kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
        echo "ERROR: pi-web exited before becoming ready."
        echo "--- stderr tail ---"
        tail -n 30 "${STDERR_LOG}" 2>/dev/null || true
        exit 1
      fi
      if is_ready; then
        echo "pi-web is ready: ${URL}"
        ${IS_LAUNCHD} || open "${URL}"
        if ${IS_LAUNCHD}; then
          # Keep the script alive so launchd sees the service as running.
          wait "$(cat "${PID_FILE}" 2>/dev/null || echo "")" 2>/dev/null || true
        fi
        exit 0
      fi
      if (( i % 5 == 0 )); then
        echo "Waiting for pi-web... ${i}/45 seconds"
      fi
      sleep 1
    done

    echo "ERROR: pi-web did not respond within 45 seconds."
    echo "PID: $(cat "${PID_FILE}" 2>/dev/null || echo unknown)"
    echo "--- stderr tail ---"
    tail -n 30 "${STDERR_LOG}" 2>/dev/null || true
    exit 1
    ;;

  *)
    echo "Usage: $0 [start|stop|restart|status|launchd]"
    exit 1
    ;;
esac
