import fs from "node:fs";
import * as z from "zod";
import { LuminousTool } from "./base.js";

const schema = z.object({
  path: z.string().describe("Absolute or project-relative path of the file to modify"),
  old_string: z.string().describe("The exact text to replace (must match the file contents exactly, including whitespace)"),
  new_string: z.string().describe("The replacement text (must differ from old_string)"),
  replace_all: z.boolean().optional().describe("Replace every occurrence of old_string (default false)"),
});

export class StrReplaceTool extends LuminousTool<typeof schema> {
  name = "StrReplace";
  description =
    "Performs an exact string replacement in a file. The edit FAILS if old_string is not found, or if it is " +
    "not unique in the file (provide more surrounding context to disambiguate, or set replace_all to true). " +
    "Preserve exact indentation. To create a new file use the Write tool instead.";
  schema = schema;

  protected describeCall(input: z.infer<typeof schema>): string {
    return input.path;
  }

  protected async execute(input: z.infer<typeof schema>): Promise<string> {
    const file = this.resolvePath(input.path);
    if (!fs.existsSync(file)) {
      return `Error: file does not exist: ${input.path}. Use the Write tool to create new files.`;
    }
    if (input.old_string === input.new_string) {
      return "Error: old_string and new_string are identical.";
    }

    const conflictOwner = this.ctx.claims.claim(file, this.ctx.agentId);
    if (conflictOwner) {
      return `Error: ${input.path} is currently claimed by agent ${conflictOwner}. Work on a different file or report the conflict.`;
    }

    if (!this.isInsideProject(file)) {
      const ok = await this.ctx.approvals.require("write", `edit ${file}`, `write:${file}`, this.ctx.agentId);
      if (!ok) return `Error: user denied editing file outside the project root: ${input.path}`;
    }

    const before = fs.readFileSync(file, "utf8");
    const occurrences = before.split(input.old_string).length - 1;
    if (occurrences === 0) {
      return `Error: old_string not found in ${input.path}. Re-read the file and match the contents exactly.`;
    }
    if (occurrences > 1 && !input.replace_all) {
      return `Error: old_string occurs ${occurrences} times in ${input.path}. Provide a larger unique string or set replace_all to true.`;
    }

    const after = input.replace_all
      ? before.split(input.old_string).join(input.new_string)
      : before.replace(input.old_string, input.new_string);
    fs.writeFileSync(file, after);

    this.ctx.tracker.filesTouched.add(file);
    this.ctx.bus.emit({ type: "file:edit", agentId: this.ctx.agentId, path: file, before, after });
    return `Edited ${input.path} (${occurrences} replacement${occurrences === 1 ? "" : "s"}).`;
  }
}
