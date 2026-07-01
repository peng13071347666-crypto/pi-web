import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

/**
 * Persistent config for the pi-multimodal-proxy extension.
 * Path: <agentDir>/multimodal-proxy.json  (same file the extension reads at
 * session_start — see pi-multimodal-proxy/extensions/internal.ts
 * getPersistentConfigPath).
 *
 * NOTE: editing this file alone does NOT update a running pi-web process's
 * in-memory config, because vision-proxy reads the file once at process start
 * and caches it in a module-level _fileConfig. Use the sibling /apply route to
 * push the change into an active session via slash commands.
 */
function getConfigPath(): string {
  return join(getAgentDir(), "multimodal-proxy.json");
}

function readConfig(): Record<string, unknown> {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeConfig(data: Record<string, unknown>): void {
  const path = getConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// GET /api/multimodal-proxy — current persisted config
export async function GET() {
  return NextResponse.json(readConfig());
}

// PUT /api/multimodal-proxy — overwrite config. Body = full config object.
export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeConfig(body);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
