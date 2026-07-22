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
  latestVersion?: string | null;
  updateAvailable?: boolean;
}

/**
 * Banner that surfaces pi-web ↔ pi-coding-agent version mismatches
 * AND available updates from npm.
 */
export function VersionBanner({ refreshKey }: { refreshKey?: number }) {
  const [result, setResult] = useState<VersionCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/version-check");
      if (!res.ok) return;
      const data = (await res.json()) as VersionCheckResult;
      setResult(data);
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

  const handleUpdate = useCallback(async () => {
    if (!result?.latestVersion) return;
    setUpdating(true);
    setUpdateResult(null);
    try {
      const res = await fetch(`/api/version-check/update?target=${encodeURIComponent(result.latestVersion ?? "latest")}&scope=global`);
      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      setUpdateResult({
        success: !!data.success,
        message: data.message,
        error: data.error,
      });
      if (data.success) {
        // Reload version info after successful update
        setTimeout(() => void load(), 1000);
      }
    } catch (e) {
      setUpdateResult({ success: false, error: String(e) });
    } finally {
      setUpdating(false);
    }
  }, [result?.latestVersion, load]);

  if (!result || dismissed) return null;

  const hasMismatch = result.status !== "ok";
  const hasUpdate = result.updateAvailable && result.latestVersion;

  // Nothing to show
  if (!hasMismatch && !hasUpdate) return null;

  const isError = result.status === "error";
  // Update available = blue/info style; mismatch = yellow/red
  const bg = hasUpdate && !hasMismatch ? "#1a2744" : isError ? "#3b1414" : "#3a2e14";
  const border = hasUpdate && !hasMismatch ? "#1d4ed8" : isError ? "#7f1d1d" : "#7a5c14";
  const fg = hasUpdate && !hasMismatch ? "#93c5fd" : isError ? "#fca5a5" : "#fcd34d";

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Update available badge */}
        {hasUpdate && (
          <>
            <span style={{ fontWeight: 600 }}>
              ⬆ Pi Agent CLI 有更新
            </span>
            <span style={{ opacity: 0.8 }}>
              当前 v{result.globalPiVersion ?? result.bundledPiVersion} → 最新 v{result.latestVersion}
            </span>
            <button
              onClick={handleUpdate}
              disabled={updating}
              style={{
                background: updating ? "transparent" : "#2563eb",
                border: "1px solid #3b82f6",
                color: "#fff",
                padding: "2px 10px",
                borderRadius: 4,
                cursor: updating ? "wait" : "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {updating ? "更新中…" : "一键更新"}
            </button>
          </>
        )}

        {/* Version mismatch badge */}
        {hasMismatch && (
          <>
            {hasUpdate && <span style={{ opacity: 0.3 }}>|</span>}
            <span style={{ fontWeight: 600 }}>
              {isError ? "⚠ 版本不兼容" : "⚠ 版本不一致"}
            </span>
            <span style={{ opacity: 0.8 }}>
              内置 {result.bundledPiVersion}
              {result.dataDirVersion ? ` · 数据目录 ${result.dataDirVersion}` : ""}
              {result.globalPiVersion ? ` · 全局 pi ${result.globalPiVersion}` : ""}
            </span>
          </>
        )}

        <span style={{ flex: 1 }} />

        {hasMismatch && (
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
            {expanded ? "收起" : "详情"}
          </button>
        )}
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

      {/* Update result message */}
      {updateResult && (
        <div style={{ fontSize: 11, color: updateResult.success ? "#4ade80" : "#f87171", whiteSpace: "pre-wrap" }}>
          {updateResult.success
            ? updateResult.message ?? "✓ 更新完成，请重启服务"
            : updateResult.message ?? `✗ 更新失败: ${updateResult.error}`}
        </div>
      )}

      {/* Mismatch details */}
      {expanded && hasMismatch && (
        <div style={{ whiteSpace: "pre-wrap", paddingTop: 2 }}>
          {result.messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 4 }}>• {m}</div>
          ))}
          {result.remediation.length > 0 && (
            <div style={{ marginTop: 6, opacity: 0.95 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>修复步骤：</div>
              {result.remediation.map((r, i) => (
                <div key={i} style={{ marginBottom: 4 }}>{i + 1}. {r}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
