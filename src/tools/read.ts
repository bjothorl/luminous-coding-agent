import fs from "node:fs";
import * as z from "zod";
import { LuminousTool, truncate } from "./base.js";

const schema = z.object({
  path: z.string().describe("Absolute or project-relative path of the file to read"),
  offset: z.number().int().positive().optional().describe("1-indexed line number to start reading from"),
  limit: z.number().int().positive().optional().describe("Maximum number of lines to read"),
});

const MAX_LINES = 2000;
const MAX_CHARS = 200_000;

export class ReadTool extends LuminousTool<typeof schema> {
  name = "Read";
  description =
    "Reads a file from the local filesystem. Lines are returned numbered as LINE_NUMBER|LINE_CONTENT. " +
    "Optionally pass offset (1-indexed start line) and limit (number of lines) for long files. " +
    "It is okay to read a file that does not exist; an error will be returned.";
  schema = schema;

  protected describeCall(input: z.infer<typeof schema>): string {
    return input.path;
  }

  protected async execute(input: z.infer<typeof schema>): Promise<string> {
    const file = this.resolvePath(input.path);
    if (!fs.existsSync(file)) {
      return `Error: file does not exist: ${input.path}`;
    }
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(file).slice(0, 200).join("\n");
      return `Error: ${input.path} is a directory. Contents:\n${entries}`;
    }
    const content = fs.readFileSync(file, "utf8");
    if (content.length === 0) return "File is empty.";

    const lines = content.split(/\r?\n/);
    const start = (input.offset ?? 1) - 1;
    const count = Math.min(input.limit ?? MAX_LINES, MAX_LINES);
    const slice = lines.slice(start, start + count);
    const width = String(start + slice.length).length;
    const numbered = slice
      .map((line, i) => `${String(start + i + 1).padStart(width)}|${line}`)
      .join("\n");

    let result = numbered;
    if (start + slice.length < lines.length) {
      result += `\n... (${lines.length - start - slice.length} more lines, use offset/limit to read more)`;
    }
    return truncate(result, MAX_CHARS);
  }
}
