import path from "node:path";
import * as z from "zod";
import { StructuredTool } from "@langchain/core/tools";
import type { LuminousConfig } from "../config/index.js";
import type { ApprovalService } from "../session/approvals.js";
import type { FileClaimRegistry } from "../session/claims.js";
import type { SessionBus } from "../session/events.js";
import type { TodoStore } from "../session/todo.js";

/** Everything a tool needs to know about the agent invoking it. */
export interface ToolContext {
  cwd: string;
  agentId: string;
  bus: SessionBus;
  approvals: ApprovalService;
  claims: FileClaimRegistry;
  todos: TodoStore;
  config: LuminousConfig;
  /** Mechanical tracking used to assemble the TaskReport. */
  tracker: {
    filesTouched: Set<string>;
    toolCallCount: number;
  };
}

let callSeq = 0;

/**
 * Base class for all Luminous tools ("baseTool"). Adds on top of
 * LangChain's StructuredTool:
 *  - event emission to the session bus (TUI live view)
 *  - mechanical tracking for TaskReports
 *  - errors returned as tool output strings so the model can self-correct
 */
export abstract class LuminousTool<S extends z.ZodTypeAny = z.ZodTypeAny> extends StructuredTool<S> {
  constructor(protected ctx: ToolContext) {
    super();
  }

  /** Short human-readable label for the TUI, e.g. the file path. */
  protected abstract describeCall(input: z.infer<S>): string;

  protected abstract execute(input: z.infer<S>): Promise<string>;

  // `any` matches the base signature for all schema generics; input is
  // already validated against `schema` by StructuredTool before _call runs.
  protected async _call(arg: any): Promise<string> {
    const input = arg as z.infer<S>;
    const callId = `call-${++callSeq}`;
    const detail = this.describeCall(input);
    this.ctx.tracker.toolCallCount += 1;
    this.ctx.bus.emit({
      type: "agent:tool:start",
      agentId: this.ctx.agentId,
      callId,
      tool: this.name,
      detail,
    });
    try {
      const result = await this.execute(input);
      this.ctx.bus.emit({
        type: "agent:tool:end",
        agentId: this.ctx.agentId,
        callId,
        tool: this.name,
        ok: true,
        detail,
      });
      return result;
    } catch (err) {
      this.ctx.bus.emit({
        type: "agent:tool:end",
        agentId: this.ctx.agentId,
        callId,
        tool: this.name,
        ok: false,
        detail: `${detail}: ${(err as Error).message}`,
      });
      return `Error: ${(err as Error).message}`;
    }
  }

  /** Resolve a possibly-relative path against the project root. */
  protected resolvePath(p: string): string {
    return path.isAbsolute(p) ? path.normalize(p) : path.resolve(this.ctx.cwd, p);
  }

  protected isInsideProject(absPath: string): boolean {
    const rel = path.relative(this.ctx.cwd, absPath);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (truncated, ${text.length - maxChars} more characters)`;
}
