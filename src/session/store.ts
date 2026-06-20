import fs from "node:fs";
import path from "node:path";
import type { BaseMessage, StoredMessage } from "@langchain/core/messages";
import type { ChatItem } from "../tui/Chat.js";
import type { TodoItem } from "../types.js";
import type { BaseAgent } from "../agents/base.js";
import type { SessionBus } from "./events.js";
import { deserializeMessages, serializeMessages } from "./messages.js";

export interface SessionDocument {
  version: 1;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
  usage: { input: number; output: number };
  lastInputTokens: number;
  chat: Omit<ChatItem, "id">[];
  todos: TodoItem[];
}

export interface SessionSummary {
  filename: string;
  path: string;
  updatedAt: number;
  messageCount: number;
  usageTotal: number;
}

function emptyDocument(now = Date.now()): SessionDocument {
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    messages: [],
    usage: { input: 0, output: 0 },
    lastInputTokens: 0,
    chat: [],
    todos: [],
  };
}

function parseDocument(raw: unknown): SessionDocument | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const doc = raw as Partial<SessionDocument>;
  if (doc.version !== 1) return undefined;
  return {
    version: 1,
    createdAt: doc.createdAt ?? Date.now(),
    updatedAt: doc.updatedAt ?? Date.now(),
    messages: Array.isArray(doc.messages) ? doc.messages : [],
    usage: {
      input: doc.usage?.input ?? 0,
      output: doc.usage?.output ?? 0,
    },
    lastInputTokens: doc.lastInputTokens ?? 0,
    chat: Array.isArray(doc.chat) ? doc.chat : [],
    todos: Array.isArray(doc.todos) ? doc.todos : [],
  };
}

/** Persists orchestrator history, chat, usage, and todos for session resume. */
export class SessionStore {
  private doc: SessionDocument;
  private file: string;
  private orchestrator?: BaseAgent;

  constructor(
    private cwd: string,
    private bus: SessionBus,
    options: { resume?: boolean } = {}
  ) {
    const dir = this.sessionsDir();
    fs.mkdirSync(dir, { recursive: true });

    if (options.resume) {
      const latest = this.findLatestPath(dir);
      if (latest) {
        this.file = latest;
        this.doc = this.readFile(latest) ?? emptyDocument();
        this.wireBus();
        return;
      }
    }

    const now = Date.now();
    this.doc = emptyDocument(now);
    this.file = path.join(dir, `session-${now}.json`);
    this.flush();
    this.wireBus();
  }

  private sessionsDir(): string {
    return path.join(this.cwd, ".luminous", "sessions");
  }

  attachOrchestrator(agent: BaseAgent): void {
    this.orchestrator = agent;
  }

  private wireBus(): void {
    this.bus.on((event) => {
      switch (event.type) {
        case "agent:usage": {
          this.doc.usage.input += event.input;
          this.doc.usage.output += event.output;
          if (event.agentId === this.orchestrator?.id && event.input > 0) {
            this.doc.lastInputTokens = event.input;
          }
          this.flush();
          break;
        }
        case "agent:done": {
          if (event.report.role === "orchestrator" && this.orchestrator) {
            this.doc.messages = serializeMessages(this.orchestrator.getHistory());
            this.flush();
          }
          break;
        }
        case "todo:update": {
          this.doc.todos = [...event.todos];
          this.flush();
          break;
        }
        default:
          break;
      }
    });
  }

  private readFile(filePath: string): SessionDocument | undefined {
    try {
      return parseDocument(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch {
      return undefined;
    }
  }

  private findLatestPath(dir: string): string | undefined {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
      .sort();
    const last = files[files.length - 1];
    return last ? path.join(dir, last) : undefined;
  }

  private flush(): void {
    this.doc.updatedAt = Date.now();
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.doc, null, 2));
    } catch {
      // Persistence failure should not break the session.
    }
  }

  snapshot(): SessionDocument {
    return {
      ...this.doc,
      messages: [...this.doc.messages],
      usage: { ...this.doc.usage },
      chat: [...this.doc.chat],
      todos: [...this.doc.todos],
    };
  }

  chat(): Omit<ChatItem, "id">[] {
    return [...this.doc.chat];
  }

  setChat(chat: Omit<ChatItem, "id">[]): void {
    this.doc.chat = [...chat];
    this.flush();
  }

  appendChat(item: Omit<ChatItem, "id">): void {
    this.doc.chat.push(item);
    this.flush();
  }

  persistMessages(messages: BaseMessage[]): void {
    this.doc.messages = serializeMessages(messages);
    this.flush();
  }

  listSessions(): SessionSummary[] {
    const dir = this.sessionsDir();
    if (!fs.existsSync(dir)) return [];

    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
      .map((filename) => {
        const filePath = path.join(dir, filename);
        const doc = this.readFile(filePath) ?? emptyDocument();
        return {
          filename,
          path: filePath,
          updatedAt: doc.updatedAt,
          messageCount: doc.messages.length,
          usageTotal: doc.usage.input + doc.usage.output,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  resolveSessionFile(query: string): string | undefined {
    const dir = this.sessionsDir();
    const exact = path.join(dir, query);
    if (fs.existsSync(exact)) return exact;

    const suffix = query.endsWith(".json") ? query : `${query}.json`;
    const withSuffix = path.join(dir, suffix);
    if (fs.existsSync(withSuffix)) return withSuffix;

    const partial = this.listSessions().find((s) => s.filename.includes(query));
    return partial?.path;
  }

  loadSession(filePath: string): SessionDocument | undefined {
    const doc = this.readFile(filePath);
    if (!doc) return undefined;
    this.file = filePath;
    this.doc = doc;
    return this.snapshot();
  }

  clear(): void {
    const now = Date.now();
    this.doc = emptyDocument(now);
    this.file = path.join(this.sessionsDir(), `session-${now}.json`);
    this.flush();
  }
}
