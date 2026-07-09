import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { createRequire } from "module";
import { dirname, join, resolve } from "path";
import { cacheSessionPath } from "./session-reader";
import type { LoadExtensionsResult, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "./pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const requireFromHere = createRequire(import.meta.url);
const LEGACY_VISION_PROXY_EXTENSION = "vision-proxy.ts";
const MULTIMODAL_PROXY_EXTENSION_PARTS = ["extensions", "vision-proxy.ts"];
const MULTIMODAL_PROXY_PACKAGE_RE = /^(?:npm:)?pi-(?:multimodal|vision)-proxy(?:@|$)/;

// Runtime policy (self-use defaults). Override via env without code rollback:
//   PI_WEB_MAX_LIVE=3     max concurrent live AgentSessions (0 = unlimited)
//   PI_WEB_IDLE_MS=180000 idle dispose after N ms of no activity (default 3min)
//   PI_WEB_SSE_AUTOSTART=1  restore old behavior: SSE connects create sessions
function readPositiveInt(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

const MAX_LIVE_SESSIONS = readPositiveInt("PI_WEB_MAX_LIVE", 3);
const IDLE_TIMEOUT_MS = readPositiveInt("PI_WEB_IDLE_MS", 3 * 60 * 1000);
const SSE_AUTOSTART = process.env.PI_WEB_SSE_AUTOSTART === "1";

export function getRuntimePolicy() {
  return {
    maxLiveSessions: MAX_LIVE_SESSIONS,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    sseAutostart: SSE_AUTOSTART,
  };
}

function resolveBundledPackageFile(packageName: string, parts: string[]): string | null {
  const candidates: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(join(dir, "node_modules", packageName, ...parts));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    const pkgPath = requireFromHere.resolve(`${packageName}/package.json`);
    candidates.push(join(dirname(pkgPath), ...parts));
  } catch {
    // Manual search above covers local dev; this is only a production fallback.
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function isLegacyVisionProxyPath(filePath: string, agentDir: string): boolean {
  return resolve(filePath) === resolve(join(agentDir, "extensions", LEGACY_VISION_PROXY_EXTENSION));
}

function loadPiWebExtensions(base: LoadExtensionsResult, agentDir: string): LoadExtensionsResult {
  return {
    ...base,
    extensions: base.extensions.filter((extension) => (
      !isLegacyVisionProxyPath(extension.path, agentDir)
      && !isLegacyVisionProxyPath(extension.resolvedPath, agentDir)
    )),
    errors: base.errors.filter((error) => !isLegacyVisionProxyPath(error.path, agentDir)),
  };
}

function packageSourceText(source: unknown): string | null {
  if (typeof source === "string") return source.trim();
  if (
    source
    && typeof source === "object"
    && "source" in source
    && typeof source.source === "string"
  ) {
    return source.source.trim();
  }
  return null;
}

function packageSourceLoadsExtensions(source: unknown): boolean {
  if (!source || typeof source !== "object" || !("extensions" in source)) return true;
  const extensions = source.extensions;
  return !Array.isArray(extensions) || extensions.length > 0;
}

function hasConfiguredMultimodalProxyPackage(settingsManager: SettingsManager): boolean {
  return settingsManager.getPackages().some((source) => {
    const text = packageSourceText(source);
    return Boolean(text && MULTIMODAL_PROXY_PACKAGE_RE.test(text) && packageSourceLoadsExtensions(source));
  });
}

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private promptRunning = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private _alive = true;
  /** Last user/agent activity (not SSE heartbeats). Used for LRU eviction. */
  lastActivityAt = Date.now();

  constructor(public readonly inner: AgentSessionLike) {
    this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  isBusy(): boolean {
    return this.promptRunning || this.inner.isStreaming || this.inner.isCompacting;
  }

  async start(): Promise<void> {
    // Emit session_start to extensions (e.g. pi-multimodal-proxy reads config file)
    // Must happen before any events are processed, otherwise _fileConfig stays empty
    // and the vision proxy falls back to DEFAULT_CONFIG.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.inner as any).bindExtensions?.({});
    } catch (err) {
      console.error("bindExtensions failed:", err);
    }
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.touchActivity();
      this.emit(event);
    });
    this.touchActivity();
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) l(event);
  }

  /** Mark activity (user command or agent event). Public for registry reuse. */
  touchActivity(): void {
    this.lastActivityAt = Date.now();
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    // Busy sessions stay alive; idle timer re-arms when activity stops via events.
    if (this.isBusy()) {
      this.idleTimer = setTimeout(() => this.resetIdleTimer(), Math.min(IDLE_TIMEOUT_MS, 30_000));
      return;
    }
    this.idleTimer = setTimeout(() => {
      if (this.isBusy()) {
        this.resetIdleTimer();
        return;
      }
      this.destroy();
    }, IDLE_TIMEOUT_MS);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.touchActivity();
    const type = command.type as string;

    switch (type) {
      case "prompt": {
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        this.promptRunning = true;
        this.inner.prompt(command.message as string, {
          ...(promptImages?.length ? { images: promptImages } : {}),
          ...(streamingBehavior ? { streamingBehavior } : {}),
          source: "rpc",
        }).then(() => {
          this.promptRunning = false;
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
        }).catch((error) => {
          this.promptRunning = false;
          this.emit({
            type: "prompt_error",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
        });
        return null;
      }

      case "abort":
        await this.inner.abort();
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: 0,
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const registry = this.inner.modelRegistry;
        const model = registry.find(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        this.destroy();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        return null;
      }

      case "compact": {
        const result = await this.inner.compact(command.customInstructions as string | undefined);
        return result;
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, command.toolNames as string[]));
        return null;
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    this.pendingUiResponses.clear();
    this.extensionStatuses.clear();
    this.extensionWidgets.clear();
    this.listeners = [];
    // Best-effort teardown of the underlying AgentSession (same as leaving CLI).
    try {
      this.inner.dispose();
    } catch {
      // ignore dispose errors during teardown
    }
    this.onDestroyCallback?.();
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.extensionWidgets.delete(key);
        } else {
          this.extensionWidgets.set(key, {
            key,
            lines: content,
            placement: options?.placement ?? "aboveEditor",
          });
        }
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        } as ExtensionUiRequest as AgentEvent);
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: async <T = unknown>() => undefined as T,
      pasteToEditor: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() { return undefined; },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in pi-web extension UI yet" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function listLiveRpcSessions(): Array<{ sessionId: string; busy: boolean; lastActivityAt: number }> {
  const out: Array<{ sessionId: string; busy: boolean; lastActivityAt: number }> = [];
  for (const [sessionId, session] of getRegistry()) {
    if (!session.isAlive()) continue;
    out.push({
      sessionId,
      busy: session.isBusy(),
      lastActivityAt: session.lastActivityAt,
    });
  }
  return out;
}

