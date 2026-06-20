import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import path from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type { OrchestratorAgent } from "../agents/orchestrator.js";
import type { LuminousConfig } from "../config/index.js";
import { resolveModelConfig } from "../config/index.js";
import type { ApprovalRequest, SessionBus } from "../session/events.js";
import type { SessionStore } from "../session/store.js";
import { deserializeMessages } from "../session/messages.js";
import type { TodoStore } from "../session/todo.js";
import type { UsageTracker } from "../session/usage.js";
import { formatTokens } from "../session/usage.js";
import type { TodoItem } from "../types.js";
import { AgentStatus, agentLineCount, countSubagentLines, type AgentView } from "./AgentStatus.js";
import { Approval } from "./Approval.js";
import { Chat, countChatLines, type ChatItem, type SubagentStream } from "./Chat.js";
import { DiffView, type EditView } from "./DiffView.js";
import type { MouseInput } from "./mouse.js";
import { StatusBar } from "./StatusBar.js";

export interface AppServices {
  bus: SessionBus;
  config: LuminousConfig;
  cwd: string;
  orchestrator: OrchestratorAgent;
  usage: UsageTracker;
  store: SessionStore;
  todos: TodoStore;
  connected: boolean | undefined;
  mouse?: MouseInput;
}

const ARROW_SCROLL_LINES = 1;
const WHEEL_SCROLL_LINES = 3;

let chatSeq = 0;

function roleFromAgentId(agentId: string): string {
  const dash = agentId.lastIndexOf("-");
  return dash > 0 ? agentId.slice(0, dash) : agentId;
}

const TODO_GLYPH: Record<TodoItem["status"], string> = {
  pending: "\u25CB",
  in_progress: "\u25D0",
  completed: "\u2713",
  cancelled: "\u2298",
};

