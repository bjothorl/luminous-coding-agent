import type { AgentDeps, BaseAgent } from "./base.js";
import { CoderAgent } from "./coder.js";
import { ExplorerAgent } from "./explorer.js";
import { ReviewerAgent } from "./reviewer.js";

export type SubagentRole = "explorer" | "coder" | "reviewer";

const REGISTRY: Record<SubagentRole, new (deps: AgentDeps) => BaseAgent> = {
  explorer: ExplorerAgent,
  coder: CoderAgent,
  reviewer: ReviewerAgent,
};

/** Each delegation spawns a fresh instance: isolated context by construction. */
export function createSubagent(role: SubagentRole, deps: AgentDeps): BaseAgent {
  const AgentClass = REGISTRY[role];
  if (!AgentClass) {
    throw new Error(`Unknown agent role: ${role}`);
  }
  return new AgentClass(deps);
}
