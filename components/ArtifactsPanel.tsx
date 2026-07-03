"use client";

import type { ArtifactItem } from "@/lib/types";
import { getRelativeFilePath } from "@/lib/file-paths";
import { DiffView, FileViewer } from "./FileViewer";

interface Props {
  artifacts: ArtifactItem[];
  activeArtifactId: string | null;
  cwd?: string;
  onSelectArtifact: (id: string) => void;
}

function kindLabel(kind: ArtifactItem["kind"]): string {
  if (kind === "created") return "Created";
  if (kind === "modified") return "Modified";
  if (kind === "read") return "Read";
  return "Changed";
}

function statusColor(status: ArtifactItem["status"]): string {
  if (status === "error") return "#ef4444";
  if (status === "done") return "#16a34a";
  return "var(--text-dim)";
}

export function ArtifactsPanel({ artifacts, activeArtifactId, cwd, onSelectArtifact }: Props) {
  const active = artifacts.find((item) => item.id === activeArtifactId) ?? artifacts[0] ?? null;

  if (artifacts.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
        No artifacts yet
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", minWidth: 0 }}>
      <div style={{ borderRight: "1px solid var(--border)", overflowY: "auto", background: "var(--bg-panel)" }}>
        {artifacts.map((item) => {
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

      <div style={{ minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
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
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              {active.errorMessage ? (
                <div style={{ padding: 12, color: "#ef4444", fontSize: 12, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" }}>
                  {active.errorMessage}
                </div>
              ) : active.beforeContent !== undefined && active.afterContent !== undefined ? (
                <div style={{ height: "100%", overflow: "auto" }}>
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
