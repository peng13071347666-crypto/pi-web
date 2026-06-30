import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { basename, extname, join } from "path";

export const dynamic = "force-dynamic";

interface AgentInfo {
  name: string;
  description: string;
  filePath: string;
  enabled: boolean;
  tools?: string;
  model?: string;
  source: "global" | "project";
}

// Recursively find all .md files in a directory
function findMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const st = statSync(fullPath);
        if (st.isDirectory()) {
          results.push(...findMdFiles(fullPath));
        } else if (st.isFile() && entry.endsWith(".md")) {
          results.push(fullPath);
        }
      } catch {
        // skip unreadable entries
      }
    }
  } catch {
    // skip unreadable directories
  }
  return results;
}

// GET /api/agents?cwd=<path>
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const agentDir = getAgentDir();
    const globalAgentsDir = join(agentDir, "agents");
    const projectAgentsDir = join(cwd, ".pi", "agents");

    const agents: AgentInfo[] = [];

    // Scan global agents (~/.pi/agent/agents/*.md)
    const globalFiles = findMdFiles(globalAgentsDir);
    for (const filePath of globalFiles) {
      try {
        const content = readFileSync(filePath, "utf8");
        const { frontmatter } = parseFrontmatter<{
          name?: string;
          description?: string;
          tools?: string;
          model?: string;
          disabled?: boolean;
        }>(content);

        const name = frontmatter.name ?? basename(filePath, extname(filePath));
        agents.push({
          name,
          description: frontmatter.description ?? "",
          filePath,
          enabled: !frontmatter.disabled,
          tools: frontmatter.tools,
          model: frontmatter.model,
          source: "global",
        });
      } catch {
        // skip unreadable files
      }
    }

    // Scan project agents (.pi/agents/*.md)
    const projectFiles = findMdFiles(projectAgentsDir);
    for (const filePath of projectFiles) {
      try {
        const content = readFileSync(filePath, "utf8");
        const { frontmatter } = parseFrontmatter<{
          name?: string;
          description?: string;
          tools?: string;
          model?: string;
          disabled?: boolean;
        }>(content);

        const name = frontmatter.name ?? basename(filePath, extname(filePath));
        agents.push({
          name,
          description: frontmatter.description ?? "",
          filePath,
          enabled: !frontmatter.disabled,
          tools: frontmatter.tools,
          model: frontmatter.model,
          source: "project",
        });
      } catch {
        // skip unreadable files
      }
    }

    // Sort: global first, then alphabetical
    agents.sort((a, b) => {
      if (a.source !== b.source) return a.source === "global" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ agents });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PATCH /api/agents — toggle enabled or update frontmatter fields
// Body: { filePath, enabled? } or { filePath, updates?: { model?, tools?, description? } }
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as {
      filePath: string;
      enabled?: boolean;
      updates?: Record<string, string | null>;
    };
    const { filePath, enabled, updates } = body;
    if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    if (!existsSync(filePath)) return NextResponse.json({ error: "file not found" }, { status: 404 });

    const content = readFileSync(filePath, "utf8");
    let updated = content;

    // Handle enabled toggle
    if (enabled !== undefined) {
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
      const alreadyDisabled = frontmatter["disabled"] === true;

      if (!enabled && !alreadyDisabled) {
        updated = updated.replace(/^---\r?\n/, `---\ndisabled: true\n`);
        if (updated === content) updated = `---\ndisabled: true\n---\n${content}`;
      } else if (enabled && alreadyDisabled) {
        updated = updated.replace(new RegExp(`^disabled\\s*:.*\\r?\\n`, "m"), "");
      }
    }

    // Handle field updates (model, tools, description)
    if (updates) {
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const pattern = new RegExp(`^${escapedKey}\\s*:.*\\r?\\n`, "m");
          if (value === null || value === "") {
            // Remove the field entirely
            updated = updated.replace(pattern, "");
          } else if (pattern.test(updated)) {
            // Update existing field
            updated = updated.replace(pattern, `${key}: ${value}\n`);
          } else {
            // Add new field after opening ---
            updated = updated.replace(/^---\r?\n/, `---\n${key}: ${value}\n`);
          }
        }
      }
    }

    writeFileSync(filePath, updated, "utf8");
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
