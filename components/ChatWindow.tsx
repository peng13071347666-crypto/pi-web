"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage, ArtifactItem, AssistantContentBlock, AssistantMessage, ExtensionUiRequest, SessionInfo, SessionTreeNode, ToolCallContent } from "@/lib/types";
import { MessageView } from "./MessageView";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import type { OpenPathAction } from "./ArtifactCards";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { useAgentSession, type AgentPhase, type NoticeItem } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { phaseLabel as formatPhaseLabel } from "@/lib/ui-format";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onArtifactsChange?: (artifacts: ArtifactItem[]) => void;
  onArtifactOpenRequest?: (filePath: string) => void;
  onArtifactPreviewRequest?: (artifactId: string) => void;
  onReviewArtifactsRequest?: (artifactIds: string[]) => void;
  onFilePreviewRequest?: (filePath: string) => void;
  onOpenPathRequest?: (filePath: string, action: OpenPathAction) => void;
}

function phaseLabel(phase: AgentPhase, startedAt?: number | null): string {
  return formatPhaseLabel(phase, { startedAt });
}

const TYPEWRITER_PHRASES = [
  "ready when you are.",
  "ask me anything.",
  "let's build something cool.",
  "explore your codebase.",
  "draft an email.",
  "summarize that paper.",
  "plan your weekend.",
  "explain it like I'm five.",
  "pair-program with me.",
  "fix that pesky bug.",
  "translate to 中文.",
  "write a haiku.",
  "brainstorm ideas.",
  "review my pull request.",
  "what should we cook tonight?",
  "ship it.",
  "make it pretty.",
  "rubber-duck with me.",
];

const CHAT_MINIMAP_WIDTH = 36;
const CHAT_COLUMN_PADDING = 16;
const CHAT_INPUT_RIGHT_PADDING = CHAT_COLUMN_PADDING + CHAT_MINIMAP_WIDTH;

function getMessageKey(msg: AgentMessage, entryId: string | undefined, idx: number): string {
  if (entryId) return `entry:${entryId}`;
  const timestamp = (msg as AgentMessage & { timestamp?: number }).timestamp ?? "no-time";
  return `local:${msg.role}:${timestamp}:${idx}`;
}

type ExecutionDetailsGroup = {
  key: string;
  firstIndex: number;
  lastIndex: number;
  thinkingCount: number;
  toolCount: number;
  hasError: boolean;
  assistantIndices: number[];
};

function isProcessBlock(block: AssistantContentBlock): boolean {
  return block.type === "thinking" || block.type === "toolCall";
}

