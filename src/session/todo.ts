import type { TodoItem } from "../types.js";
import type { SessionBus } from "./events.js";

const STATUS_GLYPH: Record<TodoItem["status"], string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  cancelled: "[-]",
};

/** Session-wide task list, written by the TodoWrite tool. */
export class TodoStore {
  private todos: TodoItem[] = [];

  constructor(private bus: SessionBus) {}

  list(): TodoItem[] {
    return [...this.todos];
  }

  update(items: TodoItem[], merge: boolean): TodoItem[] {
    if (merge) {
      for (const item of items) {
        const existing = this.todos.find((t) => t.id === item.id);
        if (existing) {
          existing.content = item.content ?? existing.content;
          existing.status = item.status ?? existing.status;
        } else {
          this.todos.push(item);
        }
      }
    } else {
      this.todos = [...items];
    }
    this.bus.emit({ type: "todo:update", todos: this.list() });
    return this.list();
  }

  render(): string {
    if (this.todos.length === 0) return "(todo list is empty)";
    return this.todos.map((t) => `${STATUS_GLYPH[t.status]} ${t.content} (id: ${t.id})`).join("\n");
  }
}
