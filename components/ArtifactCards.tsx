"use client";

import { useMemo, useState } from "react";
import type { ArtifactItem } from "@/lib/types";
import { getFileIcon } from "./FileIcons";
import { DiffView } from "./FileViewer";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";

export type OpenPathAction = "open" | "openFolder";

interface ArtifactCardsProps {
  artifacts: ArtifactItem[];
  cwd?: string;
  onPreviewArtifact?: (artifactId: string) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
  onReviewArtifacts?: (artifactIds: string[]) => void;
}

interface AttachedFileCardsProps {
  files: string[];
  cwd?: string;
  caption?: string;
  onPreviewFile?: (filePath: string) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
}

const MEDIA_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "pdf", "docx", "html", "htm"]);

function getExt(filePath: string): string {
  const name = getFileName(filePath).toLowerCase();
  return name.includes(".") ? name.split(".").pop() ?? "" : "";
}

function fileKindLabel(filePath: string): string {
  const ext = getExt(filePath);
  if (!ext) return "File";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(ext)) return `Image · ${ext.toUpperCase()}`;
  if (ext === "html" || ext === "htm") return "Web preview";
  if (ext === "pdf") return "PDF";
  if (ext === "docx") return "Document · DOCX";
  return `File · ${ext.toUpperCase()}`;
}

function lineCount(content: string | undefined): number {
  if (!content) return 0;
  return content.split("\n").length;
}

function countLineDelta(beforeContent: string | undefined, afterContent: string | undefined): { added: number; removed: number } {
  if (beforeContent === undefined && afterContent === undefined) return { added: 0, removed: 0 };
  if (beforeContent === undefined) return { added: lineCount(afterContent), removed: 0 };
  if (afterContent === undefined) return { added: 0, removed: lineCount(beforeContent) };

  const oldLines = beforeContent ? beforeContent.split("\n") : [];
  const newLines = afterContent ? afterContent.split("\n") : [];
  const cells = oldLines.length * newLines.length;
  if (cells > 220_000) {
    return { added: newLines.length, removed: oldLines.length };
  }

  let prev = new Array(newLines.length + 1).fill(0) as number[];
  for (let i = 1; i <= oldLines.length; i++) {
    const next = new Array(newLines.length + 1).fill(0) as number[];
    for (let j = 1; j <= newLines.length; j++) {
      next[j] = oldLines[i - 1] === newLines[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], next[j - 1]);
    }
    prev = next;
  }

  const unchanged = prev[newLines.length] ?? 0;
  return {
    added: Math.max(0, newLines.length - unchanged),
    removed: Math.max(0, oldLines.length - unchanged),
  };
}

function countArtifactLineDelta(artifact: ArtifactItem): { added: number; removed: number; ready: boolean } {
  if (artifact.kind === "modified" && (artifact.beforeContent === undefined || artifact.afterContent === undefined)) {
    return { added: 0, removed: 0, ready: false };
  }
  return { ...countLineDelta(artifact.beforeContent, artifact.afterContent), ready: true };
}

function deltaColor(kind: "added" | "removed"): string {
  return kind === "added" ? "#16a34a" : "#dc2626";
}

function isPresentableOutput(artifact: ArtifactItem): boolean {
  if (artifact.kind === "read") return false;
  return artifact.kind === "created" && MEDIA_EXTS.has(getExt(artifact.filePath));
}

function useMenuState() {
  const [openId, setOpenId] = useState<string | null>(null);
  return {
    openId,
    toggle(id: string) {
      setOpenId((current) => current === id ? null : id);
    },
    close() {
      setOpenId(null);
    },
  };
}

