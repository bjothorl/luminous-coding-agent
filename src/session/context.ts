import type { BaseMessage } from "@langchain/core/messages";

function blockText(block: unknown): string {
  if (typeof block === "string") return block;
  if (!block || typeof block !== "object") return "";
  const b = block as Record<string, unknown>;
  if (b.type === "text" && typeof b.text === "string") return b.text;
  if (b.type === "image_url") return "[image]";
  return JSON.stringify(block);
}

function messageText(message: BaseMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(blockText).join("");
  if (content != null) return JSON.stringify(content);
  return "";
}

/**
 * Rough token estimate for the prompt context (~4 chars per token).
 * Used to watch context growth; exact counts depend on the model tokenizer.
 */
export function estimateContextTokens(messages: BaseMessage[], systemPrompt = ""): number {
  let chars = systemPrompt.length;
  for (const message of messages) {
    chars += messageText(message).length;
    const toolCalls = (message as { tool_calls?: unknown[] }).tool_calls;
    if (toolCalls?.length) chars += JSON.stringify(toolCalls).length;
  }
  return Math.max(0, Math.ceil(chars / 4));
}
