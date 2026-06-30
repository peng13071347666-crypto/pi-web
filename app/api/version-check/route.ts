import { NextResponse } from "next/server";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { runVersionCheck } from "@/lib/version-check";

export const dynamic = "force-dynamic";

// GET /api/version-check
// Returns the compatibility diagnosis between pi-web's bundled pi-coding-agent
// and the ~/.pi/agent data directory / global pi CLI. Surfaced as a banner in
// the UI and readable by the agent so it can self-upgrade pi-web.
//
// Response shape: see VersionCheckResult in lib/version-check.ts.
export async function GET() {
  try {
    // pi-web package root = directory above this file's app/api/... tree.
    // __dirname for a compiled route is .next/server/app/api/version-check,
    // which is NOT the source root. Use process.cwd() instead — `next start`
    // runs with cwd = the pi-web package dir (set by bin/pi-web.js).
    const piWebRoot = process.cwd();
    const agentDir = getAgentDir();
    const result = runVersionCheck(piWebRoot, agentDir);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { status: "error", messages: [String(error)], remediation: [] },
      { status: 500 },
    );
  }
}

// Keep the helper import explicit so bundlers don't tree-shake the path join.
void join;