function Typewriter({ phrases }: { phrases: string[] }) {
  const [phraseIdx, setPhraseIdx] = useState(() => Math.floor(Math.random() * phrases.length));
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [caretOn, setCaretOn] = useState(true);

  useEffect(() => {
    const blink = setInterval(() => setCaretOn((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    const current = phrases[phraseIdx];
    let timeout: ReturnType<typeof setTimeout>;
    if (!deleting && text === current) {
      timeout = setTimeout(() => setDeleting(true), 1800);
    } else if (deleting && text === "") {
      setDeleting(false);
      setPhraseIdx((i) => (i + 1) % phrases.length);
    } else {
      const next = deleting ? current.slice(0, text.length - 1) : current.slice(0, text.length + 1);
      timeout = setTimeout(() => setText(next), deleting ? 28 : 55);
    }
    return () => clearTimeout(timeout);
  }, [text, deleting, phraseIdx, phrases]);

  return (
    <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
      {text}
      <span style={{ opacity: caretOn ? 1 : 0, color: "var(--accent)", marginLeft: 1 }}>▍</span>
    </span>
  );
}

function ExecutionDetailsToggle({
  group,
  expanded,
  onToggle,
}: {
  group: ExecutionDetailsGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const summary = [
    group.thinkingCount > 0 ? `${group.thinkingCount} thinking` : null,
    group.toolCount > 0 ? `${group.toolCount} tool${group.toolCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      className="pi-process-group"
      style={{
        marginBottom: 8,
        border: group.hasError ? "1px solid rgba(248,113,113,0.45)" : "1px solid var(--border)",
        borderRadius: "var(--content-radius)",
        overflow: "hidden",
        fontSize: 12,
        background: group.hasError ? "rgba(248,113,113,0.05)" : "var(--bg-panel)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={expanded ? "收起全部执行过程" : "展开全部执行过程"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "6px 10px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
        <span style={{ flex: 1, minWidth: 0 }}>Execution details</span>
        <span style={{ color: group.hasError ? "#f87171" : "var(--text-dim)", fontSize: 11, flexShrink: 0 }}>
          {group.hasError ? `${summary} · error` : summary}
        </span>
      </button>
    </div>
  );
}

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsChange, onSessionStatsPanelOpen, onContextUsageChange, onArtifactsChange, onArtifactOpenRequest, onArtifactPreviewRequest, onReviewArtifactsRequest, onFilePreviewRequest, onOpenPathRequest }: Props) {
  const {
    loading, error, messages, entryIds, streamState, activeLeafId, promptVariants,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, sessionStats,
    slashCommands, slashCommandsLoading,
    notices, extensionDialog, extensionStatuses, extensionWidgets, respondToExtensionUi,
    isAutoModelSelection,
    agentPhase,
    hasMoreBefore, loadingMoreContext, artifacts,
    isNew,
    messagesEndRef, scrollContainerRef,
    lastUserMsgRef, currentAssistantMsgRef,
    handleSend, handleEditMessage, handleAbort, handleFork, handleLeafChange, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadSlashCommands, handleAgentEventRef,
    loadMoreContext,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen,
    onArtifactsChange, onArtifactOpenRequest,
  });

  const { soundEnabled, onSoundToggle, playDoneSound } = useAudio();
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  // Track how long the current agent run has been active (for status bar).
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (agentRunning) {
      setRunStartedAt((prev) => prev ?? Date.now());
      const id = setInterval(() => setTick((n) => n + 1), 1000);
      return () => clearInterval(id);
    }
    setRunStartedAt(null);
  }, [agentRunning]);

  // Esc aborts when agent is running (and focus is not in an editable field).
  useEffect(() => {
    if (!agentRunning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        // Still allow Esc to abort from the main chat textarea.
        if (t.tagName === "TEXTAREA" && t.closest("[data-pi-chat-input-shell]")) {
          e.preventDefault();
          void handleAbort();
        }
        return;
      }
      e.preventDefault();
      void handleAbort();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agentRunning, handleAbort]);

  // Wrap agent event handler to play sound on agent_end
  const origHandler = handleAgentEventRef.current;
  useEffect(() => {
    handleAgentEventRef.current = (event) => {
      if (event.type === "agent_end" && soundEnabledRef.current) {
        playDoneSoundRef.current();
      }
      origHandler?.(event);
    };
  }, [origHandler, handleAgentEventRef]);

  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const onDrop = useCallback((files: File[]) => {
    chatInputRef?.current?.addFiles(files);
  }, [chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const streamingMessageIsVisible = streamState.streamingMessage?.role === "user" || streamState.streamingMessage?.role === "assistant";
  const messageRefs = useMessageRefs(visibleMessages.length + (streamingMessageIsVisible ? 1 : 0));
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, import("@/lib/types").ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as import("@/lib/types").ToolResultMessage).toolCallId, msg as import("@/lib/types").ToolResultMessage);
      }
    }
    return map;
  }, [messages]);

  const executionDetails = useMemo(() => {
    const groups: ExecutionDetailsGroup[] = [];
    const byAssistantIndex = new Map<number, ExecutionDetailsGroup>();
    let active: ExecutionDetailsGroup | null = null;

    messages.forEach((msg, idx) => {
      if (msg.role === "user") {
        active = null;
        return;
      }
      if (msg.role !== "assistant") return;

      const processBlocks = (msg as AssistantMessage).content.filter(isProcessBlock);
      if (processBlocks.length === 0) return;

      if (!active) {
        active = {
          key: getMessageKey(msg, entryIds[idx], idx),
          firstIndex: idx,
          lastIndex: idx,
          thinkingCount: 0,
          toolCount: 0,
          hasError: false,
          assistantIndices: [],
        };
        groups.push(active);
      }

      active.lastIndex = idx;
      active.assistantIndices.push(idx);
      active.thinkingCount += processBlocks.filter((block) => block.type === "thinking").length;
      active.toolCount += processBlocks.filter((block) => block.type === "toolCall").length;
      active.hasError = active.hasError || processBlocks.some((block) => (
        block.type === "toolCall"
        && toolResultsMap.get((block as ToolCallContent).toolCallId)?.isError === true
      ));
      byAssistantIndex.set(idx, active);
    });

    return { groups, byAssistantIndex };
  }, [messages, entryIds, toolResultsMap]);

  const [executionDetailsExpanded, setExecutionDetailsExpanded] = useState<Record<string, boolean>>({});
  const latestExecutionGroupKey = executionDetails.groups.at(-1)?.key ?? null;
  const liveExecutionGroupKeyRef = useRef<string | null>(null);
  const previousAgentRunningRef = useRef(agentRunning);

  useEffect(() => {
    if (agentRunning && latestExecutionGroupKey) {
      liveExecutionGroupKeyRef.current = latestExecutionGroupKey;
      setExecutionDetailsExpanded((prev) => prev[latestExecutionGroupKey] === true
        ? prev
        : { ...prev, [latestExecutionGroupKey]: true });
    } else if (previousAgentRunningRef.current && !agentRunning && liveExecutionGroupKeyRef.current) {
      const finishedGroupKey = liveExecutionGroupKeyRef.current;
      setExecutionDetailsExpanded((prev) => ({ ...prev, [finishedGroupKey]: false }));
      liveExecutionGroupKeyRef.current = null;
    }
    previousAgentRunningRef.current = agentRunning;
  }, [agentRunning, latestExecutionGroupKey]);

  useEffect(() => {
    setExecutionDetailsExpanded({});
    liveExecutionGroupKeyRef.current = null;
    previousAgentRunningRef.current = agentRunning;
  }, [session?.id]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={agentRunning}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      onModelChange={handleModelChange}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
    />
  );

  const aboveEditorWidgets = extensionWidgets.filter((widget) => widget.placement !== "belowEditor");
  const belowEditorWidgets = extensionWidgets.filter((widget) => widget.placement === "belowEditor");

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        Loading session...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className={`relative flex h-full flex-col overflow-hidden ${isEmptyNew ? "chat-window-empty" : "chat-window-active"}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center backdrop-blur-[1px]" style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s`, borderColor: "color-mix(in srgb, var(--accent) 50%, transparent)" }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            style={{ filter: "drop-shadow(0 6px 18px color-mix(in srgb, var(--accent) 18%, transparent))" }}
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="color-mix(in srgb, var(--accent) 8%, transparent)" stroke="color-mix(in srgb, var(--accent) 50%, transparent)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="color-mix(in srgb, var(--accent) 16%, transparent)" stroke="color-mix(in srgb, var(--accent) 40%, transparent)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="color-mix(in srgb, var(--accent) 22%, transparent)" stroke="color-mix(in srgb, var(--accent) 55%, transparent)" strokeWidth="1.6"/>
            <g stroke="color-mix(in srgb, var(--accent) 45%, transparent)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {extensionDialog && (
        <ExtensionDialog
          request={extensionDialog}
          onRespond={respondToExtensionUi}
        />
      )}

      {isEmptyNew ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8" style={{ background: "var(--welcome-bg)" }}>
          <div style={{ width: "100%", maxWidth: "var(--chat-max-width)" }}>
            <div
              className="mb-3"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginLeft: 16,
                marginRight: 52,
                fontFamily: "var(--welcome-title-font)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, flex: 1, lineHeight: 1.4, overflow: "hidden" }}>
                <span style={{ fontSize: "var(--welcome-logo-size)", fontWeight: "var(--welcome-title-weight)", letterSpacing: 0, color: "var(--accent)", flexShrink: 0, whiteSpace: "nowrap" }}>π</span>
                <span style={{ fontSize: "var(--welcome-title-size)", color: "var(--text)", fontWeight: "var(--welcome-title-weight)", letterSpacing: 0, flexShrink: 0, whiteSpace: "nowrap" }}>Pi Agent Web</span>
                <span style={{ fontSize: 14, flex: "1 1 0", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", display: "block" }}>
                  <Typewriter phrases={TYPEWRITER_PHRASES} />
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  web <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  pi <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</span>
                </span>
              </div>
            </div>
            <NoticeShelf notices={notices} align="right" />
            {chatInputElement}
          </div>
        </div>
      ) : (
      <>
      <div className="relative flex flex-1 overflow-hidden">
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 0,
            right: CHAT_MINIMAP_WIDTH,
            zIndex: 40,
            padding: `0 ${CHAT_COLUMN_PADDING}px`,
            pointerEvents: "none",
          }}
        >
          <div style={{ maxWidth: "var(--chat-max-width)", margin: "0 auto" }}>
            <NoticeShelf notices={notices} floating align="right" />
          </div>
        </div>
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pt-4 [scrollbar-width:none]">
          <div style={{ padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
            <div style={{ maxWidth: "var(--chat-max-width)", margin: "0 auto" }}>
              <ExtensionStatusBar statuses={extensionStatuses} />
              <ExtensionWidgets widgets={aboveEditorWidgets} />

              {hasMoreBefore && (
                <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 14px" }}>
                  <button
                    type="button"
                    onClick={loadMoreContext}
                    disabled={loadingMoreContext}
                    style={{
                      height: 30,
                      padding: "0 12px",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--bg-panel)",
                      color: loadingMoreContext ? "var(--text-dim)" : "var(--text-muted)",
                      cursor: loadingMoreContext ? "default" : "pointer",
                      fontSize: 12,
                    }}
                  >
                    {loadingMoreContext ? "Loading earlier messages..." : "Load earlier messages"}
                  </button>
                </div>
              )}

            {(() => {
              let lastUserIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === "user") { lastUserIdx = i; break; }
              }
              let answerStartAssistantIdx = -1;
              for (let i = Math.max(0, lastUserIdx + 1); i < messages.length; i++) {
                if (messages[i].role === "assistant") {
                  answerStartAssistantIdx = i;
                  break;
                }
              }
              let refIdx = 0;
              return messages.map((msg, idx) => {
                const key = getMessageKey(msg, entryIds[idx], idx);
                const isVisible = msg.role === "user" || msg.role === "assistant";
                const currentRefIdx = isVisible ? refIdx++ : -1;
                let showTimestamp = false;
                if (msg.role === "assistant") {
                  showTimestamp = true;
                  for (let j = idx + 1; j < messages.length; j++) {
                    const r = messages[j].role;
                    if (r === "user") break;
                    if (r === "assistant") {
                      showTimestamp = false;
                      break;
                    }
                  }
                  // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                  if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
                    showTimestamp = false;
                  }
                }
                const executionGroup = msg.role === "assistant"
                  ? executionDetails.byAssistantIndex.get(idx)
                  : undefined;
                const executionExpanded = executionGroup
                  ? executionDetailsExpanded[executionGroup.key] ?? (agentRunning && executionGroup.key === latestExecutionGroupKey)
                  : undefined;
                const executionDetailsMode: "collapsed" | "expanded" | undefined = executionGroup
                  ? executionExpanded ? "expanded" : "collapsed"
                  : undefined;
                const executionDetailsControl = executionGroup?.firstIndex === idx
                  ? (
                    <ExecutionDetailsToggle
                      group={executionGroup}
                      expanded={Boolean(executionExpanded)}
                      onToggle={() => setExecutionDetailsExpanded((prev) => ({
                        ...prev,
                        [executionGroup.key]: !executionExpanded,
                      }))}
                    />
                  )
                  : undefined;
                const hiddenProcessOnlyMessage = msg.role === "assistant"
                  && executionDetailsMode === "collapsed"
                  && (msg as AssistantMessage).content.length > 0
                  && (msg as AssistantMessage).content.every(isProcessBlock)
                  && executionDetailsControl === undefined;
                const view = (
                  <MessageView
                    key={key}
                    message={msg}
                    toolResults={toolResultsMap}
                    modelNames={modelNames}
                    entryId={entryIds[idx]}
                    onFork={agentRunning || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
                    forking={forkingEntryId === entryIds[idx]}
                    onEditSubmit={agentRunning || isNew ? undefined : handleEditMessage}
                    promptVariants={msg.role === "user" ? promptVariants[entryIds[idx]] : undefined}
                    activeLeafId={activeLeafId}
                    onSelectPromptVariant={agentRunning ? undefined : handleLeafChange}
                    showTimestamp={showTimestamp}
                    prevTimestamp={idx > 0 ? (messages[idx - 1] as import("@/lib/types").AgentMessage & { timestamp?: number }).timestamp : undefined}
                    artifacts={artifacts}
                    cwd={session?.cwd ?? newSessionCwd ?? undefined}
                    onPreviewArtifact={onArtifactPreviewRequest}
                    onReviewArtifacts={onReviewArtifactsRequest}
                    onPreviewFile={onFilePreviewRequest}
                    onOpenPath={onOpenPathRequest}
                    executionDetailsMode={executionDetailsMode}
                    executionDetailsControl={executionDetailsControl}
                  />
                );
                if (!isVisible) return view;
                return (
                  <div key={key} ref={(el) => {
                    messageRefs.current[currentRefIdx] = el;
                    if (idx === lastUserIdx) { (lastUserMsgRef as { current: HTMLDivElement | null }).current = el; }
                    if (idx === answerStartAssistantIdx) { (currentAssistantMsgRef as { current: HTMLDivElement | null }).current = el; }
                  }} style={{ contentVisibility: "auto", containIntrinsicSize: "220px", display: hiddenProcessOnlyMessage ? "none" : undefined }}>
                    {view}
                  </div>
                );
              });
            })()}

            {streamState.isStreaming && streamState.streamingMessage && (
              <div
                ref={(el) => {
                  if (streamingMessageIsVisible) {
                    messageRefs.current[visibleMessages.length] = el;
                  }
                  if (streamState.streamingMessage?.role === "assistant") {
                    (currentAssistantMsgRef as { current: HTMLDivElement | null }).current = el;
                  }
                }}
                style={{ contentVisibility: "auto", containIntrinsicSize: "220px" }}
              >
                <MessageView
                  message={streamState.streamingMessage as AgentMessage}
                  isStreaming
                  modelNames={modelNames}
                  artifacts={artifacts}
                  cwd={session?.cwd ?? newSessionCwd ?? undefined}
                  onPreviewArtifact={onArtifactPreviewRequest}
                  onReviewArtifacts={onReviewArtifactsRequest}
                  onPreviewFile={onFilePreviewRequest}
                  onOpenPath={onOpenPathRequest}
                />
              </div>
            )}

            {agentRunning && !streamState.streamingMessage && (
              <div className="py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase, runStartedAt)}</span>
              </div>
            )}

            {agentRunning && (
              <div style={{ height: scrollContainerRef.current ? scrollContainerRef.current.clientHeight : "80vh" }} />
            )}

            <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
        <ChatMinimap
          messages={messages}
          streamingMessage={streamState.streamingMessage}
          scrollContainer={scrollContainerRef}
          messageRefs={messageRefs}
        />
      </div>

      <div className="relative">
        {agentRunning && (
          <div
            style={{
              padding: `0 ${CHAT_COLUMN_PADDING}px`,
              paddingRight: CHAT_INPUT_RIGHT_PADDING,
              marginBottom: 6,
            }}
          >
            <div style={{ maxWidth: "var(--chat-max-width)", margin: "0 auto" }}>
              <div className="pi-agent-status-bar">
                <span className="pi-agent-status-dot" />
                <span className="pi-agent-status-text">{phaseLabel(agentPhase, runStartedAt)}</span>
                <span className="pi-agent-status-hint">Esc 中止</span>
                <button
                  type="button"
                  onClick={() => void handleAbort()}
                  className="pi-agent-status-stop"
                >
                  停止
                </button>
              </div>
            </div>
          </div>
        )}
        <div
          style={{
            padding: `0 ${CHAT_COLUMN_PADDING}px`,
            paddingRight: CHAT_INPUT_RIGHT_PADDING,
          }}
        >
          <div style={{ maxWidth: "var(--chat-max-width)", margin: "0 auto" }}>
            <ExtensionWidgets widgets={belowEditorWidgets} />
          </div>
        </div>
        {chatInputElement}
      </div>
      </>
      )}
    </div>
  );
}

