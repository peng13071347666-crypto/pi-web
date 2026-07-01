import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/**
 * POST /api/multimodal-proxy/apply
 * Body: { sessionId: string, provider: string, modelId: string, consent?: boolean, mode?: string, tool?: string }
 *
 * Pushes a config change into an ACTIVE in-process pi session by sending the
 * extension's own slash commands. This is the only way to update the running
 * process's in-memory _fileConfig — the extension caches the file contents at
 * process start, so file edits alone have no effect on sessions that started
 * before the edit.
 *
 * inner.prompt() recognises extension slash-commands (agent-session.js
 * _tryExecuteExtensionCommand) and executes them synchronously — writing the
 * file, updating _fileConfig, and appending a session entry — WITHOUT sending
 * anything to the LLM. We await each call so ordering (model before consent)
 * is guaranteed.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      sessionId?: string;
      provider?: string;
      modelId?: string;
      consent?: boolean;
      mode?: string;
      tool?: string;
      videoProvider?: string;
      videoModelId?: string;
      includeContext?: boolean;
    };
    const { sessionId, provider, modelId, consent, mode, tool, videoProvider, videoModelId, includeContext } = body;
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    const session = getRpcSession(sessionId);
    if (!session || !session.isAlive()) {
      return NextResponse.json(
        { error: "No active session with that id. Start a session first, or the change will apply to new sessions only." },
        { status: 404 },
      );
    }

    const commands: string[] = [];
    // Mode first so the subsequent model/consent land in the right state.
    if (mode) commands.push(`/multimodal-proxy ${mode}`);
    if (provider && modelId) commands.push(`/multimodal-proxy model ${provider}/${modelId}`);
    if (videoProvider && videoModelId) commands.push(`/multimodal-proxy video-model ${videoProvider}/${videoModelId}`);
    if (tool) commands.push(`/multimodal-proxy tool ${tool}`);
    if (includeContext !== undefined) commands.push(`/multimodal-proxy context ${includeContext ? "on" : "off"}`);
    if (consent) commands.push(`/multimodal-proxy consent yes`);

    const applied: string[] = [];
    for (const cmd of commands) {
      try {
        await session.inner.prompt(cmd);
        applied.push(cmd);
      } catch (e) {
        // Keep going — a later command (e.g. consent) may still succeed and be useful.
        applied.push(`${cmd} (error: ${e instanceof Error ? e.message : String(e)})`);
      }
    }
    return NextResponse.json({ success: true, applied });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
