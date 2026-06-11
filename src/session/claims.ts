import path from "node:path";

/**
 * Soft write-lock registry. Parallel coders must work on disjoint file sets;
 * a write to a file claimed by another live agent fails with a clear error
 * the model can act on.
 */
export class FileClaimRegistry {
  private claims = new Map<string, string>();

  /** Returns undefined on success, or the id of the conflicting agent. */
  claim(filePath: string, agentId: string): string | undefined {
    const key = path.resolve(filePath).toLowerCase();
    const owner = this.claims.get(key);
    if (owner !== undefined && owner !== agentId) {
      return owner;
    }
    this.claims.set(key, agentId);
    return undefined;
  }

  releaseAll(agentId: string): void {
    for (const [key, owner] of this.claims) {
      if (owner === agentId) this.claims.delete(key);
    }
  }
}