function ExtensionStatusBar({ statuses }: { statuses: Array<{ key: string; text: string }> }) {
  if (statuses.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
      {statuses.map((status) => (
        <div
          key={status.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            maxWidth: "100%",
            padding: "4px 8px",
            border: "1px solid color-mix(in srgb, var(--accent) 24%, var(--border))",
            borderRadius: 6,
            background: "color-mix(in srgb, var(--accent) 7%, var(--bg))",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{status.key}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status.text}</span>
        </div>
      ))}
    </div>
  );
}

function ExtensionWidgets({ widgets }: { widgets: Array<{ key: string; lines: string[] }> }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      {widgets.map((widget) => (
        <div
          key={widget.key}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--bg-panel)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "5px 9px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
            {widget.key}
          </div>
          <pre style={{ margin: 0, padding: "8px 9px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}>
            {widget.lines.join("\n")}
          </pre>
        </div>
      ))}
    </div>
  );
}

function NoticeShelf({ notices, floating = false, align = "left" }: { notices: NoticeItem[]; floating?: boolean; align?: "left" | "right" }) {
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "stretch",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color = notice.type === "error"
          ? "#ef4444"
          : notice.type === "warning"
            ? "#d97706"
            : notice.type === "success"
              ? "#10b981"
              : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 60,
              height: 60,
              maxHeight: 60,
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              borderRadius: "var(--message-radius)",
              border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              background: "var(--popover-bg)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating ? "var(--popover-shadow)" : "var(--input-shadow)",
              fontSize: 18,
              lineHeight: 1.45,
              transformOrigin: "top center",
              animation: notice.exiting
                ? "notice-shelf-out 0.18s ease-in forwards"
                : "notice-shelf-in 0.18s ease-out both",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            <span style={{ padding: "14px 0", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(560px, 100%)",
          border: "1px solid var(--border)",
          borderRadius: "var(--popover-radius)",
          background: "var(--popover-bg)",
          boxShadow: "var(--popover-shadow)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 650 }}>{request.title}</div>
          <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>extension request</div>
        </div>

        <div style={{ padding: 14 }}>
          {request.method === "confirm" && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{request.message}</div>
          )}
          {request.method === "select" && (
            <div style={{ display: "grid", gap: 8 }}>
              {request.options.map((option) => (
                <button
                  key={option}
                  onClick={() => onRespond(request, { value: option })}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitValue();
                if (e.key === "Escape") onRespond(request, { cancelled: true });
              }}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: 13,
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onRespond(request, { cancelled: true });
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                minHeight: 220,
                padding: 10,
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: 13,
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <button
            onClick={() => onRespond(request, { cancelled: true })}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
                background: "var(--input-bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          {request.method === "confirm" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Confirm
            </button>
          ) : request.method !== "select" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Submit
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