export function releaseRpcSession(sessionId: string): boolean {
  const session = getRegistry().get(sessionId);
  if (!session?.isAlive()) return false;
  session.destroy();
  return true;
}

/**
 * Evict idle sessions when over MAX_LIVE_SESSIONS.
 * Never evicts busy (streaming / prompt / compacting) sessions.
 * maxLive=0 means unlimited.
 */
function evictIfNeeded(keepSessionId?: string): void {
  if (MAX_LIVE_SESSIONS <= 0) return;
  const registry = getRegistry();
  const live = [...registry.entries()].filter(([, s]) => s.isAlive());
  if (live.length < MAX_LIVE_SESSIONS) return;

  const victims = live
    .filter(([id, s]) => id !== keepSessionId && !s.isBusy())
    .sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt);

  let overflow = live.length - MAX_LIVE_SESSIONS + 1; // make room for one new start
  for (const [, session] of victims) {
    if (overflow <= 0) break;
    session.destroy();
    overflow--;
  }
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[]
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) {
    existing.touchActivity();
    return { session: existing, realSessionId: sessionId };
  }

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    evictIfNeeded(sessionId);

    const { SessionManager, getAgentDir } = await import("@earendil-works/pi-coding-agent");
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const multimodalProxyExtension = hasConfiguredMultimodalProxyPackage(settingsManager)
      ? null
      : resolveBundledPackageFile("pi-multimodal-proxy", MULTIMODAL_PROXY_EXTENSION_PARTS);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      ...(multimodalProxyExtension ? { additionalExtensionPaths: [multimodalProxyExtension] } : {}),
      extensionsOverride: (base) => loadPiWebExtensions(base, agentDir),
    });
    await resourceLoader.reload();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, createAgentSession expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      // toolNames === [] -> "all off" (an empty allow-list disables every tool).
      // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
      // set allowedToolNames to coding builtins only, which filtered every
      // extension/package-provided tool (e.g. subagents, web access) out of the
      // tool registry — so they were unavailable in pi-web sessions even though the
      // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
      // tools (and activate extension tools); we narrow the ACTIVE set below.
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    const { session: inner } = await createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      resourceLoader,
      sessionManager,
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });

    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in pi-web just like in the `pi` CLI.
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
    }

    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // the only way to truly clear it is to call agent.setSystemPrompt directly.
    if (toolNames?.length === 0) {
      inner.agent.state.systemPrompt = "";
    }

    const wrapper = new AgentSessionWrapper(inner);
    await wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
