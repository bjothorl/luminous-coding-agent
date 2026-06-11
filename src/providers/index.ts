import { ChatOpenAI } from "@langchain/openai";
import type { ResolvedModelConfig } from "../config/index.js";

/**
 * Builds a ChatOpenAI instance pointed at an OpenAI-compatible endpoint
 * (llama.cpp `llama-server`, vLLM, LM Studio, or the real OpenAI API).
 */
export function createChatModel(cfg: ResolvedModelConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: cfg.model,
    temperature: cfg.temperature,
    apiKey: cfg.apiKey,
    configuration: {
      baseURL: cfg.baseURL,
    },
  });
}

export interface ConnectivityResult {
  ok: boolean;
  models: string[];
  error?: string;
}

/** Smoke-test the server by listing /v1/models. */
export async function checkConnectivity(baseURL: string, apiKey: string): Promise<ConnectivityResult> {
  try {
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, models: [], error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: (err as Error).message };
  }
}
