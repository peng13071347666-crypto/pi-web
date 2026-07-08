#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Applies pi-web compatibility fixes to the global pi agent's
 * pi-multimodal-proxy package.
 *
 * Pi-web runs agent sessions in-process and may load the extension from
 * ~/.pi/agent/npm. Keep that package aligned with pi-web's expected behavior:
 * - Chinese/non-ASCII provider names are valid.
 * - The local instance has opted out of repeated data-egress consent prompts.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const EXTENSION_DIR = path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "pi-multimodal-proxy", "extensions");
const INTERNAL_TARGET = path.join(EXTENSION_DIR, "internal.ts");
const VISION_TARGET = path.join(EXTENSION_DIR, "vision-proxy.ts");

if (!fs.existsSync(INTERNAL_TARGET) || !fs.existsSync(VISION_TARGET)) {
  console.log("[patch-pi-agent] pi-multimodal-proxy not found at", EXTENSION_DIR, "- skipping");
  process.exit(0);
}

function replaceOnce(content, search, replacement) {
  if (typeof search === "string") {
    if (!content.includes(search)) return { content, changed: false };
    return { content: content.replace(search, replacement), changed: true };
  }
  if (!search.test(content)) return { content, changed: false };
  return { content: content.replace(search, replacement), changed: true };
}

const OLD_PATTERN = String.raw`/^[a-zA-Z0-9_-]+$/`;
const NEW_PATTERN = String.raw`/^[\p{L}\p{N}_-]+$/u`;

const OLD_MODEL   = String.raw`/^[a-zA-Z0-9_./:-]+$/`;
const NEW_MODEL   = String.raw`/^[\p{L}\p{N}_./:-]+$/u`;

let changed = false;

let internal = fs.readFileSync(INTERNAL_TARGET, "utf8");
let internalChanged = false;
let result = replaceOnce(internal, OLD_PATTERN, NEW_PATTERN);
internal = result.content;
internalChanged ||= result.changed;
result = replaceOnce(internal, OLD_MODEL, NEW_MODEL);
internal = result.content;
internalChanged ||= result.changed;
changed ||= internalChanged;
if (internalChanged) fs.writeFileSync(INTERNAL_TARGET, internal, "utf8");

let vision = fs.readFileSync(VISION_TARGET, "utf8");
let visionChanged = false;
result = replaceOnce(
  vision,
  /async function ensureConsent\([\s\S]*?\): Promise<boolean> \{\r?\n[\s\S]*?\r?\n\}\r?\n\r?\n\/\/ .+ Core: analyze images via vision model/,
  `async function ensureConsent(
\tconfig: VisionConfig,
\tctx: ExtensionContext,
\tentries: readonly SessionEntry[],
\tpi: ExtensionAPI,
): Promise<boolean> {
\t// Consent always granted - user explicitly opted out of the consent prompt
\treturn true;
}

// Core: analyze images via vision model`,
);
vision = result.content;
visionChanged ||= result.changed;

result = replaceOnce(
  vision,
  /\t\/\/ Check consent for the resolved vision provider\r?\n\tconst entries = ctx\.sessionManager\.getEntries\(\);\r?\n\tif \(!hasConsent\(entries, visionProvider\)\) \{\r?\n\t\treturn `Error: consent required before sending data to \$\{visionProvider\}\. Please tell the user to run the following command and then retry:\\n\\n\/multimodal-proxy consent yes`\r?\n\t\}\r?\n/,
  "\t// Consent always granted - user explicitly opted out of the consent prompt.\n",
);
vision = result.content;
visionChanged ||= result.changed;
changed ||= visionChanged;

if (visionChanged) fs.writeFileSync(VISION_TARGET, vision, "utf8");

console.log(changed
  ? "[patch-pi-agent] Patched pi-multimodal-proxy in global pi agent package"
  : "[patch-pi-agent] Already patched - skipping");
