import fs from "node:fs";
import path from "node:path";
import type { ApprovalKind, SessionBus } from "./events.js";

export type ApprovalMode = "interactive" | "auto";

/**
 * Gates dangerous operations (shell commands, writes outside the project
 * root) behind TUI approval. "Always allow" decisions are persisted per
 * project in .luminous/approvals.json.
 */
export class ApprovalService {
  private allowlist: Set<string>;

  constructor(
    private bus: SessionBus,
    private cwd: string,
    private mode: ApprovalMode
  ) {
    this.allowlist = new Set(this.loadAllowlist());
  }

  private get allowlistPath(): string {
    return path.join(this.cwd, ".luminous", "approvals.json");
  }

  private loadAllowlist(): string[] {
    try {
      if (fs.existsSync(this.allowlistPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.allowlistPath, "utf8"));
        if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
      }
    } catch {
      // Corrupt allowlist is not fatal; start fresh.
    }
    return [];
  }

  private persistAllowlist(): void {
    try {
      fs.mkdirSync(path.dirname(this.allowlistPath), { recursive: true });
      fs.writeFileSync(this.allowlistPath, JSON.stringify([...this.allowlist], null, 2));
    } catch {
      // Persistence failure should not block the session.
    }
  }

  /** Resolves true when the operation may proceed. */
  async require(kind: ApprovalKind, detail: string, allowKey: string, agentId: string): Promise<boolean> {
    if (this.mode === "auto") return true;
    if (this.allowlist.has(allowKey)) return true;

    const decision = await this.bus.requestApproval({ kind, detail, allowKey, agentId });
    if (decision === "always") {
      this.allowlist.add(allowKey);
      this.persistAllowlist();
      return true;
    }
    return decision === "allow";
  }
}
