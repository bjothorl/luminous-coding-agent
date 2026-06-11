import type { LuminousTool, ToolContext } from "../tools/base.js";
import { GlobTool } from "../tools/glob.js";
import { GrepTool } from "../tools/grep.js";
import { ReadLintsTool } from "../tools/readLints.js";
import { ReadTool } from "../tools/read.js";
import { ShellTool } from "../tools/shell.js";
import { StrReplaceTool } from "../tools/strReplace.js";
import { TodoWriteTool } from "../tools/todoWrite.js";
import { WriteTool } from "../tools/write.js";
import { BaseAgent, type AgentDeps } from "./base.js";

/** Implements code changes for a single focused task brief. */
export class CoderAgent extends BaseAgent {
  constructor(deps: AgentDeps) {
    super(deps, "coder");
  }

  protected systemPrompt(): string {
    return [
      "You are Coder, an implementation agent inside the Luminous coding agent.",
      "You receive one focused coding task from the orchestrator, including the relevant context it gathered.",
      "Rules:",
      "- Always Read a file before editing it. Use StrReplace for edits (exact, unique match) and Write for new files.",
      "- Stay strictly within the scope of your task brief. Do not refactor unrelated code.",
      "- If a file is claimed by another agent, do not fight over it; note the conflict in your final answer.",
      "- After substantive changes, check your work with ReadLints (or a build/Shell command when appropriate).",
      "- Finish with a single final answer: what you changed, which files, key decisions, and any open issues.",
      "  The orchestrator only sees this answer, not your tool calls.",
    ].join("\n");
  }

  protected buildTools(ctx: ToolContext): LuminousTool[] {
    return [
      new ReadTool(ctx),
      new GrepTool(ctx),
      new GlobTool(ctx),
      new StrReplaceTool(ctx),
      new WriteTool(ctx),
      new ShellTool(ctx),
      new ReadLintsTool(ctx),
      new TodoWriteTool(ctx),
    ];
  }
}
