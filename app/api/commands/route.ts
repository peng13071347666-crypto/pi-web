import { NextResponse } from "next/server";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

export interface CommandListing {
  name: string;
  description: string;
  source: "prompt" | "skill" | "extension";
}

// GET /api/commands?cwd=<path>
// Returns slash commands discoverable WITHOUT a live AgentSession: prompt
// templates and skills. Extension commands require a bound session and are
// fetched separately via POST /api/agent/[id] { type: "get_commands" }.
//
// Used by the ChatInput autocomplete so the user can see / pick / commands
// even before sending the first message.
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) {
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }

  try {
    const services = await createAgentSessionServices({ cwd, agentDir: getAgentDir() });
    const loader = services.resourceLoader;

    const commands: CommandListing[] = [];

    // Prompt templates
    try {
      const prompts = loader.getPrompts().prompts;
      for (const p of prompts) {
        commands.push({
          name: p.name,
          description: p.description ?? "",
          source: "prompt",
        });
      }
    } catch { /* ignore */ }

    // Skills (invoked as /skill:<name>)
    try {
      const skills = loader.getSkills().skills;
      for (const s of skills) {
        commands.push({
          name: `skill:${s.name}`,
          description: s.description ?? "",
          source: "skill",
        });
      }
    } catch { /* ignore */ }

    // De-dup by name
    const seen = new Set<string>();
    const deduped = commands.filter((c) =>
      seen.has(c.name) ? false : (seen.add(c.name), true),
    );

    return NextResponse.json({ commands: deduped });
  } catch (error) {
    // If services can't be created (e.g. models.json parse error from a
    // version mismatch), return an empty list rather than 500 — the input bar
    // should still work for plain prompts. The version banner surfaces the
    // real cause separately.
    return NextResponse.json({ commands: [], error: String(error) });
  }
}
