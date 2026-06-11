import * as z from "zod";
import { createSubagent, type SubagentRole } from "../agents/registry.js";
import type { AgentDeps } from "../agents/base.js";
import { formatReport } from "../types.js";
import { LuminousTool, type ToolContext } from "./base.js";

const taskSchema = z.object({
  agent: z.enum(["explorer", "coder", "reviewer"]).describe(
    "Which subagent to launch: explorer (read-only codebase scout), coder (implements changes), reviewer (verifies completed work)"
  ),
  description: z
    .string()
    .describe(
      "Complete, self-contained task brief. The subagent cannot see the conversation, so include all needed context: relevant file paths, constraints, and exactly what to deliver."
    ),
});

const schema = z.object({
  tasks: z
    .array(taskSchema)
    .min(1)
    .describe(
      "Tasks to run IN PARALLEL, each in a fresh subagent with isolated context. Parallel coder tasks MUST target disjoint sets of files."
    ),
});

/**
 * The delegation tool. Spawns fresh subagents (one per task) in parallel and
 * returns their structured TaskReports -- never raw transcripts -- keeping
 * the orchestrator's context small.
 */
export class TaskTool extends LuminousTool<typeof schema> {
  name = "Task";
  description =
    "Launches subagents to handle tasks autonomously. Pass multiple tasks to run them in parallel " +
    "(only when they are independent; parallel coders must touch disjoint files). Each subagent starts " +
    "fresh: write detailed, self-contained briefs. Returns one TaskReport per task with a summary, " +
    "files touched, and stats.";
  schema = schema;

  constructor(ctx: ToolContext, private agentDeps: AgentDeps) {
    super(ctx);
  }

  protected describeCall(input: z.infer<typeof schema>): string {
    return input.tasks.map((t) => t.agent).join(", ");
  }

  protected async execute(input: z.infer<typeof schema>): Promise<string> {
    const results = await Promise.all(
      input.tasks.map(async (task) => {
        const subagent = createSubagent(task.agent as SubagentRole, this.agentDeps);
        try {
          return await subagent.run(task.description);
        } catch (err) {
          // run() reports its own errors; this guards the delegation itself.
          return {
            agentId: subagent.id,
            role: subagent.role,
            task: task.description,
            status: "error" as const,
            summary: "",
            filesTouched: [],
            toolCallCount: 0,
            tokens: { input: 0, output: 0 },
            durationMs: 0,
            error: (err as Error).message,
          };
        }
      })
    );
    return results.map(formatReport).join("\n\n---\n\n");
  }
}
