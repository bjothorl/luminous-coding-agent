import fs from "node:fs";
import path from "node:path";
import * as z from "zod";
import { LuminousTool } from "./base.js";

const schema = z.object({
  path: z.string().describe("Absolute or project-relative path of the file to write"),
  contents: z.string().describe("The full contents to write to the file"),
});

export class WriteTool extends LuminousTool<typeof schema> {
  name = "Write";
  description =
    "Writes a file to the local filesystem, creating parent directories as needed. " +
    "Overwrites the file if it already exists. Prefer StrReplace for editing existing files.";
  schema = schema;

  protected describeCall(input: z.infer<typeof schema>): string {
    return input.path;
  }

  protected async execute(input: z.infer<typeof schema>): Promise<string> {
    const file = this.resolvePath(input.path);

    const conflictOwner = this.ctx.claims.claim(file, this.ctx.agentId);
    if (conflictOwner) {
      return `Error: ${input.path} is currently claimed by agent ${conflictOwner}. Work on a different file or report the conflict.`;
    }

    if (!this.isInsideProject(file)) {
      const ok = await this.ctx.approvals.require("write", `write ${file}`, `write:${file}`, this.ctx.agentId);
      if (!ok) return `Error: user denied writing file outside the project root: ${input.path}`;
    }

    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, input.contents);

    this.ctx.tracker.filesTouched.add(file);
    this.ctx.bus.emit({ type: "file:edit", agentId: this.ctx.agentId, path: file, before, after: input.contents });
    return `Wrote ${input.contents.length} characters to ${input.path}.`;
  }
}
