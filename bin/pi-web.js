#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const { values: cliArgs } = parseArgs({
  options: {
    port:     { type: "string", short: "p" },
    hostname: { type: "string", short: "H" },
  },
  strict: false,
});

const port     = cliArgs.port     ?? process.env.PORT     ?? "30141";
const hostname = cliArgs.hostname ?? process.env.HOSTNAME ?? null;

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

const nextArgs = ["start", "-p", port];
if (hostname) nextArgs.push("-H", hostname);

// ============================================================================
// Auto-restart logic: if the Next.js process crashes, restart it automatically
// with exponential backoff (max 5 restarts in 60s window).
// ============================================================================
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;
const restartTimestamps = [];
let browserOpened = false;
let shuttingDown = false;

const url = `http://${hostname ?? "localhost"}:${port}`;

function startServer() {
  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env },
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!browserOpened && text.includes("Ready")) {
      browserOpened = true;
      const isWindows = process.platform === "win32";
      const isMac = process.platform === "darwin";
      const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
      spawn(openCmd, [url], { shell: isWindows, stdio: "ignore", detached: true }).unref();
    }
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      process.exit(code ?? 0);
      return;
    }

    // Track restart frequency
    const now = Date.now();
    restartTimestamps.push(now);
    // Remove timestamps outside the window
    while (restartTimestamps.length > 0 && restartTimestamps[0] < now - RESTART_WINDOW_MS) {
      restartTimestamps.shift();
    }

    if (restartTimestamps.length > MAX_RESTARTS) {
      console.error(`[pi-web] Server crashed ${restartTimestamps.length} times in ${RESTART_WINDOW_MS / 1000}s. Giving up.`);
      process.exit(1);
    }

    const delay = Math.min(1000 * Math.pow(2, restartTimestamps.length - 1), 10_000);
    console.error(`[pi-web] Server exited (code=${code}, signal=${signal}). Restarting in ${delay}ms...`);
    setTimeout(() => {
      if (!shuttingDown) startServer();
    }, delay);
  });

  return child;
}

// Graceful shutdown
process.on("SIGINT", () => { shuttingDown = true; process.exit(0); });
process.on("SIGTERM", () => { shuttingDown = true; process.exit(0); });

startServer();
