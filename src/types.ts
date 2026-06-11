export type AgentRole = "orchestrator" | "explorer" | "coder" | "reviewer";

export const SUBAGENT_ROLES = ["explorer", "coder", "reviewer"] as const;

export type TaskStatus = "success" | "error" | "step_cap";

/**
 * The structured handoff contract between subagents and the orchestrator.
 * Subagents never return raw transcripts -- only this report.
 */
export interface TaskReport {
  agentId: string;
  role: AgentRole;
  task: string;
  status: TaskStatus;
  summary: string;
  filesTouched: string[];
  toolCallCount: number;
  tokens: { input: number; output: number };
  durationMs: number;
  error?: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

/** Compact text rendering of a TaskReport, fed back to the orchestrator. */
export function formatReport(r: TaskReport): string {
  const lines = [
    `[TaskReport] agent=${r.agentId} status=${r.status}`,
    `task: ${r.task}`,
    `summary: ${r.summary || "(no summary)"}`,
  ];
  if (r.filesTouched.length > 0) {
    lines.push(`files touched: ${r.filesTouched.join(", ")}`);
  }
  if (r.error) {
    lines.push(`error: ${r.error}`);
  }
  lines.push(
    `stats: ${r.toolCallCount} tool calls, ${r.tokens.input}+${r.tokens.output} tokens, ${Math.round(r.durationMs / 1000)}s`
  );
  return lines.join("\n");
}
