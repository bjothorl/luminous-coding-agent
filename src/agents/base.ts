import { createAgent } from "langchain";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { LuminousConfig } from "../config/index.js";
import { resolveModelConfig } from "../config/index.js";
import { createChatModel } from "../providers/index.js";
import type { ApprovalService } from "../session/approvals.js";
import type { FileClaimRegistry } from "../session/claims.js";
import type { SessionBus } from "../session/events.js";
import type { TodoStore } from "../session/todo.js";
import type { LuminousTool, ToolContext } from "../tools/base.js";
import type { AgentRole, TaskReport } from "../types.js";
import { toolErrorMiddleware } from "./middleware.js";

export interface AgentDeps {
  cwd: string;
  config: LuminousConfig;
  bus: SessionBus;
  approvals: ApprovalService;
  claims: FileClaimRegistry;
  todos: TodoStore;
}

export interface RunOptions {
  signal?: AbortSignal;
}

const roleCounters = new Map<string, number>();

function nextAgentId(role: AgentRole): string {
  const n = (roleCounters.get(role) ?? 0) + 1;
  roleCounters.set(role, n);
  return `${role}-${n}`;
}

function textOf(message: BaseMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => (block?.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

/**
 * Abstract base for every Luminous agent. Wraps LangChain's createAgent:
 * each subclass declares its role, system prompt, and tool whitelist, and
 * run() streams the agent loop while emitting events to the session bus and
 * mechanically assembling a TaskReport.
 */
export abstract class BaseAgent {
  protected abstract systemPrompt(): string;
  protected abstract buildTools(ctx: ToolContext): LuminousTool[];

  readonly role: AgentRole;
  readonly id: string;
  protected history: BaseMessage[] = [];

  constructor(protected deps: AgentDeps, role: AgentRole) {
    this.role = role;
    this.id = nextAgentId(role);
  }

  /** Pre-seed conversation history (used by --resume for the orchestrator). */
  seedHistory(turns: Array<{ role: "user" | "assistant"; text: string }>): void {
    this.history = turns.map((t) =>
      t.role === "user" ? new HumanMessage(t.text) : new AIMessage(t.text)
    );
  }

  clearHistory(): void {
    this.history = [];
  }

  async run(task: string, options: RunOptions = {}): Promise<TaskReport> {
    const { bus, config, cwd } = this.deps;
    const modelCfg = resolveModelConfig(config, this.role);
    const startedAt = Date.now();

    const tracker = { filesTouched: new Set<string>(), toolCallCount: 0 };
    const ctx: ToolContext = {
      cwd,
      agentId: this.id,
      bus,
      approvals: this.deps.approvals,
      claims: this.deps.claims,
      todos: this.deps.todos,
      config,
      tracker,
    };

    const agent = createAgent({
      model: createChatModel(modelCfg),
      tools: this.buildTools(ctx),
      systemPrompt: this.systemPrompt(),
      middleware: [toolErrorMiddleware],
    });

    bus.emit({ type: "agent:start", agentId: this.id, role: this.role, model: modelCfg.model, task });

    const inputMessages = [...this.history, new HumanMessage(task)];
    let tokensIn = 0;
    let tokensOut = 0;
    let finalMessages: BaseMessage[] = [];
    let status: TaskReport["status"] = "success";
    let errorText: string | undefined;

    try {
      const stream = await agent.stream(
        { messages: inputMessages },
        {
          streamMode: ["messages", "values"],
          recursionLimit: modelCfg.maxSteps,
          signal: options.signal,
        }
      );

      for await (const [mode, payload] of stream as AsyncIterable<[string, any]>) {
        if (mode === "messages") {
          const [message] = payload as [BaseMessage, Record<string, unknown>];
          if (message instanceof AIMessageChunk || message.getType?.() === "ai") {
            const text = textOf(message);
            if (text) bus.emit({ type: "agent:token", agentId: this.id, role: this.role, text });
            const usage = (message as AIMessageChunk).usage_metadata;
            if (usage) {
              tokensIn += usage.input_tokens ?? 0;
              tokensOut += usage.output_tokens ?? 0;
              bus.emit({
                type: "agent:usage",
                agentId: this.id,
                input: usage.input_tokens ?? 0,
                output: usage.output_tokens ?? 0,
              });
            }
          }
        } else if (mode === "values") {
          const state = payload as { messages?: BaseMessage[] };
          if (state.messages) finalMessages = state.messages;
        }
      }
    } catch (err) {
      const e = err as Error;
      if (e.name === "GraphRecursionError") {
        status = "step_cap";
        errorText = `Step cap of ${modelCfg.maxSteps} reached before the task completed.`;
      } else {
        status = "error";
        errorText = e.message;
      }
      bus.emit({ type: "agent:error", agentId: this.id, error: errorText });
    } finally {
      this.deps.claims.releaseAll(this.id);
    }

    if (finalMessages.length > 0) {
      this.history = finalMessages;
    } else {
      this.history = inputMessages;
    }

    const lastAi = [...finalMessages].reverse().find((m) => m.getType() === "ai");
    const summary = lastAi ? textOf(lastAi) : "";

    const report: TaskReport = {
      agentId: this.id,
      role: this.role,
      task,
      status,
      summary: summary || (errorText ?? ""),
      filesTouched: [...tracker.filesTouched],
      toolCallCount: tracker.toolCallCount,
      tokens: { input: tokensIn, output: tokensOut },
      durationMs: Date.now() - startedAt,
      error: errorText,
    };

    bus.emit({ type: "agent:done", agentId: this.id, report });
    return report;
  }
}
