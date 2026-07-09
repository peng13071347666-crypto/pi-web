import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, getRuntimePolicy, startRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
// Default: only attaches to an already-live session (does not create AgentSession).
// Legacy: set PI_WEB_SSE_AUTOSTART=1 to restore auto-start on connect.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const policy = getRuntimePolicy();

  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    if (!policy.sseAutostart) {
      // Lightweight idle stream: client learns session is not live without warming agent.
      const idleStream = new ReadableStream({
        start(controller) {
          const encode = (data: unknown) => {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
          };
          encode({ type: "idle", sessionId: id });
          // Keep connection briefly so EventSource gets the event, then close.
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // already closed
            }
          }, 50);
        },
      });
      return new Response(idleStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    try {
      ({ session } = await startRpcSession(id, filePath, cwd));
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      const unsubscribe = session.onEvent((event) => {
        encode(event);
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      // Heartbeats do NOT count as agent activity / idle reset.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Cleanup when client disconnects
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
