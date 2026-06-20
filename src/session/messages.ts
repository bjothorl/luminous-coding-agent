import type { BaseMessage, StoredMessage } from "@langchain/core/messages";
import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages";

export function serializeMessages(messages: BaseMessage[]): StoredMessage[] {
  return mapChatMessagesToStoredMessages(messages);
}

export function deserializeMessages(stored: StoredMessage[]): BaseMessage[] {
  return mapStoredMessagesToChatMessages(stored);
}
