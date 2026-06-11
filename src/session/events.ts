import { EventEmitter } from "node:events";
import type { AgentRole, TaskReport, TodoItem } from "../types.js";

export type AgentRuntimeState = "queued" | "running" | "done" | "error";

export type ApprovalKind = "shell" | "write";

export interface ApprovalRequest {
  id: string;
  agentId: string;
  kind: ApprovalKind;
  /** Human-readable description, e.g. the shell command or file path. */
  detail: string;
  /** Key used for the "always allow" list. */
  allowKey: string;
}

export type ApprovalDecision = "allow" | "always" | "deny";

export type SessionEvent =
  | { type: "agent:start"; agentId: string; role: AgentRole; model: string; task: string }
  | { type: "agent:token"; agentId: string; text: string }
  | { type: "agent:tool:start"; agentId: string; callId: string; tool: string; detail: string }
  | { type: "agent:tool:end"; agentId: string; callId: string; tool: string; ok: boolean; detail: string }
  | { type: "agent:usage"; agentId: string; input: number; output: number }
  | { type: "agent:done"; agentId: string; report: TaskReport }
  | { type: "agent:error"; agentId: string; error: string }
  | { type: "approval:request"; request: ApprovalRequest }
  | { type: "approval:resolved"; id: string; decision: ApprovalDecision }
  | { type: "file:edit"; agentId: string; path: string; before: string; after: string }
  | { type: "todo:update"; todos: TodoItem[] };

/**
 * Typed session-wide event bus. Tools and agents publish here; the TUI
 * (or the headless printer) subscribes.
 */
export class SessionBus {
  private emitter = new EventEmitter();
  private pendingApprovals = new Map<string, (d: ApprovalDecision) => void>();
  private approvalSeq = 0;

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: SessionEvent): void {
    this.emitter.emit("event", event);
  }

  on(listener: (event: SessionEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  /** Publish an approval request and wait for the UI to resolve it. */
  requestApproval(req: Omit<ApprovalRequest, "id">): Promise<ApprovalDecision> {
    const id = `approval-${++this.approvalSeq}`;
    const request: ApprovalRequest = { ...req, id };
    return new Promise<ApprovalDecision>((resolve) => {
      this.pendingApprovals.set(id, resolve);
      this.emit({ type: "approval:request", request });
    });
  }

  resolveApproval(id: string, decision: ApprovalDecision): void {
    const resolver = this.pendingApprovals.get(id);
    if (resolver) {
      this.pendingApprovals.delete(id);
      this.emit({ type: "approval:resolved", id, decision });
      resolver(decision);
    }
  }
}
