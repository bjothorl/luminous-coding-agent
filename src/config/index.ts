import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as z from "zod";
import type { AgentRole } from "../types.js";

const AgentModelSchema = z.object({
  baseURL: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  temperature: z.number().optional(),
  maxSteps: z.number().int().positive().optional(),
});

const ConfigSchema = z.object({
  /** Default OpenAI-compatible endpoint (your llama.cpp server). */
  baseURL: z.string().default("http://localhost:8080/v1"),
  /** llama.cpp ignores the key but the OpenAI client requires one. */
  apiKey: z.string().default("sk-local"),
  /** Default model name (as exposed by the server's /v1/models). */
  model: z.string().default("default"),
  temperature: z.number().default(0.2),
  maxSteps: z.number().int().positive().default(80),
  /** Command run by the ReadLints tool. Auto-detected when omitted. */
  lintCommand: z.string().optional(),
  /** Per-role overrides so each agent can target its own model/server. */
  agents: z
    .object({
      orchestrator: AgentModelSchema.optional(),
      explorer: AgentModelSchema.optional(),
      coder: AgentModelSchema.optional(),
      reviewer: AgentModelSchema.optional(),
    })
    .default({}),
});

export type LuminousConfig = z.infer<typeof ConfigSchema>;

export interface ResolvedModelConfig {
  baseURL: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxSteps: number;
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly file?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

function readJsonIfExists(file: string): Record<string, unknown> | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const reason = e.code === "EACCES"
      ? "permission denied"
      : e instanceof SyntaxError
      ? "invalid JSON"
      : e.message;
    throw new ConfigError(
      `Cannot load config file: ${reason}\n  → ${file}`,
      file,
      err
    );
  }
}

function deepMerge(base: Record<string, any>, override: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof out[key] === "object" &&
      out[key] !== null &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function globalConfigPath(): string {
  return path.join(os.homedir(), ".luminous", "config.json");
}

export function projectConfigPath(cwd: string): string {
  return path.join(cwd, ".luminous", "config.json");
}

/**
 * Load ~/.luminous/config.json merged with <project>/.luminous/config.json.
 * When no apiKey is configured in either file, falls back to the
 * LUMINOUS_API_KEY or OPENAI_API_KEY environment variable.
 */
export function loadConfig(cwd: string): LuminousConfig {
  const globalCfg = readJsonIfExists(globalConfigPath()) ?? {};
  const projectCfg = readJsonIfExists(projectConfigPath(cwd)) ?? {};
  const merged = deepMerge(globalCfg, projectCfg);
  if (typeof merged.apiKey !== "string" || merged.apiKey.length === 0) {
    const envKey = process.env.LUMINOUS_API_KEY ?? process.env.OPENAI_API_KEY;
    if (envKey) merged.apiKey = envKey;
  }
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ConfigError(
      `Config validation failed:\n${issues}\n\nCheck ${globalConfigPath()} and ${projectConfigPath(cwd)}`
    );
  }
  return result.data;
}

export function resolveModelConfig(config: LuminousConfig, role: AgentRole): ResolvedModelConfig {
  const override = config.agents[role] ?? {};
  return {
    baseURL: override.baseURL ?? config.baseURL,
    model: override.model ?? config.model,
    apiKey: override.apiKey ?? config.apiKey,
    temperature: override.temperature ?? config.temperature,
    maxSteps: override.maxSteps ?? config.maxSteps,
  };
}
