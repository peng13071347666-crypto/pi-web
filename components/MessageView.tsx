"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { ArtifactCards, AttachedFileCards, type OpenPathAction } from "./ArtifactCards";
import type {
  AgentMessage,
  ArtifactItem,
  UserMessage,
  AssistantMessage,
  CustomMessage,
  ToolResultMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ToolCallContent,
  ThinkingContent,
  PromptVariant,
} from "@/lib/types";

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  // Kept for compatibility with older callers; the inline editor supersedes it.
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  onEditSubmit?: (entryId: string, content: string) => Promise<void> | void;
  promptVariants?: PromptVariant[];
  activeLeafId?: string | null;
  onSelectPromptVariant?: (leafId: string) => Promise<void> | void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  artifacts?: ArtifactItem[];
  cwd?: string;
  onPreviewArtifact?: (artifactId: string) => void;
  onReviewArtifacts?: (artifactIds: string[]) => void;
  onPreviewFile?: (filePath: string) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
  executionDetailsMode?: "collapsed" | "expanded";
  executionDetailsControl?: ReactNode;
}

const USER_MESSAGE_COLLAPSE_CHAR_LIMIT = 1200;
const USER_MESSAGE_COLLAPSE_LINE_LIMIT = 18;
const USER_MESSAGE_PREVIEW_CHAR_LIMIT = 1000;

function isProcessBlock(block: AssistantContentBlock): boolean {
  return block.type === "thinking" || block.type === "toolCall";
}

// Kept for the legacy component below; current chat rendering owns one
// execution-details control per assistant turn in ChatWindow.
type ProcessBlockItem = {
  block: AssistantContentBlock;
  index: number;
};

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch {
    return Promise.reject();
  }
}

export function MessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  entryId,
  onFork,
  forking,
  onEditSubmit,
  promptVariants,
  activeLeafId,
  onSelectPromptVariant,
  showTimestamp,
  prevTimestamp,
  artifacts,
  cwd,
  onPreviewArtifact,
  onReviewArtifacts,
  onPreviewFile,
  onOpenPath,
  executionDetailsMode,
  executionDetailsControl,
}: Props) {
  if (message.role === "user") {
    return (
      <UserMessageView
        message={message as UserMessage}
        entryId={entryId}
        onFork={onFork}
        forking={forking}
        onEditSubmit={onEditSubmit}
        promptVariants={promptVariants}
        activeLeafId={activeLeafId}
        onSelectPromptVariant={onSelectPromptVariant}
        cwd={cwd}
        onPreviewFile={onPreviewFile}
        onOpenPath={onOpenPath}
      />
    );
  }
  if (message.role === "assistant") {
    return (
      <AssistantMessageView
        message={message as AssistantMessage}
        isStreaming={isStreaming}
        toolResults={toolResults}
        modelNames={modelNames}
        showTimestamp={showTimestamp}
        prevTimestamp={prevTimestamp}
        artifacts={artifacts}
        cwd={cwd}
        onPreviewArtifact={onPreviewArtifact}
        onReviewArtifacts={onReviewArtifacts}
        onPreviewFile={onPreviewFile}
        onOpenPath={onOpenPath}
        executionDetailsMode={executionDetailsMode}
        executionDetailsControl={executionDetailsControl}
      />
    );
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    return <CustomMessageView message={message as CustomMessage} />;
  }
  return null;
}