export function App({ services }: { services: AppServices }) {
  const { bus, config, cwd, orchestrator, usage, store, todos } = services;
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [chatItems, setChatItems] = useState<ChatItem[]>(() =>
    store.chat().map((entry) => ({
      id: ++chatSeq,
      ...entry,
    }))
  );
  const [streamingText, setStreamingText] = useState("");
  const [subagentStreams, setSubagentStreams] = useState<Map<string, SubagentStream>>(new Map());
  const [agents, setAgents] = useState<Map<string, AgentView>>(new Map());
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([]);
  const [lastEdit, setLastEdit] = useState<EditView | undefined>(undefined);
  const [todoItems, setTodoItems] = useState<TodoItem[]>(() => store.snapshot().todos);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scrollBack, setScrollBack] = useState(0);
  const [agentScrollBack, setAgentScrollBack] = useState(0);
  const [, setTick] = useState(0);

  const abortRef = useRef<AbortController | undefined>(undefined);
  const streamingRef = useRef("");
  const subagentStreamingRef = useRef(new Map<string, SubagentStream>());
  const toolRows = useRef(new Map<string, number>());
  const scrollMetricsRef = useRef({ totalLines: 0, viewportLines: 20 });
  const agentScrollMetricsRef = useRef({ totalLines: 0, viewportLines: 8 });

  const scrollByLines = useCallback((delta: number) => {
    setScrollBack((prev) => {
      const { totalLines, viewportLines } = scrollMetricsRef.current;
      const max = Math.max(0, totalLines - viewportLines);
      return Math.max(0, Math.min(max, prev + delta));
    });
  }, []);

  const agentScrollByLines = useCallback((delta: number) => {
    setAgentScrollBack((prev) => {
      const { totalLines, viewportLines } = agentScrollMetricsRef.current;
      const max = Math.max(0, totalLines - viewportLines);
      return Math.max(0, Math.min(max, prev + delta));
    });
  }, []);

  const syncChatToStore = useCallback(
    (items: ChatItem[]) => {
      store.setChat(items.map(({ id, ...rest }) => rest));
    },
    [store]
  );

  const addChat = useCallback(
    (item: Omit<ChatItem, "id">) => {
      const id = ++chatSeq;
      setChatItems((prev) => {
        const next = [...prev, { ...item, id }];
        syncChatToStore(next);
        return next;
      });
      return id;
    },
    [syncChatToStore]
  );

  const clearOrchestratorStream = useCallback(() => {
    streamingRef.current = "";
    setStreamingText("");
  }, []);

  const flushOrchestratorStream = useCallback(() => {
    const text = streamingRef.current.trim();
    clearOrchestratorStream();
    if (text) addChat({ kind: "assistant", text });
    return text;
  }, [addChat, clearOrchestratorStream]);

  const flushSubagentStream = useCallback(
    (agentId: string, role: string) => {
      const stream = subagentStreamingRef.current.get(agentId);
      if (!stream) return;
      subagentStreamingRef.current.delete(agentId);
      setSubagentStreams(new Map(subagentStreamingRef.current));
      const text = stream.text.trim();
      if (text) {
        addChat({ kind: "subagent", role, label: agentId, text: `reply \u00B7 ${text}` });
      }
    },
    [addChat]
  );

  const clearSubagentStreams = useCallback(() => {
    subagentStreamingRef.current.clear();
    setSubagentStreams(new Map());
  }, []);

  // Re-render every second while agents are running so timers advance.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Re-render on terminal resize so the layout adapts.
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setTick((t) => t + 1);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  // Mouse wheel scrolls the chat history.
  useEffect(() => {
    const mouse = services.mouse;
    if (!mouse) return;
    return mouse.onWheel((delta) => scrollByLines(delta * WHEEL_SCROLL_LINES));
  }, [services.mouse, scrollByLines]);

  useEffect(() => {
    const orchestratorId = orchestrator.id;
    return bus.on((event) => {
      switch (event.type) {
        case "agent:start": {
          setAgents((prev) => {
            const next = new Map(prev);
            next.set(event.agentId, {
              id: event.agentId,
              role: event.role,
              model: event.model,
              state: "running",
              detail: "thinking...",
              contextTokens: 0,
              tokens: 0,
              startedAt: Date.now(),
            });
            return next;
          });
          if (event.agentId !== orchestratorId) {
            const brief = event.task.length > 80 ? `${event.task.slice(0, 80)}...` : event.task;
            addChat({
              kind: "subagent",
              role: event.role,
              label: event.agentId,
              text: `started \u00B7 ${brief}`,
            });
          }
          break;
        }
        case "agent:token": {
          if (event.role === "orchestrator") {
            streamingRef.current += event.text;
            setStreamingText(streamingRef.current);
          } else {
            const existing = subagentStreamingRef.current.get(event.agentId);
            const next: SubagentStream = {
              role: event.role,
              label: event.agentId,
              text: (existing?.text ?? "") + event.text,
            };
            subagentStreamingRef.current.set(event.agentId, next);
            setSubagentStreams(new Map(subagentStreamingRef.current));
          }
          break;
        }
        case "agent:tool:start": {
          setAgents((prev) => {
            const existing = prev.get(event.agentId);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(event.agentId, { ...existing, detail: `${event.tool}: ${event.detail}` });
            return next;
          });
          if (event.agentId === orchestratorId) {
            flushOrchestratorStream();
            if (event.tool === "Task") clearSubagentStreams();
            const rowId = addChat({ kind: "tool", label: event.tool, text: event.detail });
            toolRows.current.set(event.callId, rowId);
          } else {
            const rowId = addChat({
              kind: "subagent",
              role: roleFromAgentId(event.agentId),
              label: event.agentId,
              tool: event.tool,
              text: event.detail,
            });
            toolRows.current.set(event.callId, rowId);
          }
          break;
        }
        case "agent:tool:end": {
          setAgents((prev) => {
            const existing = prev.get(event.agentId);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(event.agentId, { ...existing, detail: "thinking..." });
            return next;
          });
          const rowId = toolRows.current.get(event.callId);
          if (rowId !== undefined) {
            toolRows.current.delete(event.callId);
            setChatItems((prev) => {
              const next = prev.map((item) =>
                item.id === rowId ? { ...item, ok: event.ok, text: event.detail } : item
              );
              syncChatToStore(next);
              return next;
            });
          }
          // Drop any token garbage that landed in the orchestrator stream while
          // parallel subagents were hammering the same llama-server instance.
          if (event.agentId === orchestratorId && event.tool === "Task") {
            clearOrchestratorStream();
          }
          break;
        }
        case "agent:usage": {
          setAgents((prev) => {
            const existing = prev.get(event.agentId);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(event.agentId, {
              ...existing,
              contextTokens: event.input,
              tokens: existing.tokens + event.input + event.output,
            });
            return next;
          });
          break;
        }
        case "agent:done": {
          setAgents((prev) => {
            const existing = prev.get(event.agentId);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(event.agentId, {
              ...existing,
              state: event.report.status === "success" ? "done" : "error",
              detail: "",
              endedAt: Date.now(),
            });
            return next;
          });
          if (event.agentId !== orchestratorId) {
            flushSubagentStream(event.agentId, event.report.role);
            const r = event.report;
            const files = r.filesTouched.length > 0 ? ` \u00B7 ${r.filesTouched.length} file(s)` : "";
            addChat({
              kind: "subagent",
              role: r.role,
              label: event.agentId,
              text: `finished \u00B7 ${r.status}${files} \u00B7 ${r.toolCallCount} tool calls \u00B7 ${formatTokens(
                r.tokens.input + r.tokens.output
              )} tok`,
            });
          }
          break;
        }
        case "agent:error": {
          if (event.agentId === orchestratorId) {
            addChat({ kind: "error", text: `${event.agentId}: ${event.error}` });
          } else {
            addChat({
              kind: "subagent",
              role: roleFromAgentId(event.agentId),
              label: event.agentId,
              text: `error \u00B7 ${event.error}`,
            });
          }
          break;
        }
        case "approval:request": {
          setApprovalQueue((prev) => [...prev, event.request]);
          break;
        }
        case "file:edit": {
          setLastEdit({ path: event.path, before: event.before, after: event.after });
          break;
        }
        case "todo:update": {
          setTodoItems(event.todos);
          break;
        }
        default:
          break;
      }
    });
  }, [
    bus,
    orchestrator.id,
    addChat,
    flushOrchestratorStream,
    flushSubagentStream,
    clearOrchestratorStream,
    clearSubagentStreams,
    syncChatToStore,
  ]);

  const pendingApproval = approvalQueue[0];

  useInput((inputChar, key) => {
    if (pendingApproval) {
      const c = inputChar.toLowerCase();
      if (c === "y" || c === "a" || c === "n") {
        bus.resolveApproval(pendingApproval.id, c === "y" ? "allow" : c === "a" ? "always" : "deny");
        setApprovalQueue((prev) => prev.slice(1));
      }
      return;
    }
    if (key.shift && key.upArrow) {
      agentScrollByLines(-ARROW_SCROLL_LINES);
      return;
    }
    if (key.shift && key.downArrow) {
      agentScrollByLines(ARROW_SCROLL_LINES);
      return;
    }
    if (key.shift && key.pageUp) {
      agentScrollByLines(-agentScrollMetricsRef.current.viewportLines);
      return;
    }
    if (key.shift && key.pageDown) {
      agentScrollByLines(agentScrollMetricsRef.current.viewportLines);
      return;
    }
    if (key.shift && key.home) {
      setAgentScrollBack(0);
      return;
    }
    if (key.shift && key.end) {
      const { totalLines, viewportLines } = agentScrollMetricsRef.current;
      setAgentScrollBack(Math.max(0, totalLines - viewportLines));
      return;
    }
    if (key.upArrow) {
      scrollByLines(ARROW_SCROLL_LINES);
      return;
    }
    if (key.downArrow) {
      scrollByLines(-ARROW_SCROLL_LINES);
      return;
    }
    if (key.pageUp) {
      scrollByLines(scrollMetricsRef.current.viewportLines);
      return;
    }
    if (key.pageDown) {
      scrollByLines(-scrollMetricsRef.current.viewportLines);
      return;
    }
    if (key.end) {
      setScrollBack(0);
      return;
    }
    if (key.home) {
      const { totalLines, viewportLines } = scrollMetricsRef.current;
      setScrollBack(Math.max(0, totalLines - viewportLines));
      return;
    }
    if (key.escape && busy) {
      abortRef.current?.abort();
      addChat({ kind: "info", text: "(cancelling...)" });
    }
  });

  const applySession = useCallback(
    (doc: ReturnType<SessionStore["snapshot"]>) => {
      orchestrator.loadHistory(deserializeMessages(doc.messages));
      orchestrator.setInputTokens(doc.lastInputTokens);
      usage.reset(doc.usage);
      todos.restore(doc.todos);
      setChatItems(doc.chat.map((entry) => ({ id: ++chatSeq, ...entry })));
      setScrollBack(0);
      clearOrchestratorStream();
      clearSubagentStreams();
      setAgents(new Map());
      setAgentScrollBack(0);
      toolRows.current.clear();
      setLastEdit(undefined);
    },
    [clearOrchestratorStream, clearSubagentStreams, orchestrator, todos, usage]
  );

  const handleCommand = useCallback(
    (command: string): boolean => {
      const trimmed = command.trim();
      const cmd = trimmed.toLowerCase();
      if (cmd === "/help") {
        addChat({
          kind: "info",
          text: [
            "/agents  show agent roles and their models",
            "/model   show resolved model endpoints",
            "/cost    show token usage",
            "/resume  list saved sessions, or /resume <filename> to load one",
            "/clear   clear chat, orchestrator memory, and agent list",
            "/exit    quit",
          ].join("\n"),
        });
        return true;
      }
      if (cmd === "/agents" || cmd === "/model") {
        const lines = (["orchestrator", "explorer", "coder", "reviewer"] as const).map((role) => {
          const m = resolveModelConfig(config, role);
          return `${role.padEnd(13)} ${m.model} @ ${m.baseURL} (temp ${m.temperature}, maxSteps ${m.maxSteps})`;
        });
        addChat({ kind: "info", text: lines.join("\n") });
        return true;
      }
      if (cmd === "/cost") {
        addChat({
          kind: "info",
          text: `tokens: ${formatTokens(usage.input)} in + ${formatTokens(usage.output)} out = ${formatTokens(usage.total)} total`,
        });
        return true;
      }
      if (cmd === "/clear") {
        orchestrator.clearHistory();
        todos.restore([]);
        store.clear();
        setChatItems([]);
        setScrollBack(0);
        clearOrchestratorStream();
        clearSubagentStreams();
        setAgents(new Map());
        setAgentScrollBack(0);
        toolRows.current.clear();
        addChat({ kind: "info", text: "(chat, orchestrator memory, and agent list cleared)" });
        return true;
      }
      if (cmd === "/resume" || cmd.startsWith("/resume ")) {
        if (busy) {
          addChat({ kind: "info", text: "(cannot resume while a run is in progress)" });
          return true;
        }
        const arg = trimmed.slice("/resume".length).trim();
        if (!arg) {
          const sessions = store.listSessions();
          if (sessions.length === 0) {
            addChat({ kind: "info", text: "(no saved sessions)" });
            return true;
          }
          const lines = sessions.map(
            (s) =>
              `${s.filename}  ${new Date(s.updatedAt).toLocaleString()}  ${s.messageCount} msgs  ${formatTokens(s.usageTotal)} tok`
          );
          addChat({ kind: "info", text: ["saved sessions:", ...lines].join("\n") });
          return true;
        }
        const filePath = store.resolveSessionFile(arg);
        if (!filePath) {
          addChat({ kind: "info", text: `session not found: ${arg}` });
          return true;
        }
        const doc = store.loadSession(filePath);
        if (!doc) {
          addChat({ kind: "info", text: `failed to load session: ${arg}` });
          return true;
        }
        applySession(doc);
        addChat({ kind: "info", text: `resumed ${path.basename(filePath)}` });
        return true;
      }
      if (cmd === "/exit" || cmd === "/quit") {
        exit();
        return true;
      }
      if (cmd.startsWith("/")) {
        addChat({ kind: "info", text: `Unknown command: ${cmd} (try /help)` });
        return true;
      }
      return false;
    },
    [addChat, applySession, busy, clearOrchestratorStream, clearSubagentStreams, config, exit, orchestrator, store, todos, usage]
  );

  const handleSubmit = useCallback(
    (value: string) => {
      const text = value.trim();
      setInput("");
      if (!text) return;
      if (handleCommand(text)) return;
      if (busy) {
        addChat({ kind: "info", text: "(an orchestrator run is already in progress -- esc to cancel)" });
        return;
      }

      addChat({ kind: "user", text });
      setScrollBack(0);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      orchestrator
        .run(text, { signal: controller.signal })
        .then((report) => {
          const remainder = flushOrchestratorStream();
          clearSubagentStreams();
          const finalText = report.summary.trim();
          // Avoid duplicating the final message if streaming already captured it.
          if (finalText && finalText !== remainder) {
            if (!remainder) addChat({ kind: "assistant", text: finalText });
          }
        })
        .catch((err) => {
          addChat({ kind: "error", text: `orchestrator failed: ${(err as Error).message}` });
        })
        .finally(() => {
          setBusy(false);
          abortRef.current = undefined;
        });
    },
    [addChat, busy, clearSubagentStreams, flushOrchestratorStream, handleCommand, orchestrator, store]
  );

  const activeAgents = useMemo(
    () => [...agents.values()].filter((a) => a.state === "running").length,
    [agents]
  );

  const agentViews = useMemo(() => [...agents.values()], [agents]);
  const orchestratorModel = resolveModelConfig(config, "orchestrator").model;
  const orchestratorContextTokens = orchestrator.inputTokens();

  const rows = stdout?.rows ?? 35;
  const columns = stdout?.columns ?? 100;
  const sideWidth = Math.min(44, Math.max(30, Math.floor(columns * 0.32)));
  // header (1) + input box (3) + status bar (1) + approval prompt (5) never
  // belong to the chat pane; whatever is left is the chat's line budget.
  const chatHeight = rows - 1 - 1 - 3 - 1 - (pendingApproval ? 5 : 0);
  const chatWidth = columns - sideWidth - 2;
  const todosLines = todoItems.length > 0 ? 2 + Math.min(8, todoItems.length) : 0;
  const diffMinLines = 5;
  const agentStatusHeight = Math.max(8, chatHeight - todosLines - diffMinLines);
  const orchestratorViewLines = agentLineCount(
    agentViews.find((a) => a.id === orchestrator.id) ?? {
      id: orchestrator.id,
      role: "orchestrator",
      model: orchestratorModel,
      state: busy ? "running" : "queued",
      detail: busy ? "thinking..." : "",
      contextTokens: orchestratorContextTokens,
      tokens: 0,
      startedAt: 0,
    }
  );
  const subagentListHeight = Math.max(
    1,
    agentStatusHeight -
      1 -
      orchestratorViewLines -
      (countSubagentLines(agentViews, orchestrator.id) > 0 ? 1 : 0)
  );

  scrollMetricsRef.current = {
    totalLines: countChatLines(chatItems, streamingText, subagentStreams, chatWidth),
    viewportLines: Math.max(1, chatHeight),
  };
  agentScrollMetricsRef.current = {
    totalLines: countSubagentLines(agentViews, orchestrator.id),
    viewportLines: subagentListHeight,
  };

  return (
    <Box flexDirection="column" height={rows - 1}>
      <Box paddingX={1} justifyContent="space-between">
        <Text>
          <Text color="magenta" bold>
            {"\u2726"} luminous
          </Text>
        </Text>
        <Text dimColor>{cwd}</Text>
      </Box>

      <Box flexGrow={1}>
        <Chat
          items={chatItems}
          streamingText={streamingText}
          subagentStreams={subagentStreams}
          height={chatHeight}
          width={chatWidth}
          scrollBack={scrollBack}
        />
        <Box
          flexDirection="column"
          width={sideWidth}
          height={chatHeight}
          borderStyle="round"
          borderDimColor
          flexShrink={0}
          overflow="hidden"
        >
          <AgentStatus
            orchestratorId={orchestrator.id}
            orchestratorModel={orchestratorModel}
            orchestratorContextTokens={orchestratorContextTokens}
            agents={agentViews}
            busy={busy}
            height={agentStatusHeight}
            scrollBack={agentScrollBack}
          />
          {todoItems.length > 0 && (
            <Box flexDirection="column" paddingX={1} marginTop={1}>
              <Text bold dimColor>
                TODOS
              </Text>
              {todoItems.slice(0, 8).map((t) => (
                <Text key={t.id} dimColor={t.status === "completed"} wrap="truncate-end">
                  {TODO_GLYPH[t.status]} {t.content}
                </Text>
              ))}
            </Box>
          )}
          <Box marginTop={1}>
            <DiffView edit={lastEdit} cwd={cwd} />
          </Box>
        </Box>
      </Box>

      {pendingApproval && <Approval request={pendingApproval} />}

      <Box paddingX={1} borderStyle="round" borderDimColor>
        <Text color="cyan">{"\u276F "}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={busy ? "orchestrator is working... (esc to cancel)" : "describe a coding task or /help"}
          focus={pendingApproval === undefined}
        />
      </Box>

      <StatusBar
        status={{
          activeAgents,
          tokens: usage.total,
          baseURL: config.baseURL,
          connected: services.connected,
          busy,
        }}
      />
    </Box>
  );
}
