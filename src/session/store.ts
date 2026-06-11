import fs from "node:fs";
import path from "node:path";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

/** Persists the top-level chat transcript so sessions can be resumed. */
export class SessionStore {
  private entries: TranscriptEntry[] = [];
  private file: string;

  constructor(private cwd: string, resume: boolean) {
    const dir = path.join(cwd, ".luminous", "sessions");
    fs.mkdirSync(dir, { recursive: true });

    if (resume) {
      const latest = this.findLatest(dir);
      if (latest) {
        this.file = latest;
        try {
          const parsed = JSON.parse(fs.readFileSync(latest, "utf8"));
          if (Array.isArray(parsed)) this.entries = parsed;
        } catch {
          this.entries = [];
        }
        return;
      }
    }
    this.file = path.join(dir, `session-${Date.now()}.json`);
  }

  private findLatest(dir: string): string | undefined {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
      .sort();
    const last = files[files.length - 1];
    return last ? path.join(dir, last) : undefined;
  }

  history(): TranscriptEntry[] {
    return [...this.entries];
  }

  append(entry: TranscriptEntry): void {
    this.entries.push(entry);
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.entries, null, 2));
    } catch {
      // Persistence failure should not break the session.
    }
  }

  clear(): void {
    this.entries = [];
    try {
      fs.writeFileSync(this.file, "[]");
    } catch {
      // ignore
    }
  }
}