function decodeFileAttr(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractFileRefs(text: string): { text: string; files: string[] } {
  const files: string[] = [];
  const cleaned = text.replace(/<file\b([^>]*)>([\s\S]*?)<\/file>|<file\b([^>]*)\/>/gi, (_match, openAttrs: string | undefined, _body: string | undefined, selfAttrs: string | undefined) => {
    const attrs = openAttrs ?? selfAttrs ?? "";
    const nameMatch = attrs.match(/\bname\s*=\s*(["'])(.*?)\1/i);
    if (nameMatch?.[2]) files.push(decodeFileAttr(nameMatch[2]));
    return "";
  });
  return {
    text: cleaned.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    files: [...new Set(files)],
  };
}

const IMAGE_FILE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|heif|tiff?)$/i;

function isPiWebHiddenAttachment(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (!IMAGE_FILE_EXT_RE.test(normalized)) return false;
  return /\/\.pi\/agent\/web-attachments\//.test(normalized)
    || /\/var\/folders\/[^/]+\/[^/]+\/T\/codex-clipboard-[^/]+$/i.test(normalized)
    || /^\/tmp\/codex-clipboard-[^/]+$/i.test(normalized);
}

function normalizeStandalonePathLine(line: string): string | null {
  let value = line.trim();
  if (!value) return null;
  value = value.replace(/^[*-]\s+/, "").trim();
  const backtick = value.match(/^`([^`]+)`$/);
  if (backtick) value = backtick[1].trim();
  const quote = value.match(/^["'](.+)["']$/);
  if (quote) value = quote[1].trim();
  if (/^[a-zA-Z]:[\\/].+/.test(value)) return value;
  if (/^\\\\[^\\]+\\[^\\]+/.test(value)) return value;
  if (/^\/[^/\s]+(?:\/[^/\s]+)+/.test(value)) return value;
  return null;
}

function extractStandaloneFilePaths(text: string, hiddenFilePaths?: Set<string>): { text: string; files: string[] } {
  const files: string[] = [];
  const lines = text.split("\n");
  let inFence = false;
  const kept = lines.filter((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return true;
    }
    if (inFence) return true;
    const filePath = normalizeStandalonePathLine(line);
    if (!filePath) return true;
    if (hiddenFilePaths?.has(filePath)) return false;
    files.push(filePath);
    return false;
  });
  return {
    text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    files: [...new Set(files)],
  };
}

function shouldCollapseUserMessage(text: string): boolean {
  if (text.length > USER_MESSAGE_COLLAPSE_CHAR_LIMIT) return true;
  return text.split("\n").length > USER_MESSAGE_COLLAPSE_LINE_LIMIT;
}

function getCollapsedUserMessageText(text: string): string {
  const lines = text.split("\n");
  if (lines.length > USER_MESSAGE_COLLAPSE_LINE_LIMIT) {
    return lines.slice(0, USER_MESSAGE_COLLAPSE_LINE_LIMIT).join("\n").trimEnd();
  }
  return text.slice(0, USER_MESSAGE_PREVIEW_CHAR_LIMIT).trimEnd();
}

function UserMessageView({ message, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, onEditSubmit, promptVariants, activeLeafId, onSelectPromptVariant, cwd, onPreviewFile, onOpenPath }: {
  message: UserMessage;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  onEditSubmit?: (entryId: string, content: string) => Promise<void> | void;
  promptVariants?: PromptVariant[];
  activeLeafId?: string | null;
  onSelectPromptVariant?: (leafId: string) => Promise<void> | void;
  cwd?: string;
  onPreviewFile?: (filePath: string) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedLongContent, setExpandedLongContent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [variantSwitching, setVariantSwitching] = useState(false);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  const rawContent =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");
  const parsedContent = useMemo(() => extractFileRefs(rawContent), [rawContent]);
  const content = parsedContent.text;
  const attachedFilePaths = parsedContent.files.filter((filePath) => !isPiWebHiddenAttachment(filePath));
  const hiddenAttachedFileCount = parsedContent.files.length - attachedFilePaths.length;
  const contentIsCollapsible = content ? shouldCollapseUserMessage(content) : false;
  const displayedContent = contentIsCollapsible && !expandedLongContent
    ? getCollapsedUserMessageText(content)
    : content;

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image");

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  const canNavigate = !!prevAssistantEntryId && !!onNavigate && !onEditSubmit;
  const canEdit = !!entryId && !!onEditSubmit && !editSubmitting;
  const variants = promptVariants && promptVariants.length > 1 ? promptVariants : [];
  const activeVariantIndex = Math.max(0, variants.findIndex((variant) => variant.leafIds.includes(activeLeafId ?? "")));

  useEffect(() => {
    setExpandedLongContent(false);
  }, [content]);

  useEffect(() => {
    if (!editing) return;
    setDraft(content);
    requestAnimationFrame(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    });
  }, [content, editing]);

  const copyContent = () => {
    copyText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const submitEdit = async () => {
    const next = draft.trim();
    if (!entryId || !onEditSubmit || !next || editSubmitting) return;
    setEditSubmitting(true);
    try {
      await onEditSubmit(entryId, draft);
      setEditing(false);
    } finally {
      setEditSubmitting(false);
    }
  };

  const selectVariant = async (delta: number) => {
    if (!onSelectPromptVariant || variants.length < 2 || variantSwitching) return;
    const nextIndex = (activeVariantIndex + delta + variants.length) % variants.length;
    const targetLeafId = variants[nextIndex]?.leafIds.at(-1);
    if (!targetLeafId) return;
    setVariantSwitching(true);
    try {
      await onSelectPromptVariant(targetLeafId);
    } finally {
      setVariantSwitching(false);
    }
  };

  return (
    <div
      style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: "flex-end" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, maxWidth: "85%" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--user-bg)",
            border: "1px solid var(--user-border)",
            borderRadius: "var(--message-radius)",
            padding: "8px 12px",
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text)",
            wordBreak: "break-word",
            boxShadow: "var(--bubble-shadow)",
          }}
        >
          {imageBlocks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
              {imageBlocks.map((img, i) => {
                // Handle both new {source:{...}} and legacy flat {data, mimeType} formats
                const src = img.source
                  ? img.source.type === "base64"
                    ? `data:${img.source.media_type};base64,${img.source.data}`
                    : img.source.url ?? ""
                  : img.data
                    ? `data:${img.mimeType};base64,${img.data}`
                    : "";
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt=""
                    style={{ maxWidth: 240, maxHeight: 240, borderRadius: "calc(var(--message-radius) - 6px)", objectFit: "contain", display: "block", border: "1px solid var(--user-border)" }}
                  />
                );
              })}
            </div>
          )}
          {editing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}>
              <textarea
                ref={editInputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(false);
                  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void submitEdit();
                  }
                }}
                disabled={editSubmitting}
                rows={Math.min(8, Math.max(3, draft.split("\n").length))}
                style={{
                  width: "min(620px, 70vw)",
                  minHeight: 72,
                  maxHeight: 240,
                  resize: "vertical",
                  padding: "8px 10px",
                  border: "1px solid var(--accent)",
                  borderRadius: "var(--control-radius)",
                  background: "var(--bg-panel)",
                  color: "var(--text)",
                  font: "inherit",
                  lineHeight: 1.5,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                <span style={{ marginRight: "auto", fontSize: 10, color: "var(--text-dim)" }}>Ctrl/⌘ + Enter to send</span>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={editSubmitting}
                  style={{ height: 26, padding: "0 9px", border: "1px solid var(--user-border)", borderRadius: "var(--control-radius)", background: "none", color: "var(--text-muted)", cursor: editSubmitting ? "not-allowed" : "pointer", fontSize: 11 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitEdit()}
                  disabled={editSubmitting || !draft.trim()}
                  style={{ height: 26, padding: "0 10px", border: "none", borderRadius: "var(--control-radius)", background: editSubmitting || !draft.trim() ? "var(--border)" : "var(--accent)", color: editSubmitting || !draft.trim() ? "var(--text-dim)" : "#fff", cursor: editSubmitting || !draft.trim() ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 600 }}
                >
                  {editSubmitting ? "Sending…" : "Send edited"}
                </button>
              </div>
            </div>
          ) : content ? (
            <>
              <MarkdownBody className="markdown-user-message">{displayedContent}</MarkdownBody>
              {contentIsCollapsible && (
                <button
                  type="button"
                  onClick={() => setExpandedLongContent((value) => !value)}
                  style={{
                    marginTop: 8,
                    height: 26,
                    padding: "0 9px",
                    border: "1px solid var(--user-border)",
                    borderRadius: "var(--control-radius)",
                    background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                    color: "var(--accent)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {expandedLongContent ? "Collapse" : "Show full message"}
                </button>
              )}
            </>
          ) : null}
          {!content && imageBlocks.length === 0 && hiddenAttachedFileCount > 0 && (
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
              {hiddenAttachedFileCount === 1 ? "Image attached" : `${hiddenAttachedFileCount} images attached`}
            </span>
          )}
          <AttachedFileCards
            files={attachedFilePaths}
            cwd={cwd}
            onPreviewFile={onPreviewFile}
            onOpenPath={onOpenPath}
          />
        </div>

      </div>

      {/* Bottom row: action buttons + timestamp */}
      {(time || canFork || canNavigate || true) && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 6, marginTop: 3,
        }}>
          {variants.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 2, marginRight: "auto" }}>
              <button
                type="button"
                onClick={() => void selectVariant(-1)}
                disabled={variantSwitching}
                title="Previous prompt version"
                aria-label="Previous prompt version"
                style={{ width: 22, height: 22, padding: 0, border: "none", borderRadius: 5, background: "none", color: variantSwitching ? "var(--border)" : "var(--text-dim)", cursor: variantSwitching ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <span title={variants[activeVariantIndex]?.label} style={{ minWidth: 28, textAlign: "center", fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                {activeVariantIndex + 1}/{variants.length}
              </span>
              <button
                type="button"
                onClick={() => void selectVariant(1)}
                disabled={variantSwitching}
                title="Next prompt version"
                aria-label="Next prompt version"
                style={{ width: 22, height: 22, padding: 0, border: "none", borderRadius: 5, background: "none", color: variantSwitching ? "var(--border)" : "var(--text-dim)", cursor: variantSwitching ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>
          )}
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Edit and send as a new branch"
              aria-label="Edit and send as a new branch"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 22, padding: 0, background: "none", border: "none", borderRadius: 5, color: "var(--text-dim)", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
            </button>
          )}
          <div style={{
            display: "flex", gap: 3,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 0.12s",
          }}>
            <button
              onClick={copyContent}
              title="Copy message"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 8px", height: 22,
                background: "none", border: "none",
                borderRadius: 5,
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11, fontWeight: 400,
                whiteSpace: "nowrap",
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              {copied ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {(canFork || canNavigate) && (
            <div style={{
              display: "flex", gap: 3,
              opacity: (hovered || forking) ? 1 : 0,
              pointerEvents: (hovered || forking) ? "auto" : "none",
              transition: "opacity 0.12s",
            }}>
              {canNavigate && (
                <button
                  onClick={() => { onNavigate!(prevAssistantEntryId!); onEditContent?.(content); }}
                  title="Edit from here — branches within this session"
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: 22,
                    background: "none", border: "none",
                    borderRadius: 5,
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: 11, fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 10 20 15 15 20" />
                    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
                  </svg>
                  Edit from here
                </button>
              )}
              {canFork && (
                <button
                  onClick={() => { onFork!(entryId!); }}
                  disabled={forking}
                  title={forking ? "Creating new session…" : "New session — creates an independent copy from here"}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: 22,
                    background: "none", border: "none",
                    borderRadius: 5,
                    color: forking ? "var(--accent)" : "var(--text-dim)",
                    cursor: forking ? "not-allowed" : "pointer",
                    fontSize: 11, fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!forking) e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { if (!forking) e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  {forking ? "Creating…" : "New session"}
                </button>
              )}
            </div>
          )}
          {time && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{time}</span>}
        </div>
      )}
    </div>
  );
}

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  showTimestamp,
  prevTimestamp,
  artifacts,
  cwd,
  onPreviewArtifact,
  onReviewArtifacts,
  onPreviewFile,
  onOpenPath,
  executionDetailsMode,
  executionDetailsControl,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  artifacts?: ArtifactItem[];
  cwd?: string;
  onPreviewArtifact?: (artifactId: string) => void;
  onReviewArtifacts?: (artifactIds: string[]) => void;
  onPreviewFile?: (filePath: string) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
  executionDetailsMode?: "collapsed" | "expanded";
  executionDetailsControl?: ReactNode;
}) {
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blocks = useMemo(() => message.content ?? [], [message.content]);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  // This is the total generation time (thinking + any text before first tool call)
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  // Tool call durations derived from session file timestamps (accurate for completed messages)
  // assistant message timestamp = when generation ended = when tools started running
  // toolResult timestamp = when tool execution finished
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults || !message.timestamp) return map;
    for (const [callId, result] of toolResults) {
      if (result.timestamp && message.timestamp) {
        const secs = Math.round((result.timestamp - message.timestamp) / 1000);
        if (secs > 0) map.set(callId, secs);
      }
    }
    return map;
  }, [toolResults, message.timestamp]);

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const messageArtifacts = useMemo(() => {
    if (!artifacts?.length) return [];
    const callIds = new Set(
      blocks
        .filter((block): block is ToolCallContent => block.type === "toolCall")
        .flatMap((block) => [block.toolCallId, block.toolCallId || ""])
        .filter(Boolean)
    );
    if (callIds.size === 0) return [];
    return artifacts.filter((artifact) => (
      (artifact.toolCallId && callIds.has(artifact.toolCallId)) || callIds.has(artifact.id)
    ));
  }, [artifacts, blocks]);
  const hiddenArtifactPaths = useMemo(
    () => new Set(messageArtifacts.map((artifact) => artifact.filePath)),
    [messageArtifacts]
  );
  const processOnlyHidden = executionDetailsMode === "collapsed"
    && blocks.length > 0
    && blocks.every(isProcessBlock)
    && messageArtifacts.length === 0;

  const copyContent = () => {
    copyText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = Date.now();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
        }
        return next;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const bs = blocksRef.current;
      const now = Date.now();

      // Record start time for each block the first time we see it
      bs.forEach((_, i) => {
        if (!blockStartTimesRef.current.has(i)) blockStartTimesRef.current.set(i, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < bs.length - 1; i++) {
          if (!next.has(i) && blockStartTimesRef.current.has(i)) {
            const start = blockStartTimesRef.current.get(i)!;
            const nextStart = blockStartTimesRef.current.get(i + 1) ?? now;
            next.set(i, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      let chars = 0;
      for (const b of bs) {
        if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
        else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
        else if (b.type === "toolCall") chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
      }
      if (chars === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) setTps(chars / 4 / elapsed);
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  if (processOnlyHidden) {
    return executionDetailsControl ? (
      <div style={{ marginBottom: 16 }}>{executionDetailsControl}</div>
    ) : null;
  }

  return (
    <div
      style={{ marginBottom: 16 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Model label */}
      <div
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {message.provider && (
          <span>{modelNames?.[`${message.provider}:${message.model}`] ?? modelNames?.[message.model] ?? message.model}</span>
        )}
        {isStreaming && (() => {
          let chars = 0;
          for (const b of blocks) {
            if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
            else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
            else if (b.type === "toolCall") chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
          }
          const est = Math.round(chars / 4);
          return (
            <>

              {est > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text)" }} title="预估 token 数（流式接收中）">
                  <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 400 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                    </svg>
                    {est}
                  </span>
                  {tps !== null && (() => {
                    const bg = tps >= 50 ? "#53b3cb" : tps >= 30 ? "#9bc53d" : tps >= 15 ? "#f9c22e" : "#e01a4f";
                    return (
                      <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, background: bg, color: "#fff", fontSize: 11, fontWeight: 400 }}>
                        {tps.toFixed(1)} t/s
                      </span>
                    );
                  })()}
                </span>
              )}
            </>
          );
        })()}
      </div>

      {executionDetailsControl}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blocks.map((block, i) => {
          if (executionDetailsMode === "collapsed" && isProcessBlock(block)) return null;
          return (
            <BlockView
              key={i}
              block={block}
              toolResults={toolResults}
              isStreaming={isStreaming}
              streamingDuration={streamingDurations.get(i) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)}
              toolCallDurations={toolCallDurations}
              hiddenFilePaths={hiddenArtifactPaths}
              cwd={cwd}
              onPreviewFile={onPreviewFile}
              onOpenPath={onOpenPath}
            />
          );
        })}
        {!isStreaming && (
          <ArtifactCards
            artifacts={messageArtifacts}
            cwd={cwd}
            onPreviewArtifact={onPreviewArtifact}
            onReviewArtifacts={onReviewArtifacts}
            onOpenPath={onOpenPath}
          />
        )}
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginTop: 4,
      }}>
        {message.usage && !isStreaming && (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {formatUsage(message.usage)}
          </div>
        )}
        {textContent && !isStreaming && (
          <button
            onClick={copyContent}
            title="Copy message"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 8px", height: 22,
              background: "none", border: "none",
              borderRadius: 5,
              color: copied ? "var(--accent)" : "var(--text-dim)",
              cursor: "pointer",
              fontSize: 11, fontWeight: 400,
              whiteSpace: "nowrap",
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
              transition: "opacity 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
            onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {time && !isStreaming && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: "auto" }}>{time}</span>
        )}
      </div>
    </div>
  );
}

function ProcessBlockGroup({
  items,
  toolResults,
  isStreaming,
  streamingDurations,
  thinkingDurationFromFile,
  toolCallDurations,
  hiddenFilePaths,
  cwd,
  onPreviewFile,
  onOpenPath,
}: {
  items: ProcessBlockItem[];
  toolResults?: Map<string, ToolResultMessage>;
  isStreaming?: boolean;
  streamingDurations: Map<number, number>;
  thinkingDurationFromFile?: number;
  toolCallDurations?: Map<string, number>;
  hiddenFilePaths?: Set<string>;
  cwd?: string;
  onPreviewFile?: (filePath: string) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
}) {
  const thinkingCount = items.filter(({ block }) => block.type === "thinking").length;
  const toolCount = items.filter(({ block }) => block.type === "toolCall").length;
  const hasError = items.some(({ block }) => {
    if (block.type !== "toolCall") return false;
    return toolResults?.get((block as ToolCallContent).toolCallId)?.isError === true;
  });
  const [expanded, setExpanded] = useState(Boolean(isStreaming) || hasError);
  const wasStreamingRef = useRef(Boolean(isStreaming));

  useEffect(() => {
    if (hasError) setExpanded(true);
    else if (wasStreamingRef.current && !isStreaming) setExpanded(false);
    wasStreamingRef.current = Boolean(isStreaming);
  }, [hasError, isStreaming]);

  const summary = [
    thinkingCount > 0 ? `${thinkingCount} thinking` : null,
    toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      className="pi-process-group"
      style={{
        border: hasError ? "1px solid rgba(248,113,113,0.45)" : "1px solid var(--border)",
        borderRadius: "var(--content-radius)",
        overflow: "hidden",
        fontSize: 12,
        background: hasError ? "rgba(248,113,113,0.05)" : "var(--bg-panel)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        title={expanded ? "收起执行过程" : "展开执行过程"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "6px 10px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
        <span style={{ flex: 1, minWidth: 0 }}>Execution details</span>
        <span style={{ color: hasError ? "#f87171" : "var(--text-dim)", fontSize: 11, flexShrink: 0 }}>
          {hasError ? "error" : summary}
        </span>
      </button>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 8px 8px", borderTop: "1px solid var(--border)" }}>
          {items.map(({ block, index }) => (
            <BlockView
              key={index}
              block={block}
              toolResults={toolResults}
              isStreaming={isStreaming}
              streamingDuration={streamingDurations.get(index) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)}
              toolCallDurations={toolCallDurations}
              hiddenFilePaths={hiddenFilePaths}
              cwd={cwd}
              onPreviewFile={onPreviewFile}
              onOpenPath={onOpenPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BlockView({
  block,
  toolResults,
  isStreaming,
  streamingDuration,
  toolCallDurations,
  hiddenFilePaths,
  cwd,
  onPreviewFile,
  onOpenPath,
}: {
  block: AssistantContentBlock;
  toolResults?: Map<string, ToolResultMessage>;
  isStreaming?: boolean;
  streamingDuration?: number;
  toolCallDurations?: Map<string, number>;
  hiddenFilePaths?: Set<string>;
  cwd?: string;
  onPreviewFile?: (filePath: string) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
}) {
  if (block.type === "text") {
    return (
      <TextBlock
        block={block as TextContent}
        isStreaming={isStreaming}
        hiddenFilePaths={hiddenFilePaths}
        cwd={cwd}
        onPreviewFile={onPreviewFile}
        onOpenPath={onOpenPath}
      />
    );
  }
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} duration={streamingDuration} isStreaming={isStreaming} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    return <ToolCallBlock block={tc} result={result} duration={duration} isStreaming={isStreaming} />;
  }
  return null;
}

function TextBlock({
  block,
  isStreaming,
  hiddenFilePaths,
  cwd,
  onPreviewFile,
  onOpenPath,
}: {
  block: TextContent;
  isStreaming?: boolean;
  hiddenFilePaths?: Set<string>;
  cwd?: string;
  onPreviewFile?: (filePath: string) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
}) {
  const parsed = useMemo(() => extractStandaloneFilePaths(block.text, hiddenFilePaths), [block.text, hiddenFilePaths]);
  return (
    <>
      {parsed.text && <MarkdownBody isStreaming={isStreaming}>{parsed.text}</MarkdownBody>}
      {!isStreaming && (
        <AttachedFileCards
          files={parsed.files}
          cwd={cwd}
          caption="File output"
          onPreviewFile={onPreviewFile}
          onOpenPath={onOpenPath}
        />
      )}
    </>
  );
}

function ThinkingBlock({ block, duration, isStreaming }: { block: ThinkingContent; duration?: number; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const wasStreamingRef = useRef(Boolean(isStreaming));

  useEffect(() => {
    // If the user opened the live thinking details, fold them when the
    // assistant finishes so the completed answer remains the visual focus.
    if (wasStreamingRef.current && !isStreaming) setExpanded(false);
    wasStreamingRef.current = Boolean(isStreaming);
  }, [isStreaming]);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--content-radius)",
        overflow: "hidden",
        fontSize: 13,
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        type="button"
        aria-expanded={expanded}
        title={expanded ? "收起思考详情" : "展开思考详情"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 10px",
          background: "var(--bg-panel)",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
        <span>Thinking</span>
        {duration !== undefined && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
        )}
      </button>
      {expanded && (
        <div
          style={{
            padding: "8px 10px",
            color: "var(--text-muted)",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            background: "var(--bg-panel)",
            borderTop: "1px solid var(--border)",
          }}
        >
          {block.thinking}
        </div>
      )}
    </div>
  );
}


const TOOL_RESULT_PREVIEW_CHARS = 4000;

function ToolCallBlock({ block, result, duration, isStreaming }: { block: ToolCallContent; result?: ToolResultMessage; duration?: number; isStreaming?: boolean }) {
  // Default collapsed; auto-open only on error so noise stays low but failures are visible.
  const isError = result?.isError ?? false;
  const [expanded, setExpanded] = useState(isError);
  const wasErrorRef = useRef(isError);
  const wasStreamingRef = useRef(Boolean(isStreaming));
  useEffect(() => {
    if (isError && !wasErrorRef.current) setExpanded(true);
    wasErrorRef.current = isError;
  }, [isError]);
  useEffect(() => {
    // Collapse any details opened while the run was live once the full
    // assistant turn is complete. Keep errors open for quick diagnosis.
    if (wasStreamingRef.current && !isStreaming && !isError) setExpanded(false);
    wasStreamingRef.current = Boolean(isStreaming);
  }, [isError, isStreaming]);

  const inputStr = JSON.stringify(block.input, null, 2);

  const resultText = result
    ? result.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
    : null;
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "");
  const pending = !result;
  const statusLabel = isError ? "error" : pending ? "running" : resultIsEmpty ? "ok · empty" : "ok";

  return (
    <div
      className="pi-tool-block"
      style={{
        borderRadius: "var(--content-radius)",
        overflow: "hidden",
        fontSize: 12,
        border: isError ? "1px solid rgba(248,113,113,0.45)" : pending ? "1px solid color-mix(in srgb, var(--accent) 35%, var(--border))" : "1px solid rgba(34,197,94,0.25)",
        background: isError ? "rgba(248,113,113,0.05)" : "var(--tool-bg)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "收起工具详情" : "展开工具详情"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "6px 10px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span style={{ color: isError ? "#f87171" : pending ? "var(--accent)" : "#16a34a", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
          {block.toolName}
        </span>
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {getToolPreview(block)}
        </span>
        <span
          style={{
            fontSize: 10,
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
            color: isError ? "#f87171" : pending ? "var(--accent)" : "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {statusLabel}
          {duration !== undefined ? ` · ${duration}s` : ""}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            color: "var(--text-muted)",
            fontSize: 12,
            lineHeight: 1.5,
            overflow: "auto",
            maxHeight: 240,
            background: "var(--bg-subtle)",
            borderTop: isError ? "1px solid rgba(248,113,113,0.25)" : "1px solid rgba(34,197,94,0.2)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {inputStr}
        </pre>
      )}

      {expanded && result && (
        <PairedResult
          text={resultText ?? ""}
          isEmpty={resultIsEmpty}
          isError={isError}
        />
      )}
    </div>
  );
}

function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const tooLong = text.length > TOOL_RESULT_PREVIEW_CHARS;
  const display = !tooLong || showAll ? text : `${text.slice(0, TOOL_RESULT_PREVIEW_CHARS).trimEnd()}\n…`;

  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`,
        background: isError ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          color: isError ? "#f87171" : (isEmpty ? "var(--text-dim)" : "var(--text-muted)"),
          fontSize: 12,
          lineHeight: 1.5,
          overflow: "auto",
          maxHeight: showAll ? 560 : 320,
          background: "var(--assistant-bg)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontStyle: isEmpty ? "italic" : "normal",
          opacity: isEmpty ? 0.6 : 1,
        }}
      >
        {isEmpty ? "(no output)" : display}
      </pre>
      {tooLong && !isEmpty && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          style={{
            width: "100%",
            border: "none",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            fontSize: 11,
            padding: "5px 10px",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {showAll ? "收起输出" : `展开全部输出（${text.length.toLocaleString()} 字符）`}
        </button>
      )}
    </div>
  );
}

