"use client";

import { useState, useEffect, useCallback } from "react";

// ---------- shared types ----------
type SourceType = "npm" | "git" | "user" | "project";

interface AgentInfo {
  name: string;
  description: string;
  filePath: string;
  tools?: string;
  model?: string;
  thinking?: string;
  customizedFrom?: string;
  ownEnabled: boolean;
  effectiveEnabled: boolean;
  overridden: boolean;
  skinnyOverride: boolean;
  groupId: string;
  groupType: SourceType;
}

interface Group {
  type: SourceType;
  id: string;
  label: string;
  basePath: string;
  editable: boolean;
  agents: AgentInfo[];
}

interface ApiModel {
  id: string;
  name: string;
  provider: string;
}

// ---------- helpers ----------
function shortenPath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function groupIcon(type: SourceType): string {
  switch (type) {
    case "npm":
      return "📦";
    case "git":
      return " Branch";
    case "user":
      return "👤";
    case "project":
      return "📂";
  }
}

function typeBadgeColor(type: SourceType): { bg: string; color: string } {
  switch (type) {
    case "project":
      return { bg: "rgba(99,102,241,0.12)", color: "rgba(99,102,241,0.8)" };
    case "user":
      return { bg: "rgba(34,197,94,0.12)", color: "rgba(34,197,94,0.8)" };
    case "git":
      return { bg: "rgba(249,115,22,0.12)", color: "rgba(249,115,22,0.85)" };
    case "npm":
      return { bg: "rgba(120,120,120,0.12)", color: "var(--text-dim)" };
  }
}

