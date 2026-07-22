import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { DefaultResourceLoader, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

// ============================================================================
// In-memory cache: avoids full filesystem scan on every skills request.
// Invalidated after CACHE_TTL_MS or when ?refresh=1 is passed.
// ============================================================================
const CACHE_TTL_MS = 30_000; // 30 seconds

type SkillsCacheEntry = {
  timestamp: number;
  data: { skills: unknown; diagnostics: unknown };
};

declare global {
  var __piSkillsCache: Map<string, SkillsCacheEntry> | undefined;
}

function getSkillsCache(): Map<string, SkillsCacheEntry> {
  if (!globalThis.__piSkillsCache) globalThis.__piSkillsCache = new Map();
  return globalThis.__piSkillsCache;
}

// GET /api/skills?cwd=<path>
// Uses DefaultResourceLoader (same logic as AgentSession startup) so settings.json
// skill paths, package skills, and .agents/skills directories are all included.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  const forceRefresh = searchParams.get("refresh") === "1";

  // Check cache
  const cache = getSkillsCache();
  if (!forceRefresh) {
    const cached = cache.get(cwd);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }
  }

  try {
    // Include bundled skills shipped with pi-web
    const bundledSkillsDir = join(process.cwd(), "skills");
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      ...(existsSync(bundledSkillsDir) ? { additionalSkillPaths: [bundledSkillsDir] } : {}),
    });
    await loader.reload();
    const { skills, diagnostics } = loader.getSkills();
    const data = { skills, diagnostics };

    // Store in cache
    cache.set(cwd, { timestamp: Date.now(), data });
    // Prevent unbounded growth
    if (cache.size > 10) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PATCH /api/skills — toggle disable-model-invocation on a SKILL.md file
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { filePath: string; disableModelInvocation: boolean };
    const { filePath, disableModelInvocation } = body;
    if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    if (!existsSync(filePath)) return NextResponse.json({ error: "file not found" }, { status: 404 });

    const content = readFileSync(filePath, "utf8");
    const key = "disable-model-invocation";

    // Use parseFrontmatter to check current value, then do a surgical line edit
    // to preserve the original YAML formatting of all other fields.
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
    const alreadySet = Boolean(frontmatter[key]);

    let updated = content;
    if (disableModelInvocation && !alreadySet) {
      // Add key after the opening --- line
      updated = content.replace(/^---\r?\n/, `---\n${key}: true\n`);
      // If no frontmatter exists, create one
      if (updated === content) updated = `---\n${key}: true\n---\n${content}`;
    } else if (!disableModelInvocation && alreadySet) {
      // Remove the key line entirely
      updated = content.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, "m"), "");
    }

    writeFileSync(filePath, updated, "utf8");

    // Invalidate skills cache after modification
    getSkillsCache().clear();

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