export function OpenMenu({
  id,
  filePath,
  openId,
  onToggle,
  onClose,
  onOpenPath,
}: {
  id: string;
  filePath: string;
  openId: string | null;
  onToggle: (id: string) => void;
  onClose: () => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
}) {
  const open = openId === id;
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", flexShrink: 0 }}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenPath?.(filePath, "open");
        }}
        style={{
          height: 30,
          padding: "0 10px",
          border: "1px solid var(--border)",
          borderRight: "none",
          borderRadius: "7px 0 0 7px",
          background: "var(--bg)",
          color: "var(--text)",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        打开
      </button>
      <button
        type="button"
        title="More open actions"
        onClick={(event) => {
          event.stopPropagation();
          onToggle(id);
        }}
        style={{
          height: 30,
          width: 26,
          border: "1px solid var(--border)",
          borderRadius: "0 7px 7px 0",
          background: open ? "var(--bg-hover)" : "var(--bg)",
          color: "var(--text-muted)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>
      {open && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            right: 0,
            zIndex: 120,
            width: 110,
            overflow: "hidden",
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--bg)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.14)",
          }}
        >
          {([
            ["open", "打开文件"],
            ["openFolder", "打开文件夹"],
          ] as const).map(([action, label]) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                onClose();
                onOpenPath?.(filePath, action);
              }}
              style={{
                width: "100%",
                height: 24,
                padding: "0 8px",
                border: "none",
                borderBottom: action === "open" ? "1px solid var(--border)" : "none",
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 11,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactOutputCard({
  artifact,
  cwd,
  onPreviewArtifact,
  onOpenPath,
  menu,
}: {
  artifact: ArtifactItem;
  cwd?: string;
  onPreviewArtifact?: (artifactId: string) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
  menu: ReturnType<typeof useMenuState>;
}) {
  const relative = getRelativeFilePath(artifact.filePath, cwd);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPreviewArtifact?.(artifact.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onPreviewArtifact?.(artifact.id);
      }}
      title="Preview in the side panel"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 66,
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg)",
        cursor: "pointer",
      }}
    >
      <div style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        background: "var(--bg-panel)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-muted)",
        flexShrink: 0,
      }}>
        {getFileIcon(artifact.fileName, 20)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 13, fontFamily: "var(--font-mono)" }}>
          {relative}
        </div>
        <div style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 6, color: "var(--text-dim)", fontSize: 12 }}>
          <span>{fileKindLabel(artifact.filePath)}</span>
          {artifact.status !== "done" && <span>{artifact.status}</span>}
        </div>
      </div>
      <OpenMenu
        id={artifact.id}
        filePath={artifact.filePath}
        openId={menu.openId}
        onToggle={menu.toggle}
        onClose={menu.close}
        onOpenPath={onOpenPath}
      />
    </div>
  );
}

