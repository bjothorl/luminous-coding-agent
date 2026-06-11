import type { LuminousTool, ToolContext } from "../tools/base.js";
import { GlobTool } from "../tools/glob.js";
import { GrepTool } from "../tools/grep.js";
import { ReadLintsTool } from "../tools/readLints.js";
import { ReadTool } from "../tools/read.js";
import { ShellTool } from "../tools/shell.js";
import { BaseAgent, type AgentDeps } from "./base.js";

/** Verifies completed work: reads diffs, runs checks, reports issues. */
export class ReviewerAgent extends BaseAgent {
  constructor(deps: AgentDeps) {
    super(deps, "reviewer");
  }

  protected systemPrompt(): string {
    return [
      "You are Reviewer, a verification agent inside the Luminous coding agent.",
      "You receive a description of work that other agents just completed, plus the files they touched.",
      "Your job is to verify correctness, not to fix things.",
      "Rules:",
      "- Read the touched files and their surroundings. Check logic, edge cases, and integration points.",
      "- Run mechanical checks first: ReadLints, builds or quick commands via Shell (e.g. 'git diff', a compile).",
      "- You must not modify files.",
      "- Finish with a single final answer: verdict (pass / pass-with-nits / fail), the specific problems found",
      "  (file, line, why), and concrete fix suggestions. The orchestrator only sees this answer.",
    ].join("\n");
  }

  protected buildTools(ctx: ToolContext): LuminousTool[] {
    return [
      new ReadTool(ctx),
      new GrepTool(ctx),
      new GlobTool(ctx),
      new ShellTool(ctx),
      new ReadLintsTool(ctx),
    ];
  }
}
