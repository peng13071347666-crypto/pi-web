#!/bin/bash
# pi-web launcher - reliable startup on Windows (Git Bash / MSYS2)
# Usage: bash start.sh          -> start with browser
#        bash start.sh --quiet  -> start without opening browser

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=30141
QUIET=false
[[ "$1" == "--quiet" ]] && QUIET=true

echo "========================================"
echo "  pi-web Server Launcher"
echo "========================================"

# 1. Check port and kill old process
echo ""
echo "[1/3] Checking port $PORT..."
OLD_PID=$(netstat -ano 2>/dev/null | grep ":$PORT " | grep "LISTENING" | awk '{print $NF}' | head -1)
if [ -n "$OLD_PID" ]; then
    echo "  Port in use by PID $OLD_PID, stopping..."
    taskkill //PID "$OLD_PID" //F >/dev/null 2>&1
    sleep 2
    echo "  Old process stopped."
else
    echo "  Port is free."
fi

# 2. Start server in background
echo ""
echo "[2/3] Starting pi-web..."
cd "$SCRIPT_DIR"
nohup node bin/pi-web.js > /tmp/pi-web.log 2>&1 &
PID=$!
disown $PID 2>/dev/null || true
echo "  Process started (PID: $PID)"

# 3. Wait for server to be ready
echo ""
echo "[3/3] Waiting for server to be ready..."
for i in $(seq 1 30); do
    sleep 1
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --noproxy "*" "http://127.0.0.1:$PORT" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo "  Server ready! (took ${i}s)"
        break
    fi
    if [ $((i % 5)) -eq 0 ]; then
        echo "  Still waiting... ($i/30 sec)"
    fi
done

if [ "$HTTP_CODE" != "200" ]; then
    echo ""
    echo "  WARNING: Server may have failed to start."
    echo "  Check log: /tmp/pi-web.log"
    echo "  Or run manually: cd \"$SCRIPT_DIR\" && node bin/pi-web.js"
    exit 1
fi

# 4. Warm up agent engine (pre-load extensions, skills, models, model registry)
# Fire-and-forget in background — triggers module loading without blocking
{
    echo ""
    echo "[4/5] Warming up agent engine..."
    # Use a simple validation request to trigger module loading
    curl -s --noproxy "*" "http://127.0.0.1:$PORT/api/models" -o /dev/null 2>/dev/null &
    echo "  Pre-loading in background..."
}

# 5. Open browser
if [ "$QUIET" = false ]; then
    echo ""
    echo "[5/5] Opening browser..."
    cmd.exe //c start http://localhost:$PORT 2>/dev/null || true
fi

echo ""
echo "========================================"
echo "  pi-web running: http://localhost:$PORT"
echo "========================================"

# In quiet mode or normal mode, exit after startup
# Server runs detached — no need to keep this window open
if [ "$QUIET" = true ]; then
    exit 0
fi

echo ""
echo "You can safely close this window. Server is running in background."
sleep 3
exit 0
