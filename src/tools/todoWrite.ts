import * as z from "zod";
import { LuminousTool } from "./base.js";

const todoSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z.string().describe("Description of the todo item"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).describe("Current status"),
});

const schema = z.object({
  todos: z.array(todoSchema).describe("Array of todo items to create or update"),
  merge: z
    .boolean()
    .describe("If true, merge with existing todos by id. If false, replace the whole list."),
});

export class TodoWriteTool extends LuminousTool<typeof schema> {
  name = "TodoWrite";
  description =
    "Creates and manages a structured task list for the session. Use it to plan multi-step work and track " +
    "progress. Mark items in_progress when starting and completed immediately after finishing. " +
    "Use merge=true to update existing items by id, merge=false to replace the list.";
  schema = schema;

  protected describeCall(input: z.infer<typeof schema>): string {
    return `${input.todos.length} item${input.todos.length === 1 ? "" : "s"}`;
  }

  protected async execute(input: z.infer<typeof schema>): Promise<string> {
    this.ctx.todos.update(input.todos, input.merge);
    return `Todo list updated:\n${this.ctx.todos.render()}`;
  }
}
