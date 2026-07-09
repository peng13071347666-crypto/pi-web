import type { AgentPhase } from "@/hooks/useAgentSession";

/** Shorten absolute/home paths for sidebar and tool headers. */
export function shortenPath(path: string, homeDir?: string, keep = 2): string {
  if (!path) return path;
  let normalized = path.replace(/\\/g, "/");
  if (homeDir) {
    const home = homeDir.replace(/\\/g, "/");
    if (normalized === home || normalized.startsWith(home + "/")) {
      normalized = `~${normalized.slice(home.length)}`;
    }
  }
  const parts = normalized.split("/").filter((p, i) => p.length > 0 || i === 0);
  // parts like ["~", "foo", "bar"] or ["", "Users", ...] for absolute
  const meaningful = parts.filter((p) => p !== "");
  if (meaningful.length <= keep) return normalized;
  const tail = meaningful.slice(-keep).join("/");
  if (normalized.startsWith("~/") || normalized === "~") return `~/…/${tail.replace(/^~\//, "")}`.replace(/\/{2,}/g, "/");
  return `…/${tail}`;
}

/** Friendly phase label for status bar (CN-first for self-use). */
export function phaseLabel(phase: AgentPhase, opts?: { startedAt?: number | null }): string {
  const elapsed = opts?.startedAt
    ? Math.max(0, Math.round((Date.now() - opts.startedAt) / 1000))
    : null;
  const suffix = elapsed !== null && elapsed > 0 ? ` · ${elapsed}s` : "";

  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return `运行工具中…${suffix}`;
    if (names.length === 1) return `运行 ${names[0]}…${suffix}`;
    if (names.length <= 3) return `运行 ${names.join(", ")}…${suffix}`;
    return `运行 ${names.slice(0, 2).join(", ")} 等 ${names.length} 个工具…${suffix}`;
  }
  if (phase?.kind === "waiting_model") return `等待模型…${suffix}`;
  if (phase?.kind === "running_command") return `执行命令…${suffix}`;
  return `思考中…${suffix}`;
}

export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars).trimEnd()}\n…`, truncated: true };
}
