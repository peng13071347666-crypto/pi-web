"use client";

import { useState } from "react";
import type { ArtifactItem } from "@/lib/types";
import { getRelativeFilePath } from "@/lib/file-paths";
import { DiffView, FileViewer } from "./FileViewer";
import { OpenMenu, type OpenPathAction } from "./ArtifactCards";

interface Props {
  artifacts: ArtifactItem[];
  activeArtifactId: string | null;
  cwd?: string;
  onSelectArtifact: (id: string) => void;
  onOpenPath?: (filePath: string, action: OpenPathAction) => void;
}

function kindLabel(kind: ArtifactItem["kind"]): string {
  if (kind === "created") return "新建";
  if (kind === "modified") return "修改";
  if (kind === "read") return "读取";
  return "变更";
}

function statusColor(status: ArtifactItem["status"]): string {
  if (status === "error") return "#ef4444";
  if (status === "done") return "#16a34a";
  return "var(--text-dim)";
}

export function ArtifactsPanel({ artifacts, activeArtifactId, cwd, onSelectArtifact, onOpenPath }: Props) {
  const outputArtifacts = artifacts.filter((item) => item.kind === "created" || item.kind === "modified");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  if (outputArtifacts.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--text-dim)", fontSize: 12, padding: 16, textAlign: "center" }}>
        <div style={{ fontWeight: 600, color: "var(--text-muted)" }}>暂无产物</div>
        <div>Agent 创建或修改文件后会出现在这里</div>
      </div>
    );
  }

  // Newest first for “本轮结果” scanning
  const ordered = [...outputArtifacts].reverse();
  const active = ordered.find((item) => item.id === activeArtifactId) ?? ordered[0] ?? null;

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", minWidth: 0 }}>
      <div style={{ borderRight: "1px solid var(--border)", overflowY: "auto", background: "var(--bg-panel)" }}>
        <div style={{ padding: "8px 10px 6px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)" }}>
          本轮产物 · {ordered.length}
        </div>
        {ordered.map((item) => {
          const selected = active?.id === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectArtifact(item.id)}
              title={item.filePath}
              style={{
                width: "100%",
                display: "block",
                textAlign: "left",
                padding: "9px 10px",
                border: "none",
                borderBottom: "1px solid var(--border)",
                borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
                background: selected ? "var(--bg-selected)" : "transparent",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: item.kind === "read" ? "var(--text-muted)" : "var(--accent)" }}>
                  {kindLabel(item.kind)}
                </span>
                <span style={{ fontSize: 10, color: statusColor(item.status), textTransform: "uppercase" }}>
                  {item.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.fileName}
              </div>
              <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {getRelativeFilePath(item.filePath, cwd)}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ width: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {active ? (
          <>
            <div style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-panel)",
              fontSize: 12,
            }}>
              <span style={{ color: active.kind === "read" ? "var(--text-muted)" : "var(--accent)", fontWeight: 700 }}>
                {kindLabel(active.kind)}
              </span>
              <span style={{ color: "var(--text-dim)" }}>·</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)" }}>
                {getRelativeFilePath(active.filePath, cwd)}
              </span>
              <OpenMenu
                id={`artifact-panel:${active.id}`}
                filePath={active.filePath}
                openId={openMenuId}
                onToggle={(id) => setOpenMenuId((current) => current === id ? null : id)}
                onClose={() => setOpenMenuId(null)}
                onOpenPath={onOpenPath}
              />
            </div>
            <div style={{ flex: 1, width: "100%", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
              {active.errorMessage ? (
                <div style={{ padding: 12, color: "#ef4444", fontSize: 12, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" }}>
                  {active.errorMessage}
                </div>
              ) : active.status === "pending" ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
                  等待文件输出…
                </div>
              ) : active.beforeContent !== undefined && active.afterContent !== undefined ? (
                <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
                  <DiffView oldContent={active.beforeContent} newContent={active.afterContent} language={active.language ?? "text"} />
                </div>
              ) : (
                <FileViewer filePath={active.filePath} cwd={cwd} />
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
