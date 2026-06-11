import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

/**
 * Converts unexpected tool-execution failures into ToolMessages so the model
 * can read the error and self-correct instead of crashing the agent run.
 * (LuminousTool already catches its own execution errors; this covers
 * everything else, e.g. schema-adjacent runtime failures.)
 */
export const toolErrorMiddleware = createMiddleware({
  name: "ToolErrorHandler",
  wrapToolCall: async (request, handler) => {
    try {
      return await handler(request);
    } catch (error) {
      return new ToolMessage({
        content: `Tool error: ${(error as Error).message}. Check your input and try again.`,
        tool_call_id: request.toolCall.id ?? "unknown",
      });
    }
  },
});
