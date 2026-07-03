import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const beforeEntryId = url.searchParams.get("beforeEntryId");

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = SessionManager.open(filePath);
    const context = buildSessionContext(sm.getEntries() as never, leafId);
    const limit = limitParam ? Math.max(1, Math.min(1000, Number(limitParam) || 200)) : null;

    if (limit) {
      const beforeIndex = beforeEntryId
        ? context.entryIds.findIndex((entryId) => entryId === beforeEntryId)
        : -1;
      const end = beforeEntryId && beforeIndex >= 0 ? beforeIndex : context.messages.length;
      const start = Math.max(0, end - limit);
      const hasMoreBefore = start > 0;
      return NextResponse.json({
        context: {
          ...context,
          messages: context.messages.slice(start, end),
          entryIds: context.entryIds.slice(start, end),
        },
        page: {
          hasMoreBefore,
          beforeEntryId: hasMoreBefore ? context.entryIds[start] : null,
        },
      });
    }

    return NextResponse.json({ context });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
