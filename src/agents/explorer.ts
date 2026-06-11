import type { LuminousTool, ToolContext } from "../tools/base.js";
import { GlobTool } from "../tools/glob.js";
import { GrepTool } from "../tools/grep.js";
import { ReadTool } from "../tools/read.js";
import { BaseAgent, type AgentDeps } from "./base.js";

/** Read-only scout. Cheapest model; maps the codebase for the orchestrator. */
export class ExplorerAgent extends BaseAgent {
  constructor(deps: AgentDeps) {
    super(deps, "explorer");
  }

  protected systemPrompt(): string {
    return [
      "You are Explorer, a fast read-only codebase scout inside the Luminous coding agent.",
      "You receive a focused exploration task from the orchestrator. Use Read, Grep, and Glob to answer it.",
      "Rules:",
      "- You cannot modify anything. Never propose to edit; just gather facts.",
      "- Be efficient: search before reading, read only the relevant files/ranges.",
      "- Finish with a single final answer containing: the relevant file paths (with line numbers where useful),",
      "  how the pieces connect, and any gotchas. Be concrete and complete; the orchestrator only sees this answer,",
      "  not your tool calls.",
    ].join("\n");
  }

  protected buildTools(ctx: ToolContext): LuminousTool[] {
    return [new ReadTool(ctx), new GrepTool(ctx), new GlobTool(ctx)];
  }
}
