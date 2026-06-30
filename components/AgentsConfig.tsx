"use client";

import { useState, useEffect, useCallback } from "react";

interface Agent {
  name: string;
  description: string;
  filePath: string;
  enabled: boolean;
  tools?: string;
  model?: string;
  source: "global" | "project";
}

function shortenPath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function sourceLabel(source: string): "project" | "global" {
  return source === "project" ? "project" : "global";
}

function Toggle({
  enabled,
  loading,
  onToggle,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      title={
        enabled
          ? "Agent is enabled — click to disable"
          : "Agent is disabled — click to enable"
      }
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
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

function AgentDetail({
  agent,
  cwd,
  onToggle,
  toggling,
  saveError,
  onSaved,
}: {
  agent: Agent;
  cwd: string;
  onToggle: (agent: Agent) => void;
  toggling: boolean;
  saveError: string | null;
  onSaved: () => void;
}) {
  const label = sourceLabel(agent.source);
  const enabled = agent.enabled;
  const [editing, setEditing] = useState(false);
  const [editModel, setEditModel] = useState(agent.model ?? "");
  const [editTools, setEditTools] = useState(agent.tools ?? "");
  const [editDescription, setEditDescription] = useState(agent.description ?? "");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Available models from API
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [customModel, setCustomModel] = useState(false);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: { modelList?: { id: string; name: string; provider: string }[] }) => {
        const list = d.modelList ?? [];
        // Deduplicate by provider/modelId, keep first
        const seen = new Set<string>();
        const unique = list.filter((m) => {
          const key = `${m.provider}/${m.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setAvailableModels(unique);
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, []);

  // Detect if current model is in the list or is custom
  useEffect(() => {
    if (editModel && availableModels.length > 0) {
      const found = availableModels.some(
        (m) =>
          m.id === editModel ||
          `${m.provider}/${m.id}` === editModel
      );
      setCustomModel(!found && editModel !== "");
    }
  }, [editModel, availableModels]);

  // Sync when agent changes
  useEffect(() => {
    setEditModel(agent.model ?? "");
    setEditTools(agent.tools ?? "");
    setEditDescription(agent.description ?? "");
    setEditing(false);
    setCustomModel(false);
  }, [agent.filePath]);

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  async function handleSave() {
    setSaving(true);
    setEditError(null);
    const updates: Record<string, string | null> = {};
    if (editModel !== (agent.model ?? "")) updates.model = editModel || null;
    if (editTools !== (agent.tools ?? "")) updates.tools = editTools || null;
    if (editDescription !== (agent.description ?? "")) updates.description = editDescription || null;

    if (Object.keys(updates).length === 0) {
      setEditing(false);
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: agent.filePath, updates }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setEditError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setEditing(false);
      onSaved();
    } catch (e) {
      setEditError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setEditModel(agent.model ?? "");
    setEditTools(agent.tools ?? "");
    setEditDescription(agent.description ?? "");
    setEditing(false);
    setEditError(null);
  }

  const fieldStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: "var(--text-muted)",
    fontWeight: 500,
  };

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px",
    fontSize: 13,
    fontFamily: "var(--font-mono)",
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    color: "var(--text)",
    outline: "none",
  };

  const valueTextStyle: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 14,
    color: "var(--text)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Path + tag + toggle + edit button */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            fontSize: 10,
            padding: "1px 5px",
            borderRadius: 3,
            flexShrink: 0,
            background:
              label === "project"
                ? "rgba(99,102,241,0.12)"
                : "rgba(120,120,120,0.12)",
            color:
              label === "project" ? "rgba(99,102,241,0.8)" : "var(--text-dim)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayPath(agent.filePath)}
        </span>
        <Toggle
          enabled={enabled}
          loading={toggling}
          onToggle={() => onToggle(agent)}
        />
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            style={{
              flexShrink: 0,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 500,
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--accent)",
              cursor: "pointer",
            }}
          >
            Edit
          </button>
        )}
        {saveError && (
          <span style={{ fontSize: 12, color: "#f87171", flexShrink: 0 }}>
            {saveError}
          </span>
        )}
      </div>

      {/* Status badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: enabled ? "#22c55e" : "var(--border)",
            boxShadow: enabled ? "0 0 6px rgba(34,197,94,0.5)" : "none",
          }}
        />
        <span
          style={{
            fontSize: 13,
            color: enabled ? "#22c55e" : "var(--text-dim)",
            fontWeight: 500,
          }}
        >
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      {/* Name — always read-only */}
      <div style={fieldStyle}>
        <span style={labelStyle}>Name</span>
        <span style={valueTextStyle}>{agent.name}</span>
      </div>

      {/* Description */}
      <div style={fieldStyle}>
        <span style={labelStyle}>Description</span>
        {editing ? (
          <textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
          />
        ) : (
          <span style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
            {agent.description || "No description"}
          </span>
        )}
      </div>

      {/* Model */}
      <div style={fieldStyle}>
        <span style={labelStyle}>Default Model</span>
        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {!customModel ? (
              <>
                <select
                  value={editModel}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__custom__") {
                      setCustomModel(true);
                      setEditModel("");
                    } else {
                      setEditModel(val);
                    }
                  }}
                  disabled={modelsLoading}
                  style={{
                    ...inputStyle,
                    appearance: "auto",
                    cursor: "pointer",
                  }}
                >
                  <option value="">-- No default model --</option>
                  {availableModels.map((m) => (
                    <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                      {m.name} ({m.provider}/{m.id})
                    </option>
                  ))}
                  <option value="__custom__">✎ Custom model...</option>
                </select>
                {modelsLoading && (
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Loading models…</span>
                )}
              </>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  placeholder="e.g. claude-sonnet-4-5"
                  style={{ ...inputStyle, flex: 1 }}
                  autoFocus
                />
                <button
                  onClick={() => {
                    setCustomModel(false);
                    setEditModel(agent.model ?? "");
                  }}
                  style={{
                    padding: "7px 10px",
                    fontSize: 11,
                    borderRadius: 5,
                    border: "1px solid var(--border)",
                    background: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  ← List
                </button>
              </div>
            )}
          </div>
        ) : (
          <span style={valueTextStyle}>
            {agent.model || <span style={{ color: "var(--text-dim)" }}>Not set</span>}
          </span>
        )}
      </div>

      {/* Tools */}
      <div style={fieldStyle}>
        <span style={labelStyle}>Tools</span>
        {editing ? (
          <input
            type="text"
            value={editTools}
            onChange={(e) => setEditTools(e.target.value)}
            placeholder="e.g. read, grep, find, ls, bash"
            style={inputStyle}
          />
        ) : (
          agent.tools ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {agent.tools.split(",").map((tool) => (
                <span
                  key={tool.trim()}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    padding: "2px 7px",
                    borderRadius: 3,
                    background: "rgba(99,102,241,0.08)",
                    color: "rgba(99,102,241,0.85)",
                  }}
                >
                  {tool.trim()}
                </span>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
              All tools available
            </span>
          )
        )}
      </div>

      {/* Edit actions */}
      {editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "7px 18px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            style={{
              padding: "7px 14px",
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-muted)",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          {editError && (
            <span style={{ fontSize: 12, color: "#f87171" }}>{editError}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentsConfig({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadAgents = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/agents?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((d: { agents?: Agent[]; error?: string }) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        const list = d.agents ?? [];
        setAgents(list);
        if (list.length > 0 && !selected) setSelected(list[0].filePath);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [cwd, selected]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const toggle = useCallback(async (agent: Agent) => {
    const next = !agent.enabled;
    setToggling((s) => new Set(s).add(agent.filePath));
    setSaveError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: agent.filePath,
          enabled: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setAgents((prev) =>
        prev.map((a) =>
          a.filePath === agent.filePath ? { ...a, enabled: next } : a
        )
      );
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(agent.filePath);
        return n;
      });
    }
  }, []);

  const selectedAgent = agents.find((a) => a.filePath === selected) ?? null;

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
          width: 860,
          height: "78vh",
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
            <span
              style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}
            >
              Agents
            </span>
            <code
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenPath(cwd)}
            </code>
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
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Left: agent list */}
          <div
            style={{
              width: 210,
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              background: "var(--bg-panel)",
            }}
          >
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              {loading ? (
                <div
                  style={{
                    padding: "10px 8px",
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  Loading…
                </div>
              ) : error ? (
                <div
                  style={{
                    padding: "10px 8px",
                    fontSize: 11,
                    color: "#f87171",
                  }}
                >
                  {error}
                </div>
              ) : agents.length === 0 ? (
                <div style={{ padding: "10px 8px" }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-dim)",
                      marginBottom: 10,
                    }}
                  >
                    No agents found
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      lineHeight: 1.7,
                    }}
                  >
                    Add <code>.md</code> files to{" "}
                    <code>~/.pi/agent/agents/</code> (global) or{" "}
                    <code>.pi/agents/</code> (project) to create custom agents.
                  </div>
                </div>
              ) : (
                (() => {
                  const groups: {
                    label: string;
                    agents: typeof agents;
                  }[] = [];
                  for (const grpLabel of ["global", "project"]) {
                    const grpAgents = agents.filter(
                      (a) => a.source === grpLabel
                    );
                    if (grpAgents.length > 0)
                      groups.push({ label: grpLabel, agents: grpAgents });
                  }
                  return groups.map(
                    ({ label: grpLabel, agents: grpAgents }) => (
                      <div key={grpLabel} style={{ marginBottom: 6 }}>
                        <div
                          style={{
                            padding: "4px 8px 3px",
                            fontSize: 10,
                            fontWeight: 600,
                            color: "var(--text-dim)",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {grpLabel}
                        </div>
                        {grpAgents.map((agent) => {
                          const isSelected = selected === agent.filePath;
                          const disabled = !agent.enabled;
                          return (
                            <div
                              key={agent.filePath}
                              onClick={() => setSelected(agent.filePath)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 7,
                                padding: "8px 8px",
                                borderRadius: 5,
                                cursor: "pointer",
                                background: isSelected
                                  ? "var(--bg-selected)"
                                  : "none",
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected)
                                  e.currentTarget.style.background =
                                    "var(--bg-hover)";
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected)
                                  e.currentTarget.style.background = "none";
                              }}
                            >
                              <span
                                style={{
                                  flexShrink: 0,
                                  width: 7,
                                  height: 7,
                                  borderRadius: "50%",
                                  background: disabled
                                    ? "var(--border)"
                                    : "var(--accent)",
                                  boxShadow: disabled
                                    ? "none"
                                    : "0 0 4px var(--accent)",
                                  transition:
                                    "background 0.15s, box-shadow 0.15s",
                                }}
                              />
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: isSelected ? 600 : 400,
                                  color: disabled
                                    ? "var(--text-dim)"
                                    : "var(--text)",
                                  fontFamily: "var(--font-mono)",
                                  flex: 1,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {agent.name}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )
                  );
                })()
              )}
            </div>
          </div>

          {/* Right: detail panel */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {loading ? null : selectedAgent ? (
              <AgentDetail
                key={selectedAgent.filePath}
                agent={selectedAgent}
                cwd={cwd}
                onToggle={toggle}
                toggling={toggling.has(selectedAgent.filePath)}
                saveError={saveError}
                onSaved={loadAgents}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                {agents.length === 0
                  ? "Add agents to get started"
                  : "Select an agent"}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
