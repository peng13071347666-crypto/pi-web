import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cwd = url.searchParams.get("cwd");
    const limitParam = url.searchParams.get("limit");
    const cursorParam = url.searchParams.get("cursor");
    const limit = limitParam ? Math.max(1, Math.min(500, Number(limitParam) || 100)) : null;
    const cursor = Math.max(0, Number(cursorParam) || 0);
    const allSessions = await listAllSessions();
    const filtered = cwd ? allSessions.filter((session) => session.cwd === cwd) : allSessions;
    const sessions = limit ? filtered.slice(cursor, cursor + limit) : filtered;
    const nextCursor = limit && cursor + limit < filtered.length ? String(cursor + limit) : null;
    return NextResponse.json({ sessions, nextCursor, total: filtered.length });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