function ChangedFilesCard({
  artifacts,
  cwd,
  onReviewArtifacts,
  onOpenPath,
}: {
  artifacts: ArtifactItem[];
  cwd?: string;
  onReviewArtifacts?: (artifactIds: string[]) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const menu = useMenuState();
  const visible = showAll ? artifacts : artifacts.slice(0, 3);
  const primaryArtifact = artifacts.find((artifact) => artifact.status !== "error") ?? artifacts[0];
  const totals = artifacts.reduce((acc, artifact) => {
    const delta = countArtifactLineDelta(artifact);
    acc.added += delta.added;
    acc.removed += delta.removed;
    return acc;
  }, { added: 0, removed: 0 });

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 8,
      background: "var(--bg)",
      overflow: "hidden",
      position: "relative",
    }}>
      <div
        role="button"
        tabIndex={0}
        title="Preview changes in the side panel"
        onClick={() => onReviewArtifacts?.(artifacts.map((artifact) => artifact.id))}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            onReviewArtifacts?.(artifacts.map((artifact) => artifact.id));
          }
        }}
        style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 12px 10px",
        cursor: "pointer",
      }}>
        <div style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: "var(--bg-panel)",
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="12" y1="9" x2="12" y2="17" />
          </svg>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 650 }}>
            Edited {artifacts.length} {artifacts.length === 1 ? "file" : "files"}
          </div>
          <div style={{ marginTop: 2, display: "flex", gap: 8, fontSize: 12, fontFamily: "var(--font-mono)" }}>
            <span style={{ color: deltaColor("added") }}>+{totals.added.toLocaleString()}</span>
            <span style={{ color: deltaColor("removed") }}>-{totals.removed.toLocaleString()}</span>
          </div>
        </div>
        {primaryArtifact && (
          <OpenMenu
            id={`changed:${primaryArtifact.id}`}
            filePath={primaryArtifact.filePath}
            openId={menu.openId}
            onToggle={menu.toggle}
            onClose={menu.close}
            onOpenPath={onOpenPath}
          />
        )}
      </div>

      <div style={{ padding: "0 12px 10px", display: "grid", gap: 2 }}>
        {visible.map((artifact) => {
          const delta = countArtifactLineDelta(artifact);
          const expanded = expandedId === artifact.id;
          const canRenderDiff = artifact.kind === "created"
            ? artifact.afterContent !== undefined
            : artifact.beforeContent !== undefined && artifact.afterContent !== undefined;
          return (
            <div key={artifact.id}>
              <button
                type="button"
                onClick={() => setExpandedId((current) => current === artifact.id ? null : artifact.id)}
                style={{
                  width: "100%",
                  minHeight: 34,
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto 18px",
                  alignItems: "center",
                  gap: 8,
                  border: "none",
                  borderRadius: 6,
                  background: expanded ? "var(--bg-hover)" : "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  padding: "0 4px",
                  textAlign: "left",
                }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontFamily: "var(--font-mono)" }}>
                  {getRelativeFilePath(artifact.filePath, cwd)}
                </span>
                <span style={{ display: "flex", gap: 8, fontSize: 12, fontFamily: "var(--font-mono)" }}>
                  <span style={{ color: deltaColor("added") }}>{delta.ready ? `+${delta.added}` : "+..."}</span>
                  <span style={{ color: deltaColor("removed") }}>{delta.ready ? `-${delta.removed}` : "-..."}</span>
                </span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--text-dim)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                  <polyline points="3 4.5 6 7.5 9 4.5" />
                </svg>
              </button>
              {expanded && (
                <div style={{
                  maxHeight: 300,
                  overflow: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  margin: "4px 0 8px",
                }}>
                  {canRenderDiff ? (
                    <DiffView
                      oldContent={artifact.beforeContent ?? ""}
                      newContent={artifact.afterContent ?? ""}
                      language={artifact.language ?? "text"}
                    />
                  ) : (
                    <div style={{ padding: 10, color: "var(--text-dim)", fontSize: 12 }}>
                      Diff is still loading.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!showAll && artifacts.length > visible.length && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            style={{
              justifySelf: "start",
              height: 28,
              border: "none",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
              padding: "0 4px",
            }}
          >
            Show {artifacts.length - visible.length} more files
          </button>
        )}
      </div>
    </div>
  );
}

export function ArtifactCards({ artifacts, cwd, onPreviewArtifact, onOpenPath, onReviewArtifacts }: ArtifactCardsProps) {
  const menu = useMenuState();
  const outputArtifacts = useMemo(() => artifacts.filter(isPresentableOutput), [artifacts]);
  const changedArtifacts = useMemo(() => (
    artifacts.filter((artifact) => artifact.kind === "modified" || (artifact.kind === "created" && !isPresentableOutput(artifact)))
  ), [artifacts]);

  if (outputArtifacts.length === 0 && changedArtifacts.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {outputArtifacts.map((artifact) => (
        <ArtifactOutputCard
          key={artifact.id}
          artifact={artifact}
          cwd={cwd}
          onPreviewArtifact={onPreviewArtifact}
          onOpenPath={onOpenPath}
          menu={menu}
        />
      ))}
      {changedArtifacts.length > 0 && (
        <ChangedFilesCard
          artifacts={changedArtifacts}
          cwd={cwd}
          onReviewArtifacts={onReviewArtifacts}
          onOpenPath={onOpenPath}
        />
      )}
    </div>
  );
}

export function AttachedFileCards({ files, cwd, caption = "Attached file · hidden from chat body", onPreviewFile, onOpenPath }: AttachedFileCardsProps) {
  const menu = useMenuState();
  if (files.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
      {files.map((filePath) => {
        const id = `attachment:${filePath}`;
        const fileName = getFileName(filePath);
        return (
          <div
            key={id}
            role="button"
            tabIndex={0}
            onClick={() => onPreviewFile?.(filePath)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onPreviewFile?.(filePath);
            }}
            title="Preview in the side panel"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              maxWidth: "100%",
              boxSizing: "border-box",
              minWidth: 0,
              minHeight: 52,
              padding: "8px 10px",
              border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
              borderRadius: 8,
              background: "var(--bg)",
              cursor: "pointer",
            }}
          >
            <span style={{ flexShrink: 0, display: "flex", color: "var(--text-muted)" }}>
              {getFileIcon(fileName, 18)}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                title={getRelativeFilePath(filePath, cwd)}
                style={{
                  display: "block",
                  maxWidth: "100%",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--text)",
                }}
              >
                {getRelativeFilePath(filePath, cwd)}
              </div>
              <div style={{ marginTop: 2, color: "var(--text-dim)", fontSize: 11 }}>
                {caption}
              </div>
            </div>
            <OpenMenu
              id={id}
              filePath={filePath}
              openId={menu.openId}
              onToggle={menu.toggle}
              onClose={menu.close}
              onOpenPath={onOpenPath}
            />
          </div>
        );
      })}
    </div>
  );
}