// ---------- generic toggle ----------
function Toggle({
  enabled,
  loading,
  onToggle,
  size = 40,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
  size?: number;
}) {
  const h = Math.round(size * 0.55);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      disabled={loading}
      title={enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
      style={{
        flexShrink: 0,
        width: size,
        height: h,
        borderRadius: h / 2,
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
          left: enabled ? size - h + 3 : 3,
          width: h - 6,
          height: h - 6,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

// ============================================================
// Agent detail panel
// ============================================================
function AgentDetail({
  agent,
  group,
  cwd,
  onToggle,
  onDelete,
  onCustomize,
  toggling,
  deleting,
  customizing,
  saveError,
  onSaved,
}: {
  agent: AgentInfo;
  group: Group;
  cwd: string;
  onToggle: (agent: AgentInfo) => void;
  onDelete: (agent: AgentInfo) => void;
  onCustomize: (agent: AgentInfo) => void;
  toggling: boolean;
  deleting: boolean;
  customizing: boolean;
  saveError: string | null;
  onSaved: () => void;
}) {
  const editable = group.editable && !agent.skinnyOverride;
  const [editing, setEditing] = useState(false);
  const [editModel, setEditModel] = useState(agent.model ?? "");
  const [editTools, setEditTools] = useState(agent.tools ?? "");
  const [editThinking, setEditThinking] = useState(agent.thinking ?? "");
  const [editDescription, setEditDescription] = useState(agent.description ?? "");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [availableModels, setAvailableModels] = useState<ApiModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [customModel, setCustomModel] = useState(false);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: { modelList?: ApiModel[] }) => {
        const list = d.modelList ?? [];
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

  useEffect(() => {
    if (editModel && availableModels.length > 0) {
      const found = availableModels.some(
        (m) => m.id === editModel || `${m.provider}/${m.id}` === editModel
      );
      setCustomModel(!found && editModel !== "");
    }
  }, [editModel, availableModels]);

  useEffect(() => {
    setEditModel(agent.model ?? "");
    setEditTools(agent.tools ?? "");
    setEditThinking(agent.thinking ?? "");
    setEditDescription(agent.description ?? "");
    setEditing(false);
    setCustomModel(false);
    setConfirmDelete(false);
  }, [agent.filePath]);

  async function handleSave() {
    setSaving(true);
    setEditError(null);
    const updates: Record<string, string | null> = {};
    if (editModel !== (agent.model ?? "")) updates.model = editModel || null;
    if (editTools !== (agent.tools ?? "")) updates.tools = editTools || null;
    if (editThinking !== (agent.thinking ?? "")) updates.thinking = editThinking || null;
    if (editDescription !== (agent.description ?? ""))
      updates.description = editDescription || null;
    if (Object.keys(updates).length === 0) {
      setEditing(false);
      setSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: agent.filePath, cwd, updates }),
      });
      const d = await res.json();
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
    setEditThinking(agent.thinking ?? "");
    setEditDescription(agent.description ?? "");
    setEditing(false);
    setEditError(null);
  }

  async function handleDelete() {
    setConfirmDelete(false);
    onDelete(agent);
  }

  const badge = typeBadgeColor(agent.groupType);
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

  const enabled = agent.effectiveEnabled;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 3,
            flexShrink: 0,
            background: badge.bg,
            color: badge.color,
          }}
        >
          {agent.groupType}
        </span>
        {agent.overridden && (
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 3,
              background: "rgba(234,179,8,0.12)",
              color: "rgba(234,179,8,0.9)",
              flexShrink: 0,
            }}
            title="A higher-priority file with the same name overrides this one"
          >
            overridden
          </span>
        )}
        {agent.skinnyOverride && (
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 3,
              background: "rgba(120,120,120,0.12)",
              color: "var(--text-dim)",
              flexShrink: 0,
            }}
            title="Auto-generated stub used to disable a builtin"
          >
            override stub
          </span>
        )}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 120,
          }}
        >
          {shortenPath(agent.filePath)}
        </span>
        <Toggle
          enabled={enabled}
          loading={toggling}
          onToggle={() => onToggle(agent)}
        />
        {editable && !editing && (
          <button
            onClick={() => setEditing(true)}
            style={btnAccent}
          >
            Edit
          </button>
        )}
        {editable && (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            style={btnGhost}
            title="Delete this agent file"
          >
            {deleting ? "…" : "Delete"}
          </button>
        )}
        {saveError && (
          <span style={{ fontSize: 12, color: "#f87171", flexShrink: 0 }}>
            {saveError}
          </span>
        )}
      </div>

      {/* delete confirm */}
      {confirmDelete && (
        <div
          style={{
            padding: 10,
            borderRadius: 6,
            border: "1px solid rgba(248,113,113,0.4)",
            background: "rgba(248,113,113,0.06)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text)" }}>
            Delete <code>{agent.name}</code>? This removes the file. Cannot undo.
          </span>
          <button
            onClick={handleDelete}
            style={{ ...btnAccent, background: "#ef4444", borderColor: "#ef4444" }}
          >
            Delete
          </button>
          <button onClick={() => setConfirmDelete(false)} style={btnGhost}>
            Cancel
          </button>
        </div>
      )}

      {/* status */}
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
          {agent.overridden && (
            <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>
              {" "}
              (effective — overridden)
            </span>
          )}
        </span>
      </div>

      {/* name */}
      <div style={fieldStyle}>
        <span style={labelStyle}>Name</span>
        <span style={valueTextStyle}>{agent.name}</span>
      </div>

      {/* description */}
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

      {/* model */}
      <div style={fieldStyle}>
        <span style={labelStyle}>Default Model</span>
        {editing ? (
          !customModel ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <select
                value={editModel}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__custom__") {
                    setCustomModel(true);
                    setEditModel("");
                  } else setEditModel(v);
                }}
                disabled={modelsLoading}
                style={{ ...inputStyle, appearance: "auto", cursor: "pointer" }}
              >
                <option value="">-- No default model --</option>
                {availableModels.map((m) => (
                  <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                    {m.name} ({m.provider}/{m.id})
                  </option>
                ))}
                <option value="__custom__">✎ Custom model…</option>
              </select>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                placeholder="e.g. anthropic/claude-sonnet-4"
                style={{ ...inputStyle, flex: 1 }}
                autoFocus
              />
              <button
                onClick={() => {
                  setCustomModel(false);
                  setEditModel(agent.model ?? "");
                }}
                style={btnGhost}
              >
                ← List
              </button>
            </div>
          )
        ) : (
          <span style={valueTextStyle}>
            {agent.model || (
              <span style={{ color: "var(--text-dim)" }}>Not set (inherits parent)</span>
            )}
          </span>
        )}
      </div>

      {/* thinking */}
      <div style={fieldStyle}>
        <span style={labelStyle}>Thinking</span>
        {editing ? (
          <select
            value={editThinking}
            onChange={(e) => setEditThinking(e.target.value)}
            style={{ ...inputStyle, appearance: "auto", cursor: "pointer" }}
          >
            <option value="">-- inherit --</option>
            {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ) : (
          <span style={valueTextStyle}>
            {agent.thinking || (
              <span style={{ color: "var(--text-dim)" }}>Not set (inherits)</span>
            )}
          </span>
        )}
      </div>

      {/* tools */}
      <div style={fieldStyle}>
        <span style={labelStyle}>Tools</span>
        {editing ? (
          <input
            value={editTools}
            onChange={(e) => setEditTools(e.target.value)}
            placeholder="e.g. read, grep, find, ls, bash"
            style={inputStyle}
          />
        ) : agent.tools ? (
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
        )}
      </div>

      {editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <button onClick={handleSave} disabled={saving} style={btnAccent}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={handleCancel} disabled={saving} style={btnGhost}>
            Cancel
          </button>
          {editError && (
            <span style={{ fontSize: 12, color: "#f87171" }}>{editError}</span>
          )}
        </div>
      )}

      {!editable && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.6,
            padding: 10,
            border: "1px dashed var(--border)",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div>
            This agent comes from package{" "}
            <code style={{ color: "var(--text)" }}>{group.label}</code> and is
            read-only. Customize it to fork a full copy (system prompt +
            frontmatter) into <strong>My agents</strong> that you can edit —
            upgrades to the package won't override your customized copy.
          </div>
          <div>
            <button
              onClick={() => onCustomize(agent)}
              disabled={customizing}
              style={{
                ...btnAccent,
                fontSize: 12,
                padding: "6px 14px",
              }}
            >
              {customizing ? "Forking…" : "⚙ Customize this agent"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Agent row (used in both flat and sub-grouped lists)
// ============================================================
function AgentRow({
  agent,
  selected,
  onSelect,
  indent = 26,
}: {
  agent: AgentInfo;
  selected: string | null;
  onSelect: (filePath: string) => void;
  indent?: number;
}) {
  const isSelected = selected === agent.filePath;
  const dim = !agent.effectiveEnabled;
  return (
    <div
      onClick={() => onSelect(agent.filePath)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: `6px 8px 6px ${indent}px`,
        borderRadius: 5,
        cursor: "pointer",
        background: isSelected ? "var(--bg-selected)" : "none",
        opacity: agent.overridden ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: dim ? "var(--border)" : "var(--accent)",
          boxShadow: dim ? "none" : "0 0 4px var(--accent)",
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: isSelected ? 600 : 400,
          color: dim ? "var(--text-dim)" : "var(--text)",
          fontFamily: "var(--font-mono)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {agent.name}
      </span>
      {agent.skinnyOverride && (
        <span
          style={{ fontSize: 9, color: "var(--text-dim)", flexShrink: 0 }}
          title="Override stub (disabled)"
        >
          ⛔
        </span>
      )}
    </div>
  );
}

// ============================================================
// Create agent form
// ============================================================
function CreateAgentForm({
  defaultScope,
  cwd,
  onCreated,
  onCancel,
}: {
  defaultScope: "user" | "project";
  cwd: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<"user" | "project">(defaultScope);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [tools, setTools] = useState("read, grep, find, ls, bash");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [extra, setExtra] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availableModels, setAvailableModels] = useState<ApiModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [customModel, setCustomModel] = useState(false);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: { modelList?: ApiModel[] }) => {
        const list = d.modelList ?? [];
        const seen = new Set<string>();
        setAvailableModels(
          list.filter((m) => {
            const k = `${m.provider}/${m.id}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
        );
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, []);

  async function handleCreate() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!systemPrompt.trim()) {
      setError("System prompt is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          name,
          description,
          model,
          thinking,
          tools,
          systemPrompt,
          extraFrontmatter: extra,
          cwd,
        }),
      });
      const d = await res.json();
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      onCreated();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = {
    padding: "7px 10px",
    fontSize: 13,
    fontFamily: "var(--font-mono)",
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    color: "var(--text)",
    outline: "none",
    width: "100%",
  };
  const lbl: React.CSSProperties = {
    fontSize: 12,
    color: "var(--text-muted)",
    fontWeight: 500,
    marginBottom: 3,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: 560,
          maxHeight: "86vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            New agent
          </span>
          <button onClick={onCancel} style={btnGhost}>
            ×
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* scope */}
          <div>
            <div style={lbl}>Scope</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["user", "project"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  style={{
                    padding: "7px 14px",
                    fontSize: 12,
                    borderRadius: 5,
                    border: "1px solid var(--border)",
                    background: scope === s ? "var(--accent)" : "none",
                    color: scope === s ? "#fff" : "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  {s === "user" ? "My agents (~/.pi/agent/agents)" : "This project (.pi/agents)"}
                </button>
              ))}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                lineHeight: 1.5,
                marginTop: 4,
              }}
            >
              {scope === "user"
                ? "User-global — available in every project on this machine. Stays on your computer, not committed to any repo."
                : "Project-local — only for the current project's cwd. Lives in .pi/agents/ and is committed to the repo, so teammates share it."}
            </div>
          </div>
          {/* name */}
          <div>
            <div style={lbl}>Name *</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. security-auditor"
              style={inp}
              autoFocus
            />
          </div>
          {/* description */}
          <div>
            <div style={lbl}>Description</div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary shown in tool listings"
              style={inp}
            />
          </div>
          {/* model + thinking */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Default model</div>
              {!customModel ? (
                <select
                  value={model}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__custom__") {
                      setCustomModel(true);
                      setModel("");
                    } else setModel(v);
                  }}
                  disabled={modelsLoading}
                  style={{ ...inp, appearance: "auto", cursor: "pointer" }}
                >
                  <option value="">-- inherit parent --</option>
                  {availableModels.map((m) => (
                    <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                      {m.name} ({m.provider}/{m.id})
                    </option>
                  ))}
                  <option value="__custom__">✎ Custom…</option>
                </select>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="anthropic/claude-sonnet-4"
                    style={inp}
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      setCustomModel(false);
                      setModel("");
                    }}
                    style={{ ...btnGhost, flexShrink: 0 }}
                  >
                    ←
                  </button>
                </div>
              )}
            </div>
            <div style={{ width: 130 }}>
              <div style={lbl}>Thinking</div>
              <select
                value={thinking}
                onChange={(e) => setThinking(e.target.value)}
                style={{ ...inp, appearance: "auto", cursor: "pointer" }}
              >
                <option value="">-- inherit --</option>
                {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* tools */}
          <div>
            <div style={lbl}>Tools</div>
            <input
              value={tools}
              onChange={(e) => setTools(e.target.value)}
              placeholder="read, grep, find, ls, bash"
              style={inp}
            />
          </div>
          {/* system prompt */}
          <div>
            <div style={lbl}>System prompt *</div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={6}
              style={{ ...inp, resize: "vertical", minHeight: 120, fontFamily: "var(--font-mono)" }}
              placeholder={"You are a ... agent.\n\nWorking rules:\n- ..."}
            />
          </div>
          {/* extra frontmatter */}
          <div>
            <div style={lbl}>
              Extra frontmatter (raw YAML, one <code>key: value</code> per line, optional)
            </div>
            <textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              rows={3}
              style={{ ...inp, resize: "vertical", minHeight: 70, fontFamily: "var(--font-mono)" }}
              placeholder={"inheritProjectContext: true\nmemory:\n  scope: project"}
            />
          </div>
          {error && (
            <div style={{ fontSize: 12, color: "#f87171" }}>{error}</div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button onClick={onCancel} style={btnGhost}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={saving} style={btnAccent}>
            {saving ? "Creating…" : "Create agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// button styles
// ============================================================
const btnAccent: React.CSSProperties = {
  flexShrink: 0,
  padding: "5px 12px",
  fontSize: 11,
  fontWeight: 500,
  borderRadius: 5,
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "#fff",
  cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  flexShrink: 0,
  padding: "5px 12px",
  fontSize: 11,
  fontWeight: 500,
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
};

// ============================================================
// main
// ============================================================
export function AgentsConfig({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [subExpanded, setSubExpanded] = useState<Set<string>>(new Set());
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [customizing, setCustomizing] = useState<Set<string>>(new Set());
  const [groupToggling, setGroupToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | "user" | "project">(null);

  const loadAgents = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/agents?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((d: { groups?: Group[]; error?: string }) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        const list = d.groups ?? [];
        setGroups(list);
        // auto-expand all groups on first load
        setExpanded(new Set(list.map((g) => g.id)));
        if (!selected && list.length > 0) {
          // pick first editable agent or any first
          for (const g of list) {
            if (g.agents.length > 0) {
              setSelected(g.agents[0].filePath);
              break;
            }
          }
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [cwd, selected]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  function pickSelected(prev: Group[], sel: string | null): AgentInfo | null {
    for (const g of prev) {
      const a = g.agents.find((x) => x.filePath === sel);
      if (a) return a;
    }
    return null;
  }

  const toggle = useCallback(
    async (agent: AgentInfo) => {
      const next = !agent.effectiveEnabled;
      setToggling((s) => new Set(s).add(agent.name));
      setSaveError(null);
      try {
        const res = await fetch("/api/agents", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: agent.name, enabled: next, cwd }),
        });
        const d = await res.json();
        if (!res.ok || d.error) {
          setSaveError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        setGroups((prev) => {
          const nextGroups = prev.map((g) => ({
            ...g,
            agents: g.agents.map((a) =>
              a.name === agent.name
                ? {
                    ...a,
                    effectiveEnabled: next,
                    ownEnabled: a.groupType === "project" || a.groupType === "user" ? next : a.ownEnabled,
                  }
                : a
            ),
          }));
          return nextGroups;
        });
      } catch (e) {
        setSaveError(String(e));
      } finally {
        setToggling((s) => {
          const n = new Set(s);
          n.delete(agent.name);
          return n;
        });
      }
    },
    [cwd]
  );

  const reloadGroups = useCallback(
    (selectName?: string) => {
      fetch(`/api/agents?cwd=${encodeURIComponent(cwd)}`)
        .then((r) => r.json())
        .then((data: { groups?: Group[]; error?: string }) => {
          if (data.groups) {
            setGroups(data.groups);
            setExpanded(new Set(data.groups.map((g) => g.id)));
            if (selectName) {
              for (const g of data.groups) {
                const found = g.agents.find(
                  (a) => a.name === selectName && a.groupType === "user"
                );
                if (found) setSelected(found.filePath);
              }
            }
          }
        })
        .catch(() => {});
    },
    [cwd]
  );

  const customizeAgent = useCallback(
    async (agent: AgentInfo) => {
      setCustomizing((s) => new Set(s).add(agent.name));
      setSaveError(null);
      try {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "user",
            duplicateFrom: agent.filePath,
            cwd,
          }),
        });
        const d = await res.json();
        if (!res.ok || d.error) {
          setSaveError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        reloadGroups(agent.name);
      } catch (e) {
        setSaveError(String(e));
      } finally {
        setCustomizing((s) => {
          const n = new Set(s);
          n.delete(agent.name);
          return n;
        });
      }
    },
    [cwd, reloadGroups]
  );

  // Bulk-fork an entire read-only group (npm/git) into My agents.
  // Agents that already have a user copy are skipped (backend returns 409).
  const customizeAllInGroup = useCallback(
    async (group: Group) => {
      const targets = group.agents;
      if (targets.length === 0) return;
      setGroupToggling((s) => new Set(s).add("customize:" + group.id));
      setSaveError(null);
      try {
        const results = await Promise.all(
          targets.map((a) =>
            fetch("/api/agents", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scope: "user", duplicateFrom: a.filePath, cwd }),
            }).then((r) => r.json())
          )
        );
        const failures = results.filter(
          (d: { error?: string }, i) =>
            d.error &&
            // 409 "already exists" is not a hard failure for bulk fork
            !String(d.error).includes("already exists")
        );
        if (failures.length > 0) {
          setSaveError(
            `${failures.length} failed: ${(failures[0] as { error?: string }).error ?? ""}`
          );
        }
        reloadGroups();
      } catch (e) {
        setSaveError(String(e));
      } finally {
        setGroupToggling((s) => {
          const n = new Set(s);
          n.delete("customize:" + group.id);
          return n;
        });
      }
    },
    [cwd, reloadGroups]
  );

  const removeAgent = useCallback(
    async (agent: AgentInfo) => {
      setDeleting((s) => new Set(s).add(agent.filePath));
      setSaveError(null);
      try {
        const res = await fetch("/api/agents", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: agent.filePath, cwd }),
        });
        const d = await res.json();
        if (!res.ok || d.error) {
          setSaveError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        setGroups((prev) =>
          prev
            .map((g) => ({
              ...g,
              agents: g.agents.filter((a) => a.filePath !== agent.filePath),
            }))
            .filter((g) => g.agents.length > 0)
        );
        if (selected === agent.filePath) setSelected(null);
      } catch (e) {
        setSaveError(String(e));
      } finally {
        setDeleting((s) => {
          const n = new Set(s);
          n.delete(agent.filePath);
          return n;
        });
      }
    },
    [cwd, selected]
  );

  const toggleGroup = useCallback(
    async (group: Group) => {
      if (group.agents.length === 0) return;
      const allOn = group.agents.every((a) => a.effectiveEnabled);
      const target = !allOn; // if all on → turn off; else turn on
      setGroupToggling((s) => new Set(s).add(group.id));
      setSaveError(null);
      try {
        await Promise.all(
          group.agents.map((a) =>
            fetch("/api/agents", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: a.name, enabled: target, cwd }),
            }).then((r) => r.json())
          )
        );
        setGroups((prev) =>
          prev.map((g) =>
            g.id === group.id
              ? {
                  ...g,
                  agents: g.agents.map((a) => ({
                    ...a,
                    effectiveEnabled: target,
                    ownEnabled:
                      a.groupType === "project" || a.groupType === "user" ? target : a.ownEnabled,
                  })),
                }
              : g
          )
        );
      } catch (e) {
        setSaveError(String(e));
      } finally {
        setGroupToggling((s) => {
          const n = new Set(s);
          n.delete(group.id);
          return n;
        });
      }
    },
    [cwd]
  );

  const selectedAgent = (() => {
    for (const g of groups) {
      const a = g.agents.find((x) => x.filePath === selected);
      if (a) return { agent: a, group: g };
    }
    return null;
  })();

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
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
          width: 940,
          height: "82vh",
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
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              Agents
            </span>
            <code
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                maxWidth: 360,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenPath(cwd)}
            </code>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setCreating("user")}
              style={btnAccent}
              title="Create a new custom agent"
            >
              + New agent
            </button>
            <button onClick={onClose} style={btnGhost}>
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Left: groups + agents */}
          <div
            style={{
              width: 280,
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              background: "var(--bg-panel)",
            }}
          >
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 6px" }}>
              {loading ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>
                  Loading…
                </div>
              ) : error ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "#f87171" }}>
                  {error}
                </div>
              ) : groups.length === 0 ? (
                <div style={{ padding: "10px 8px" }}>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>
                    No agents found.
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    Install a sub-agent extension (e.g.{" "}
                    <code>pi install npm:pi-subagents</code>), or create one with{" "}
                    <strong>+ New agent</strong>.
                  </div>
                </div>
              ) : (
                groups.map((g) => {
                  const isOpen = expanded.has(g.id);
                  const allOn = g.agents.every((a) => a.effectiveEnabled);
                  const anyOn = g.agents.some((a) => a.effectiveEnabled);
                  const badge = typeBadgeColor(g.type);
                  return (
                    <div key={g.id} style={{ marginBottom: 4 }}>
                      {/* group header */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 6px",
                          borderRadius: 5,
                          cursor: "pointer",
                        }}
                        onClick={() => toggleExpand(g.id)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            width: 10,
                            textAlign: "center",
                            color: "var(--text-dim)",
                            transition: "transform 0.15s",
                            transform: isOpen ? "rotate(90deg)" : "none",
                          }}
                        >
                          ▶
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 5px",
                            borderRadius: 3,
                            background: badge.bg,
                            color: badge.color,
                            flexShrink: 0,
                          }}
                        >
                          {g.type}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--text)",
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {g.label}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--text-dim)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {g.agents.length}
                        </span>
                        {!g.editable && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              customizeAllInGroup(g);
                            }}
                            disabled={groupToggling.has("customize:" + g.id)}
                            title={`Fork all ${g.agents.length} agents into My agents so you can edit them`}
                            style={{
                              ...btnGhost,
                              fontSize: 10,
                              padding: "2px 7px",
                              flexShrink: 0,
                            }}
                          >
                            {groupToggling.has("customize:" + g.id)
                              ? "Forking…"
                              : "⇩ Customize all"}
                          </button>
                        )}
                        <Toggle
                          enabled={allOn}
                          loading={groupToggling.has(g.id)}
                          onToggle={() => toggleGroup(g)}
                          size={34}
                        />
                      </div>
                      {/* group sub-header: + create (editable) / customize-all done (non-editable) */}
                      {isOpen && g.editable && (
                        <div style={{ padding: "0 6px 4px 26px" }}>
                          <button
                            onClick={() =>
                              setCreating(g.type === "project" ? "project" : "user")
                            }
                            style={{
                              ...btnGhost,
                              fontSize: 11,
                              padding: "3px 8px",
                            }}
                          >
                            + Add agent to {g.label}
                          </button>
                        </div>
                      )}
                      {/* agents (editable groups: sub-grouped by customizedFrom) */}
                      {isOpen && g.editable && (
                        <div style={{ padding: "1px 0 2px" }}>
                          {(() => {
                            // partition into sub-groups by customizedFrom
                            const byPkg = new Map<string, AgentInfo[]>();
                            for (const a of g.agents) {
                              const k = a.customizedFrom ?? "";
                              if (!byPkg.has(k)) byPkg.set(k, []);
                              byPkg.get(k)!.push(a);
                            }
                            const keys = [...byPkg.keys()].sort((a, b) =>
                              a === b
                                ? 0
                                : a === ""
                                ? -1
                                : b === ""
                                ? 1
                                : a.localeCompare(b)
                            );
                            return keys.map((key) => {
                              const agents = byPkg.get(key)!;
                              const subId = `${g.id}:${key}`;
                              const subOpen = subExpanded.has(subId);
                              if (key === "") {
                                // scratch / unattributed — render flat
                                return (
                                  <div key={subId}>
                                    {agents.map((agent) => (
                                      <AgentRow
                                        key={agent.filePath}
                                        agent={agent}
                                        selected={selected}
                                        onSelect={setSelected}
                                      />
                                    ))}
                                  </div>
                                );
                              }
                              return (
                                <div key={subId}>
                                  <div
                                    onClick={() =>
                                      setSubExpanded((s) => {
                                        const n = new Set(s);
                                        if (n.has(subId)) n.delete(subId);
                                        else n.add(subId);
                                        return n;
                                      })
                                    }
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      padding: "3px 8px 2px 18px",
                                      cursor: "pointer",
                                      color: "var(--text-muted)",
                                    }}
                                    onMouseEnter={(e) =>
                                      (e.currentTarget.style.background =
                                        "var(--bg-hover)")
                                    }
                                    onMouseLeave={(e) =>
                                      (e.currentTarget.style.background =
                                        "transparent")
                                    }
                                  >
                                    <span
                                      style={{
                                        fontSize: 9,
                                        width: 9,
                                        textAlign: "center",
                                        transition: "transform 0.15s",
                                        transform: subOpen ? "rotate(90deg)" : "none",
                                      }}
                                    >
                                      ▶
                                    </span>
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontStyle: "italic",
                                        flex: 1,
                                      }}
                                    >
                                      from {key.replace(/^(npm|git):/, "")}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "var(--text-dim)",
                                        fontFamily: "var(--font-mono)",
                                      }}
                                    >
                                      {agents.length}
                                    </span>
                                  </div>
                                  {subOpen && (
                                    <div>
                                      {agents.map((agent) => (
                                        <AgentRow
                                          key={agent.filePath}
                                          agent={agent}
                                          selected={selected}
                                          onSelect={setSelected}
                                        />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}
                      {/* agents (non-editable groups: flat list) */}
                      {isOpen && !g.editable && (
                        <div style={{ padding: "1px 0 2px" }}>
                          {g.agents.map((agent) => (
                            <AgentRow
                              key={agent.filePath}
                              agent={agent}
                              selected={selected}
                              onSelect={setSelected}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {loading ? null : selectedAgent ? (
              <AgentDetail
                key={selectedAgent.agent.filePath}
                agent={selectedAgent.agent}
                group={selectedAgent.group}
                cwd={cwd}
                onToggle={toggle}
                onDelete={removeAgent}
                onCustomize={customizeAgent}
                toggling={toggling.has(selectedAgent.agent.name)}
                deleting={deleting.has(selectedAgent.agent.filePath)}
                customizing={customizing.has(selectedAgent.agent.name)}
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
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {groups.length === 0
                  ? "Add agents to get started"
                  : "Select an agent from the left"}
                <div style={{ maxWidth: 360, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, textAlign: "center" }}>
                  Agents are discovered from installed packages, your global
                  agents dir, and project <code>.pi/agents/</code>.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Precedence: project &gt; my agents &gt; git &gt; npm
          </span>
          <button onClick={onClose} style={btnGhost}>
            Close
          </button>
        </div>
      </div>

      {creating && (
        <CreateAgentForm
          defaultScope={creating}
          cwd={cwd}
          onCreated={() => {
            setCreating(null);
            loadAgents();
          }}
          onCancel={() => setCreating(null)}
        />
      )}
    </div>
  );
}