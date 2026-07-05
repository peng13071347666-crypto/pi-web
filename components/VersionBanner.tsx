"use client";

import { useEffect, useState, useCallback } from "react";

interface VersionCheckResult {
  piWebVersion: string;
  bundledPiVersion: string;
  bundledPiAiVersion: string;
  dataDirVersion: string | null;
  globalPiVersion: string | null;
  status: "ok" | "warning" | "error";
  messages: string[];
  remediation: string[];
}

/**
 * Banner that surfaces pi-web ↔ pi-coding-agent version mismatches.
 *
 * The check runs once on mount (and when refreshKey changes). When status is
 * "warning" or "error" we render a sticky bar above the chat area. The bar is
 * dismissible per-session but reappears after a reload so the mismatch is hard
 * to miss — for the user AND for the agent (which can read the DOM or fetch
 * /api/version-check directly).
 *
 * Clicking "Details" expands the remediation steps so the agent can read them
 * from the rendered page and act.
 */
export function VersionBanner({ refreshKey }: { refreshKey?: number }) {
  const [result, setResult] = useState<VersionCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/version-check");
      if (!res.ok) return;
      const data = (await res.json()) as VersionCheckResult;
      setResult(data);
      // Auto-expand errors so the agent sees remediation immediately.
      if (data.status === "error") setExpanded(true);
    } catch {
      // never let the banner break the app
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  if (!result || result.status === "ok" || dismissed) return null;

  const isError = result.status === "error";
  const bg = isError ? "#3b1414" : "#3a2e14";
  const border = isError ? "#7f1d1d" : "#7a5c14";
  const fg = isError ? "#fca5a5" : "#fcd34d";

  return (
    <div
      role="alert"
      data-version-banner
      data-version-status={result.status}
      style={{
        background: bg,
        color: fg,
        borderBottom: `1px solid ${border}`,
        padding: "6px 12px",
        fontSize: 12,
        lineHeight: 1.45,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600 }}>
          {isError ? "⚠ pi-web / pi-agent 版本不兼容" : "⚠ pi-web / pi-agent 版本不一致"}
        </span>
        <span style={{ opacity: 0.8 }}>
          内置 pi-coding-agent {result.bundledPiVersion}
          {result.dataDirVersion ? ` · 数据目录 ${result.dataDirVersion}` : ""}
          {result.globalPiVersion ? ` · 全局 pi ${result.globalPiVersion}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "transparent",
            border: `1px solid ${border}`,
            color: fg,
            padding: "1px 8px",
            borderRadius: 3,
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {expanded ? "收起" : "详情 / 修复步骤"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          title="本次会话内隐藏"
          style={{
            background: "transparent",
            border: "none",
            color: fg,
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ×
        </button>
      </div>

      {expanded && (
        <div style={{ whiteSpace: "pre-wrap", paddingTop: 2 }}>
          {result.messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 4 }}>• {m}</div>
          ))}
          {result.remediation.length > 0 && (
            <div style={{ marginTop: 6, opacity: 0.95 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>修复步骤（AI 可直接执行）：</div>
              {result.remediation.map((r, i) => (
                <div key={i} style={{ marginBottom: 4 }}>{i + 1}. {r}</div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 6, opacity: 0.7, fontSize: 11 }}>
            也可直接 GET /api/version-check 获取机器可读的诊断结果。
          </div>
        </div>
      )}
    </div>
  );
}
