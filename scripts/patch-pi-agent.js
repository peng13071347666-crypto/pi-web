#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Applies the pi-multimodal-proxy Unicode provider fix to the global pi agent's
 * node_modules. This is needed because pi-web runs agent sessions in-process,
 * and the extension loaded by the pi agent reads config at session_start.
 *
 * Without this patch, Chinese/non-ASCII provider names are silently rejected
 * by PROVIDER_PATTERN and the vision proxy falls back to DEFAULT_CONFIG.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const TARGET = path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "pi-multimodal-proxy", "extensions", "internal.ts");

if (!fs.existsSync(TARGET)) {
  console.log("[patch-pi-agent] pi-multimodal-proxy not found at", TARGET, "- skipping");
  process.exit(0);
}

let content = fs.readFileSync(TARGET, "utf8");

const OLD_PATTERN = String.raw`/^[a-zA-Z0-9_-]+$/`;
const NEW_PATTERN = String.raw`/^[\p{L}\p{N}_-]+$/u`;

const OLD_MODEL   = String.raw`/^[a-zA-Z0-9_./:-]+$/`;
const NEW_MODEL   = String.raw`/^[\p{L}\p{N}_./:-]+$/u`;

let changed = false;

if (content.includes(OLD_PATTERN)) {
  content = content.replace(OLD_PATTERN, NEW_PATTERN);
  changed = true;
}
if (content.includes(OLD_MODEL)) {
  content = content.replace(OLD_MODEL, NEW_MODEL);
  changed = true;
}

if (!changed) {
  console.log("[patch-pi-agent] Already patched - skipping");
  process.exit(0);
}

fs.writeFileSync(TARGET, content, "utf8");
console.log("[patch-pi-agent] Patched PROVIDER_PATTERN in", TARGET);
