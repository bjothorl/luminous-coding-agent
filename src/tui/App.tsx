import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import path from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type { OrchestratorAgent } from "../agents/orchestrator.js";
import type { LuminousConfig } from "../config/index.js";
import { resolveModelConfig } from "../config/index.js";
import type { ApprovalRequest, SessionBus } from "../session/events.js";
import type { SessionStore } from "../session/store.js";
import type { TodoStore } from "../session/todo.js";
import type { UsageTracker } from "../session/usage.js";
import { formatTokens } from "../session/usage.js";
import type { TodoItem } from "../types.js";
import { AgentStatus, type AgentView } from "./AgentStatus.js";
import { Approval } from "./Approval.js";
import { Chat, countChatLines, type ChatItem } from "./Chat.js";
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
    store.history().map((entry) => ({
      id: ++chatSeq,
      kind: entry.role === "user" ? "user" : "assistant",
      text: entry.text,
    }))
  );
  const [streamingText, setStreamingText] = useState("");
  const [agents, setAgents] = useState<Map<string, AgentView>>(new Map());
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([]);
  const [lastEdit, setLastEdit] = useState<EditView | undefined>(undefined);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scrollBack, setScrollBack] = useState(0);
  const [, setTick] = useState(0);

  const abortRef = useRef<AbortController | undefined>(undefined);
  const streamingRef = useRef("");
  const toolRows = useRef(new Map<string, number>());
  const scrollMetricsRef = useRef({ totalLines: 0, viewportLines: 20 });

  const scrollByLines = useCallback((delta: number) => {
    setScrollBack((prev) => {
      const { totalLines, viewportLines } = scrollMetricsRef.current;
      const max = Math.max(0, totalLines - viewportLines);
      return Math.max(0, Math.min(max, prev + delta));
    });
  }, []);

  const addChat = useCallback((item: Omit<ChatItem, "id">) => {
    const id = ++chatSeq;
    setChatItems((prev) => [...prev, { ...item, id }]);
    return id;
  }, []);

  const flushStreaming = useCallback(() => {
    const text = streamingRef.current.trim();
    streamingRef.current = "";
    setStreamingText("");
    if (text) addChat({ kind: "assistant", text });
    return text;
  }, [addChat]);

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
              tokens: 0,
              startedAt: Date.now(),
            });
            return next;
          });
          if (event.agentId !== orchestratorId) {
            const brief = event.task.length > 80 ? `${event.task.slice(0, 80)}...` : event.task;
            addChat({ kind: "subagent", label: event.agentId, text: brief });
          }
          break;
        }
        case "agent:token": {
          if (event.agentId === orchestratorId) {
            streamingRef.current += event.text;
            setStreamingText(streamingRef.current);
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
            flushStreaming();
            const rowId = addChat({ kind: "tool", label: event.tool, text: event.detail });
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
            setChatItems((prev) =>
              prev.map((item) => (item.id === rowId ? { ...item, ok: event.ok, text: event.detail } : item))
            );
          }
          break;
        }
        case "agent:usage": {
          setAgents((prev) => {
            const existing = prev.get(event.agentId);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(event.agentId, { ...existing, tokens: existing.tokens + event.input + event.output });
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
            const r = event.report;
            const files = r.filesTouched.length > 0 ? ` \u00B7 ${r.filesTouched.length} file(s)` : "";
            addChat({
              kind: "subagent",
              label: event.agentId,
              text: `${r.status}${files} \u00B7 ${r.toolCallCount} tool calls \u00B7 ${formatTokens(
                r.tokens.input + r.tokens.output
              )} tok`,
            });
          }
          break;
        }
        case "agent:error": {
          addChat({ kind: "error", text: `${event.agentId}: ${event.error}` });
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
  }, [bus, orchestrator.id, addChat, flushStreaming]);

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

  const handleCommand = useCallback(
    (command: string): boolean => {
      const cmd = command.trim().toLowerCase();
      if (cmd === "/help") {
        addChat({
          kind: "info",
          text: [
            "/agents  show agent roles and their models",
            "/model   show resolved model endpoints",
            "/cost    show token usage",
            "/clear   clear chat and orchestrator memory",
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
        store.clear();
        setChatItems([]);
        setScrollBack(0);
        addChat({ kind: "info", text: "(chat and orchestrator memory cleared)" });
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
    [addChat, config, exit, orchestrator, store, usage]
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
      store.append({ role: "user", text, ts: Date.now() });
      setScrollBack(0);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      orchestrator
        .run(text, { signal: controller.signal })
        .then((report) => {
          const remainder = flushStreaming();
          const finalText = report.summary.trim();
          // Avoid duplicating the final message if streaming already captured it.
          if (finalText && finalText !== remainder) {
            if (!remainder) addChat({ kind: "assistant", text: finalText });
          }
          store.append({ role: "assistant", text: finalText || remainder, ts: Date.now() });
        })
        .catch((err) => {
          addChat({ kind: "error", text: `orchestrator failed: ${(err as Error).message}` });
        })
        .finally(() => {
          setBusy(false);
          abortRef.current = undefined;
        });
    },
    [addChat, busy, flushStreaming, handleCommand, orchestrator, store]
  );

  const activeAgents = useMemo(
    () => [...agents.values()].filter((a) => a.state === "running").length,
    [agents]
  );

  const rows = stdout?.rows ?? 35;
  const columns = stdout?.columns ?? 100;
  const sideWidth = Math.min(44, Math.max(30, Math.floor(columns * 0.32)));
  // header (1) + input box (3) + status bar (1) + approval prompt (5) never
  // belong to the chat pane; whatever is left is the chat's line budget.
  const chatHeight = rows - 1 - 1 - 3 - 1 - (pendingApproval ? 5 : 0);
  const chatWidth = columns - sideWidth - 2;
  scrollMetricsRef.current = {
    totalLines: countChatLines(chatItems, streamingText, chatWidth),
    viewportLines: Math.max(1, chatHeight),
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
          height={chatHeight}
          width={chatWidth}
          scrollBack={scrollBack}
        />
        <Box
          flexDirection="column"
          width={sideWidth}
          borderStyle="round"
          borderDimColor
          flexShrink={0}
          overflow="hidden"
        >
          <AgentStatus agents={[...agents.values()]} />
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
