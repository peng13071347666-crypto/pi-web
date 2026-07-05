"use client";

import { useState, useEffect, useMemo } from "react";

interface ModelItem {
  id: string;
  name: string;
  provider: string;
  input?: string[];
}

interface ProxyConfig {
  mode?: string;
  provider?: string;
  modelId?: string;
  videoProvider?: string;
  videoModelId?: string;
  tool?: string;
  includeContext?: boolean;
}

interface Props {
  sessionId?: string | null;
  onClose: () => void;
}

const MODES = [
  { value: "fallback", label: "自动", desc: "当前模型不支持看图时才启用代理" },
  { value: "always", label: "始终", desc: "无论当前模型是否支持看图，都强制走代理" },
  { value: "off", label: "关闭", desc: "完全禁用图片/视频代理" },
];

function Toggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: enabled ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

function modelValue(provider?: string, modelId?: string): string {
  return provider && modelId ? `${provider}/${modelId}` : "";
}

function ModelSelect({
  value,
  models,
  onChange,
  allowAll,
}: {
  value: string;
  models: ModelItem[];
  onChange: (v: string) => void;
  allowAll: boolean;
}) {
  const [customInput, setCustomInput] = useState("");

  const filtered = useMemo(
    () => (allowAll ? models : models.filter((m) => m.input?.includes("image"))),
    [models, allowAll],
  );
  const byProvider = useMemo(() => {
    const map = new Map<string, ModelItem[]>();
    for (const m of filtered) {
      if (!map.has(m.provider)) map.set(m.provider, []);
      map.get(m.provider)!.push(m);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const known = filtered.some((m) => `${m.provider}/${m.id}` === value);
  const isCustom = value && !known;

  const options: { label: string; value: string }[] = [];
  options.push({ label: "— 未设置 —", value: "" });
  for (const [, items] of byProvider) {
    for (const m of items) {
      options.push({
        label: `${m.name || m.id}  [${m.provider}]`,
        value: `${m.provider}/${m.id}`,
      });
    }
  }
  if (isCustom) {
    options.push({ label: `${value}（自定义，未在注册表中）`, value });
  }
  options.push({ label: "✏️ 手动输入…", value: "__custom__" });

  return (
    <div style={{ position: "relative" }}>
      <select
        value={customInput ? "__custom__" : value}
        onChange={(e) => {
          if (e.target.value === "__custom__") {
            setCustomInput(value || "");
            return;
          }
          setCustomInput("");
          onChange(e.target.value);
        }}
        style={{
          width: "100%",
          height: 34,
          padding: "0 8px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          color: "var(--text)",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          outline: "none",
          cursor: "pointer",
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {customInput !== null && customInput !== undefined ? (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="provider/model-id（如 xai/grok-vision-mini）"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onChange(customInput.trim());
                setCustomInput("");
              }
              if (e.key === "Escape") {
                setCustomInput("");
              }
            }}
            style={{
              flex: 1,
              height: 30,
              padding: "0 8px",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          />
          <button
            onClick={() => {
              const trimmed = customInput.trim();
              if (trimmed && trimmed.includes("/")) {
                onChange(trimmed);
                setCustomInput("");
              }
            }}
            disabled={!customInput.trim() || !customInput.includes("/")}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 7,
              border: "1px solid var(--accent)",
              background: "var(--accent)",
              color: "#fff",
              cursor: !customInput.trim() || !customInput.includes("/") ? "not-allowed" : "pointer",
              fontSize: 11,
              fontWeight: 600,
              opacity: !customInput.trim() || !customInput.includes("/") ? 0.5 : 1,
              whiteSpace: "nowrap",
            }}
          >
            确认
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{label}</span>
        {hint && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function MultimodalProxyConfig({ sessionId, onClose }: Props) {
  const [config, setConfig] = useState<ProxyConfig>({});
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfgRes, modelsRes] = await Promise.all([
          fetch("/api/multimodal-proxy"),
          fetch("/api/models"),
        ]);
        const cfg = (cfgRes.ok ? await cfgRes.json() : {}) as ProxyConfig;
        const modelsData = (modelsRes.ok ? await modelsRes.json() : {}) as { modelList?: ModelItem[] };
        if (cancelled) return;
        setConfig(cfg);
        setModels(modelsData.modelList ?? []);
      } catch (e) {
        if (!cancelled) setMsg({ kind: "err", text: `加载失败：${e instanceof Error ? e.message : String(e)}` });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visionValue = modelValue(config.provider, config.modelId);
  const videoValue = modelValue(config.videoProvider, config.videoModelId);

  function setModelField(v: string) {
    if (!v) {
      setConfig((c) => ({ ...c, provider: undefined, modelId: undefined }));
      return;
    }
    const slash = v.indexOf("/");
    setConfig((c) => ({ ...c, provider: v.slice(0, slash), modelId: v.slice(slash + 1) }));
  }
  function setVideoField(v: string) {
    if (!v) {
      setConfig((c) => ({ ...c, videoProvider: undefined, videoModelId: undefined }));
      return;
    }
    const slash = v.indexOf("/");
    setConfig((c) => ({ ...c, videoProvider: v.slice(0, slash), videoModelId: v.slice(slash + 1) }));
  }

  async function saveFile(apply: boolean) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/multimodal-proxy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(await res.text());

      if (apply && sessionId) {
        setApplying(true);
        try {
          const aRes = await fetch("/api/multimodal-proxy/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              provider: config.provider,
              modelId: config.modelId,
              mode: config.mode,
              tool: config.tool,
              videoProvider: config.videoProvider,
              videoModelId: config.videoModelId,
              includeContext: config.includeContext,
              consent: true,
            }),
          });
          const aData = aRes.ok ? await aRes.json() : null;
          if (!aRes.ok) {
            setMsg({ kind: "err", text: `配置已保存，但应用到当前会话失败：${aData?.error ?? aRes.statusText}` });
          } else {
            setMsg({
              kind: "ok",
              text: `已保存并应用到当前会话${aData?.applied ? `（执行了 ${aData.applied.length} 条命令）` : ""}。`,
            });
          }
        } finally {
          setApplying(false);
        }
      } else if (apply && !sessionId) {
        setMsg({
          kind: "info",
          text: "配置已保存到文件。当前没有活跃会话——下次新建会话时自动生效。",
        });
      } else {
        setMsg({ kind: "ok", text: "配置已保存到文件。新建会话时生效，或点击「保存并应用」对当前会话立即生效。" });
      }
    } catch (e) {
      setMsg({ kind: "err", text: `保存失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 560,
          maxHeight: "82vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>图片 / 视频代理</span>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>让纯文本模型也能看图、看视频</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
          {loading ? (
            <div style={{ padding: "20px 0", fontSize: 12, color: "var(--text-muted)" }}>加载中…</div>
          ) : (
            <>
              {/* Mode */}
              <Row label="代理模式" hint="什么时候启用代理">
                <div style={{ display: "flex", gap: 6 }}>
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setConfig((c) => ({ ...c, mode: m.value }))}
                      title={m.desc}
                      style={{
                        flex: 1,
                        height: 34,
                        padding: 0,
                        borderRadius: 7,
                        border: `1px solid ${config.mode === m.value ? "rgba(37,99,235,0.45)" : "var(--border)"}`,
                        background: config.mode === m.value ? "rgba(37,99,235,0.10)" : "var(--bg-panel)",
                        color: config.mode === m.value ? "var(--accent)" : "var(--text-muted)",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 500,
                        transition: "all 0.12s",
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </Row>

              {/* Vision model */}
              <Row label="看图模型" hint="负责分析图片、生成文字描述">
                <ModelSelect value={visionValue} models={models} onChange={setModelField} allowAll={false} />
              </Row>

              {/* Video model */}
              <Row label="视频 / 音频模型" hint="负责转录语音、分析视频内容">
                <ModelSelect value={videoValue} models={models} onChange={setVideoField} allowAll={true} />
              </Row>

              {/* Tool toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>图片分析工具</span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>允许 AI 在对话中裁剪放大、追问图片细节</span>
                </div>
                <Toggle
                  enabled={config.tool === "on"}
                  onChange={() => setConfig((c) => ({ ...c, tool: c.tool === "on" ? "off" : "on" }))}
                />
              </div>

              {/* Context toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>携带聊天上下文</span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>把最近的聊天记录一起发给看图模型，帮助它理解你在问什么</span>
                </div>
                <Toggle
                  enabled={config.includeContext !== false}
                  onChange={() => setConfig((c) => ({ ...c, includeContext: c.includeContext === false ? true : false }))}
                />
              </div>

              {/* Status note */}
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-dim)",
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  padding: "8px 10px",
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: "var(--text-muted)" }}>说明：</strong>
                「保存并应用」会写入配置文件，同时立即推送到当前会话（含数据外发授权）。
                「仅保存」只写文件，下次新建会话时才生效。
                {sessionId ? (
                  <span style={{ color: "rgba(34,197,94,0.8)" }}> 当前有活跃会话，可以直接应用。</span>
                ) : (
                  <span style={{ color: "#f59e0b" }}> 当前无活跃会话，只能保存文件。</span>
                )}
              </div>

              {msg && (
                <div
                  style={{
                    fontSize: 11,
                    padding: "8px 10px",
                    borderRadius: 7,
                    background:
                      msg.kind === "ok"
                        ? "rgba(34,197,94,0.10)"
                        : msg.kind === "err"
                          ? "rgba(239,68,68,0.10)"
                          : "rgba(245,158,11,0.10)",
                    color:
                      msg.kind === "ok" ? "rgba(34,197,94,0.9)" : msg.kind === "err" ? "#f87171" : "#f59e0b",
                    border: `1px solid ${msg.kind === "ok" ? "rgba(34,197,94,0.25)" : msg.kind === "err" ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)"}`,
                  }}
                >
                  {msg.text}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <button
            onClick={onClose}
            style={{
              height: 34,
              padding: "0 14px",
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            关闭
          </button>
          <button
            onClick={() => saveFile(false)}
            disabled={loading || saving}
            style={{
              height: 34,
              padding: "0 14px",
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text)",
              cursor: loading || saving ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 500,
              opacity: loading || saving ? 0.6 : 1,
            }}
          >
            {saving ? "保存中…" : "仅保存"}
          </button>
          <button
            onClick={() => saveFile(true)}
            disabled={loading || saving || applying}
            style={{
              height: 34,
              padding: "0 14px",
              borderRadius: 7,
              border: "1px solid rgba(37,99,235,0.4)",
              background: "var(--accent)",
              color: "#fff",
              cursor: loading || saving || applying ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 600,
              opacity: loading || saving || applying ? 0.6 : 1,
            }}
          >
            {applying ? "应用中…" : saving ? "保存中…" : "保存并应用"}
          </button>
        </div>
      </div>
    </div>
  );
}
