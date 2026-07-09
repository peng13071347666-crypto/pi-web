import { NextResponse } from "next/server";
import { getRuntimePolicy, listLiveRpcSessions, releaseRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/runtime — live session registry + policy (debug / status)
export async function GET() {
  return NextResponse.json({
    policy: getRuntimePolicy(),
    live: listLiveRpcSessions(),
  });
}

// POST /api/agent/runtime  body: { action: "release", sessionId: string }
// Explicitly dispose a live AgentSession without deleting the session file.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { action?: string; sessionId?: string };
    if (body.action !== "release" || !body.sessionId) {
      return NextResponse.json({ error: "action 'release' and sessionId required" }, { status: 400 });
    }
    const released = releaseRpcSession(body.sessionId);
    return NextResponse.json({ success: true, released });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
