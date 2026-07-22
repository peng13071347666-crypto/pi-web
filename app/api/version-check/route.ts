import { NextResponse } from "next/server";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { runVersionCheck, compareVersions } from "@/lib/version-check";

export const dynamic = "force-dynamic";

// Cache the npm latest version check (avoid hitting registry on every request)
let npmCache: { version: string; timestamp: number } | null = null;
const NPM_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getLatestNpmVersion(pkg: string): Promise<string | null> {
  if (npmCache && Date.now() - npmCache.timestamp < NPM_CACHE_TTL) {
    return npmCache.version;
  }
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { version?: string };
    if (data.version) {
      npmCache = { version: data.version, timestamp: Date.now() };
      return data.version;
    }
    return null;
  } catch {
    return null;
  }
}

// GET /api/version-check
// Returns the compatibility diagnosis between pi-web's bundled pi-coding-agent
// and the ~/.pi/agent data directory / global pi CLI. Surfaced as a banner in
// the UI and readable by the agent so it can self-upgrade pi-web.
//
// Response shape: see VersionCheckResult in lib/version-check.ts.
export async function GET() {
  try {
    const piWebRoot = process.cwd();
    const agentDir = getAgentDir();
    const result = runVersionCheck(piWebRoot, agentDir);

    // Check npm registry for the latest available version
    const latestVersion = await getLatestNpmVersion("@earendil-works/pi-coding-agent");
    // Check if update is available for either global CLI or bundled SDK
    const globalVersion = result.globalPiVersion;
    const currentVersion = globalVersion ?? result.bundledPiVersion;
    const updateAvailable = latestVersion
      ? compareVersions(latestVersion, currentVersion) > 0
      : false;

    return NextResponse.json({
      ...result,
      latestVersion,
      updateAvailable,
    });
  } catch (error) {
    return NextResponse.json(
      { status: "error", messages: [String(error)], remediation: [] },
      { status: 500 },
    );
  }
}

// Keep the helper import explicit so bundlers don't tree-shake the path join.
void join;
