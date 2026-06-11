import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { formatTokens } from "../session/usage.js";
import type { AgentRuntimeState } from "../session/events.js";

export interface AgentView {
  id: string;
  role: string;
  model: string;
  state: AgentRuntimeState;
  detail: string;
  tokens: number;
  startedAt: number;
  endedAt?: number;
}

function glyphFor(state: AgentRuntimeState): React.ReactNode {
  switch (state) {
    case "running":
      return (
        <Text color="green">
          <Spinner type="dots" />
        </Text>
      );
    case "done":
      return <Text color="green">{"\u2713"}</Text>;
    case "error":
      return <Text color="red">{"\u2717"}</Text>;
    default:
      return <Text dimColor>{"\u25CB"}</Text>;
  }
}

function elapsed(agent: AgentView): string {
  const end = agent.endedAt ?? Date.now();
  const secs = Math.max(0, Math.round((end - agent.startedAt) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

const MAX_AGENTS = 8;

export function AgentStatus({ agents }: { agents: AgentView[] }) {
  const shown = agents.slice(-MAX_AGENTS);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold dimColor>
        AGENTS
      </Text>
      {shown.length === 0 && <Text dimColor>(idle)</Text>}
      {shown.map((agent) => (
        <Box key={agent.id} flexDirection="column">
          <Box>
            {glyphFor(agent.state)}
            <Text bold> {agent.id}</Text>
            <Text dimColor> {elapsed(agent)}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {"  "}
            {agent.model} {"\u00B7"} {formatTokens(agent.tokens)} tok
          </Text>
          {agent.state === "running" && agent.detail.length > 0 && (
            <Text color="blue" wrap="truncate-end">
              {"  \u2514 "}
              {agent.detail}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