function CustomMessageView({ message }: { message: CustomMessage }) {
  const isHiddenDisplay = message.display === false;
  const [contentExpanded, setContentExpanded] = useState(!isHiddenDisplay);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const title = formatCustomType(message.customType);
  const time = formatTime(message.timestamp);

  const copyContent = () => {
    copyText(text || detailsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--content-radius)",
          overflow: "hidden",
          background: isHiddenDisplay ? "var(--bg-subtle)" : "var(--assistant-bg)",
          opacity: isHiddenDisplay && !contentExpanded ? 0.82 : 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 650 }}>
            {title}
          </span>
          {isHiddenDisplay && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>hidden extension message</span>}
          {time && <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>{time}</span>}
        </div>

        {contentExpanded ? (
          <div style={{ padding: "6px 9px" }}>
            {images.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: text ? 8 : 0 }}>
                {images.map((img, i) => {
                  const src = imageSource(img);
                  if (!src) return null;
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt=""
                      style={{ maxWidth: 240, maxHeight: 240, borderRadius: 6, objectFit: "contain", display: "block", border: "1px solid var(--border)" }}
                    />
                  );
                })}
              </div>
            )}
            {text ? <MarkdownBody className="markdown-custom-message">{text}</MarkdownBody> : <span style={{ color: "var(--text-dim)", fontSize: 12 }}>(no message)</span>}
          </div>
        ) : (
          <button
            onClick={() => setContentExpanded(true)}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 10px",
              border: "none",
              background: "transparent",
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
            }}
          >
            {text ? previewText(text) : "Show extension message"}
          </button>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 9px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-subtle)",
          }}
        >
          {text || detailsText ? (
            <button
              onClick={copyContent}
              style={{
                padding: "3px 7px",
                border: "none",
                background: "none",
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
          {(hasDetails || isHiddenDisplay) && (
            <button
              onClick={() => {
                if (isHiddenDisplay) setContentExpanded((v) => !v);
                else setDetailsExpanded((v) => !v);
              }}
              style={{
                marginLeft: "auto",
                padding: "3px 7px",
                border: "none",
                background: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {isHiddenDisplay
                ? (contentExpanded ? "Collapse" : "Expand")
                : (detailsExpanded ? "Hide details" : "Show details")}
            </button>
          )}
        </div>

        {hasDetails && ((isHiddenDisplay && contentExpanded) || (!isHiddenDisplay && detailsExpanded)) && (
          <pre
            style={{
              margin: 0,
              padding: "9px 10px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 360,
              overflow: "auto",
              fontFamily: "var(--font-mono)",
            }}
          >
            {detailsText}
          </pre>
        )}
      </div>
    </div>
  );
}

function getMessageText(content: CustomMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function getMessageImages(content: CustomMessage["content"] | UserMessage["content"]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image");
}

function imageSource(img: ImageContent): string {
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    return img.source.type === "base64"
      ? `data:${img.source.media_type};base64,${img.source.data}`
      : img.source.url ?? "";
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatCustomType(type: string): string {
  return type || "extension";
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Show extension message";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}


function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}

function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}
