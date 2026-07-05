import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { SessionManager, buildSessionContext as piBuildSessionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, SessionEntry, SessionInfo, SessionContext, SessionTreeNode, AssistantMessage, SessionHeader, UserMessage } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";

export { getAgentDir };

const SESSION_LIST_FIRST_MESSAGE_MAX_CHARS = 200;
const IMAGE_FILE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|heif|tiff?)$/i;

export function getSessionsDir(): string {
  return `${getAgentDir()}/sessions`;
}

type CachedSessionRecord = {
  filePath: string;
  size: number;
  mtimeMs: number;
  info: SessionInfo;
  parentSessionPath?: string;
};

declare global {
  var __piSessionIndexCache: Map<string, CachedSessionRecord> | undefined;
}

function getSessionIndexCache(): Map<string, CachedSessionRecord> {
  if (!globalThis.__piSessionIndexCache) globalThis.__piSessionIndexCache = new Map();
  return globalThis.__piSessionIndexCache;
}

function listJsonlFiles(dir: string): string[] {
  const files: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: import("fs").Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  }

  return files;
}

function getMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text?: unknown } => {
      return !!block && typeof block === "object" && "type" in block && (block as { type?: unknown }).type === "text";
    })
    .map((block) => typeof block.text === "string" ? block.text : "")
    .filter(Boolean)
    .join("\n");
}

function truncateSessionPreview(text: string): string {
  if (text.length <= SESSION_LIST_FIRST_MESSAGE_MAX_CHARS) return text;
  return `${text.slice(0, SESSION_LIST_FIRST_MESSAGE_MAX_CHARS).trimEnd()}...`;
}

function decodeFileAttr(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function cleanSessionPreviewText(text: string): string {
  const fileRefs: string[] = [];
  const cleaned = text.replace(/<file\b([^>]*)>([\s\S]*?)<\/file>|<file\b([^>]*)\/>/gi, (_match, openAttrs: string | undefined, _body: string | undefined, selfAttrs: string | undefined) => {
    const attrs = openAttrs ?? selfAttrs ?? "";
    const nameMatch = attrs.match(/\bname\s*=\s*(["'])(.*?)\1/i);
    if (nameMatch?.[2]) fileRefs.push(decodeFileAttr(nameMatch[2]));
    return "";
  }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (cleaned) return cleaned;
  if (fileRefs.some(isInternalImageAttachment)) {
    return fileRefs.length === 1 ? "Image attached" : `${fileRefs.length} images attached`;
  }
  return text.trim();
}

function isInternalImageAttachment(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (!IMAGE_FILE_EXT_RE.test(normalized)) return false;
  return /\/\.pi\/agent\/web-attachments\//.test(normalized)
    || /\/var\/folders\/[^/]+\/[^/]+\/T\/codex-clipboard-[^/]+$/i.test(normalized)
    || /^\/tmp\/codex-clipboard-[^/]+$/i.test(normalized);
}

function parseSessionFileForIndex(filePath: string, size: number, mtimeMs: number): CachedSessionRecord | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return null;

  let header: SessionHeader;
  try {
    const parsed = JSON.parse(lines[0]) as Partial<SessionHeader> & { parentSession?: string };
    if (parsed.type !== "session" || !parsed.id) return null;
    header = parsed as SessionHeader;
  } catch {
    return null;
  }

  let messageCount = 0;
  let firstMessage = "";
  let name: string | undefined;

  for (let i = 1; i < lines.length; i++) {
    let entry: Partial<SessionEntry> & { message?: Partial<AgentMessage>; name?: string };
    try {
      entry = JSON.parse(lines[i]) as Partial<SessionEntry> & { message?: Partial<AgentMessage>; name?: string };
    } catch {
      continue;
    }

    if (entry.type === "message") {
      messageCount += 1;
      if (!firstMessage && entry.message?.role === "user") {
        firstMessage = truncateSessionPreview(cleanSessionPreviewText(getMessageText((entry.message as UserMessage).content)));
      }
    } else if (entry.type === "custom_message") {
      messageCount += 1;
    } else if (entry.type === "session_info") {
      name = typeof entry.name === "string" ? entry.name : name;
    }
  }

  return {
    filePath,
    size,
    mtimeMs,
    parentSessionPath: header.parentSession,
    info: {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name,
      created: header.timestamp,
      modified: new Date(mtimeMs).toISOString(),
      messageCount,
      firstMessage: firstMessage || "(no messages)",
    },
  };
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const index = await listAllSessionRecords();
  return index.map((record) => ({
    ...record.info,
    firstMessage: truncateSessionPreview(record.info.firstMessage),
  }));
}

export async function listAllSessionRecords(): Promise<CachedSessionRecord[]> {
  const files = listJsonlFiles(getSessionsDir());
  const seen = new Set(files);
  const cache = getSessionIndexCache();
  const records: CachedSessionRecord[] = [];

  for (const filePath of files) {
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }
    const cached = cache.get(filePath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      records.push(cached);
      continue;
    }

    const parsed = parseSessionFileForIndex(filePath, stat.size, stat.mtimeMs);
    if (!parsed) continue;
    cache.set(filePath, parsed);
    records.push(parsed);
  }

  for (const filePath of cache.keys()) {
    if (!seen.has(filePath)) cache.delete(filePath);
  }

  const pathToId = new Map<string, string>();
  for (const record of records) pathToId.set(record.filePath, record.info.id);

  const pathCache = getPathCache();
  for (const record of records) {
    record.info.parentSessionId = record.parentSessionPath ? pathToId.get(record.parentSessionPath) : undefined;
    pathCache.set(record.info.id, record.filePath);
  }

  return records.sort((a, b) => b.info.modified.localeCompare(a.info.modified));
}

export async function listAllSessionsSlow(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(s.path, s.id);

  const pathCache = getPathCache();
  return piSessions.map((s) => {
    pathCache.set(s.id, s.path);
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: truncateSessionPreview(s.firstMessage || "(no messages)"),
      parentSessionId: s.parentSessionPath ? pathToId.get(s.parentSessionPath) : undefined,
    };
  });
}

// ============================================================================
// Session path cache: sessionId → absolute file path
// Stored in globalThis for hot-reload safety
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

export function buildTree(entries: SessionEntry[]): SessionTreeNode[] {
  const nodeMap = new Map<string, SessionTreeNode>();
  const labelsById = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type === "label") {
      const l = entry as { type: "label"; targetId: string; label?: string };
      if (l.label) labelsById.set(l.targetId, l.label);
      else labelsById.delete(l.targetId);
    }
  }

  const roots: SessionTreeNode[] = [];
  for (const entry of entries) {
    nodeMap.set(entry.id, { entry, children: [], label: labelsById.get(entry.id) });
  }
  for (const entry of entries) {
    const node = nodeMap.get(entry.id)!;
    if (!entry.parentId) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(entry.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }

  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
    stack.push(...node.children);
  }
  return roots;
}

