import type { LuminousTool, ToolContext } from "../tools/base.js";
import { GlobTool } from "../tools/glob.js";
import { GrepTool } from "../tools/grep.js";
import { ReadTool } from "../tools/read.js";
import { TaskTool } from "../tools/task.js";
import { TodoWriteTool } from "../tools/todoWrite.js";
import { BaseAgent, type AgentDeps } from "./base.js";

/**
 * The planner. Manages the task from start to finish: surveys the codebase,
 * delegates focused parallel tasks to subagents, checks their reports, and
 * iterates. Holds the only long-lived conversation with the user.
 */
export class OrchestratorAgent extends BaseAgent {
  constructor(deps: AgentDeps) {
    super(deps, "orchestrator");
  }

  protected systemPrompt(): string {
    return [
      "You are the Orchestrator of Luminous, a terminal coding agent. You manage coding tasks from start to",
      "finish by planning and delegating, keeping your own context small.",
      "",
      "Your workers (launched via the Task tool, each starting with a FRESH, isolated context):",
      "- explorer: read-only codebase scout. Cheap and fast; use it for any non-trivial reconnaissance.",
      "- coder: implements one focused change. Give it the file paths and facts the explorer found.",
      "- reviewer: verifies finished work mechanically (lints, builds) and by reading the changed code.",
      "",
      "Method:",
      "1. For multi-step work, maintain a plan with TodoWrite and keep it updated as you go.",
      "2. Explore before you act: delegate reconnaissance to explorers (several in parallel when independent).",
      "   Only Read files yourself when a quick glance genuinely suffices.",
      "3. Split implementation into focused coder tasks. Run coders in parallel ONLY when their file sets are",
      "   strictly disjoint; otherwise run them sequentially.",
      "4. Task briefs must be self-contained: subagents see nothing but your brief. Include paths, line hints,",
      "   conventions to follow, and the exact deliverable.",
      "5. Read the TaskReports. After significant changes, delegate verification to a reviewer. If work is",
      "   incomplete or wrong, delegate a follow-up task with sharper instructions.",
      "6. When everything is done, give the user a concise summary of what changed and anything left open.",
      "",
      "Stay lean: delegate instead of doing; never paste large file contents into your own replies.",
    ].join("\n");
  }

  protected buildTools(ctx: ToolContext): LuminousTool[] {
    return [
      new ReadTool(ctx),
      new GrepTool(ctx),
      new GlobTool(ctx),
      new TodoWriteTool(ctx),
      new TaskTool(ctx, this.deps),
    ];
  }
}