export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  // Build entryIds: parallel array to messages[], mapping each message back to its entry id.
  // Needed for fork and navigate_tree calls from the UI.
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }

  // Walk path from target leaf to root
  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Find the last compaction on path (mirrors pi's buildSessionContext logic)
  let compactionId: string | undefined;
  let firstKeptEntryId: string | undefined;
  for (const e of path) {
    if (e.type === "compaction") {
      compactionId = e.id;
      firstKeptEntryId = (e as { firstKeptEntryId: string }).firstKeptEntryId;
    }
  }

  const contextEntryIds: string[] = [];
  if (compactionId) {
    // The first message in piCtx.messages is the synthetic compaction summary — map to compaction entry id
    contextEntryIds.push(compactionId);
    const compactionIdx = path.findIndex((e) => e.id === compactionId);
    const firstKeptIdx = firstKeptEntryId
      ? path.findIndex((e, i) => i < compactionIdx && e.id === firstKeptEntryId)
      : -1;
    const startIdx = firstKeptIdx >= 0 ? firstKeptIdx : compactionIdx;
    for (let i = startIdx; i < compactionIdx; i++) {
      if (isContextMessageEntry(path[i])) contextEntryIds.push(path[i].id);
    }
    for (let i = compactionIdx + 1; i < path.length; i++) {
      if (isContextMessageEntry(path[i])) contextEntryIds.push(path[i].id);
    }
  } else {
    for (const e of path) {
      if (isContextMessageEntry(e)) contextEntryIds.push(e.id);
    }
  }

  // pi injects compaction summary as {role:"compactionSummary", summary, tokensBefore}.
  // Convert to {role:"user"} so MessageView can render it the same as before.
  const contextMessages = (piCtx.messages as AssistantMessage[]).map((msg) => {
    const raw = msg as unknown as Record<string, unknown>;
    if (raw.role === "compactionSummary") {
      return {
        role: "user" as const,
        content: `*The conversation history before this point was compacted into the following summary:*\n\n${raw.summary ?? ""}`,
        timestamp: raw.timestamp as number | undefined,
      };
    }
    if (raw.role === "branchSummary") {
      return {
        role: "user" as const,
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${raw.summary ?? ""}`,
        timestamp: raw.timestamp as number | undefined,
      };
    }
    return normalizeToolCalls(msg);
  });

  const display = filterDisplayMessages(contextMessages, contextEntryIds);

  return {
    messages: display.messages,
    entryIds: display.entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

export function getLeafId(entries: SessionEntry[]): string | null {
  if (entries.length === 0) return null;
  return entries[entries.length - 1].id;
}

function isContextMessageEntry(entry: SessionEntry): boolean {
  return entry.type === "message" || entry.type === "custom_message" || (entry.type === "branch_summary" && !!entry.summary);
}

function filterDisplayMessages(messages: AgentMessage[], entryIds: string[]): Pick<SessionContext, "messages" | "entryIds"> {
  const displayMessages: AgentMessage[] = [];
  const displayEntryIds: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    displayMessages.push(msg);
    displayEntryIds.push(entryIds[i] ?? "");
  }

  return {
    messages: displayMessages,
    entryIds: displayEntryIds,
  };
}
