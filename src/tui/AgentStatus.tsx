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
  /** Estimated prompt context size (history + tools + system). */
  contextTokens: number;
  /** Cumulative API tokens consumed this run. */
  tokens: number;
  startedAt: number;
  endedAt?: number;
}

export interface AgentStatusProps {
  orchestratorId: string;
  orchestratorModel: string;
  /** Context estimate when the orchestrator is idle (not in the agent map). */
  orchestratorContextTokens: number;
  agents: AgentView[];
  busy: boolean;
  height: number;
  /** Lines scrolled down from the top of the subagent list (0 = pinned to start). */
  scrollBack: number;
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

export function agentLineCount(agent: AgentView): number {
  let lines = 2;
  if (agent.state === "running" && agent.detail.length > 0) lines += 1;
  return lines;
}

export function countSubagentLines(agents: AgentView[], orchestratorId: string): number {
  return agents
    .filter((a) => a.id !== orchestratorId)
    .reduce((sum, agent) => sum + agentLineCount(agent), 0);
}

function resolveOrchestrator(
  orchestratorId: string,
  orchestratorModel: string,
  orchestratorContextTokens: number,
  agents: AgentView[],
  busy: boolean
): AgentView {
  const existing = agents.find((a) => a.id === orchestratorId);
  if (existing) return existing;
  return {
    id: orchestratorId,
    role: "orchestrator",
    model: orchestratorModel,
    state: busy ? "running" : "queued",
    detail: busy ? "thinking..." : "",
    contextTokens: orchestratorContextTokens,
    tokens: 0,
    startedAt: Date.now(),
  };
}

interface SliceResult {
  start: number;
  end: number;
  hiddenAbove: number;
  hiddenBelow: number;
  showTopBar: boolean;
  showBottomBar: boolean;
}

/** View a window of `height` lines, scrolled `scrollBack` lines down from the top. */
function sliceLineRange(total: number, height: number, scrollBack: number): SliceResult {
  const viewport = Math.max(1, height);
  const maxScrollBack = Math.max(0, total - viewport);
  const back = Math.max(0, Math.min(scrollBack, maxScrollBack));
  const start = back;
  const showTopBar = back > 0;

  let chrome = showTopBar ? 1 : 0;
  let contentHeight = viewport - chrome;
  let end = Math.min(total, start + contentHeight);
  const showBottomBar = end < total;
  if (showBottomBar) {
    contentHeight -= 1;
    end = Math.min(total, start + contentHeight);
  }

  return { start, end, hiddenAbove: back, hiddenBelow: total - end, showTopBar, showBottomBar };
}

function AgentRow({ agent }: { agent: AgentView }) {
  return (
    <Box flexDirection="column">
      <Box>
        {glyphFor(agent.state)}
        <Text bold> {agent.id}</Text>
        <Text dimColor> {elapsed(agent)}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">
        {"  "}
        {agent.model} {"\u00B7"} {formatTokens(agent.contextTokens)} ctx {"\u00B7"}{" "}
        {formatTokens(agent.tokens)} used
      </Text>
      {agent.state === "running" && agent.detail.length > 0 && (
        <Text color="blue" wrap="truncate-end">
          {"  \u2514 "}
          {agent.detail}
        </Text>
      )}
    </Box>
  );
}

function SubagentScroll({
  agents,
  height,
  scrollBack,
}: {
  agents: AgentView[];
  height: number;
  scrollBack: number;
}) {
  if (agents.length === 0) {
    return <Text dimColor>(no subagents)</Text>;
  }

  const lineOwners: AgentView[] = [];
  for (const agent of agents) {
    for (let i = 0; i < agentLineCount(agent); i++) lineOwners.push(agent);
  }

  const total = lineOwners.length;
  const { start, end, hiddenAbove, hiddenBelow, showTopBar, showBottomBar } = sliceLineRange(
    total,
    height,
    scrollBack
  );
  const visibleAgents: AgentView[] = [];
  const seen = new Set<string>();
  for (let i = start; i < end; i++) {
    const agent = lineOwners[i]!;
    if (!seen.has(agent.id)) {
      seen.add(agent.id);
      visibleAgents.push(agent);
    }
  }

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {showTopBar && (
        <Text dimColor>
          {"\u2191"} {hiddenAbove} more {hiddenAbove === 1 ? "line" : "lines"} above
        </Text>
      )}
      <Box flexDirection="column" flexGrow={1} justifyContent="flex-start" overflow="hidden">
        {visibleAgents.map((agent) => (
          <AgentRow key={agent.id} agent={agent} />
        ))}
      </Box>
      {showBottomBar && (
        <Text dimColor>
          {"\u2193"} {hiddenBelow} more {hiddenBelow === 1 ? "line" : "lines"} below {"\u00B7"} Shift+End
          for latest
        </Text>
      )}
    </Box>
  );
}

export function AgentStatus({
  orchestratorId,
  orchestratorModel,
  orchestratorContextTokens,
  agents,
  busy,
  height,
  scrollBack,
}: AgentStatusProps) {
  const orchestrator = resolveOrchestrator(
    orchestratorId,
    orchestratorModel,
    orchestratorContextTokens,
    agents,
    busy
  );
  const subagents = agents
    .filter((a) => a.id !== orchestratorId)
    .sort((a, b) => a.startedAt - b.startedAt);

  const headerLines = 1;
  const orchestratorLines = agentLineCount(orchestrator);
  const subHeaderLines = 1;
  const subagentHeight = Math.max(
    1,
    height - headerLines - orchestratorLines - (subagents.length > 0 ? subHeaderLines : 0)
  );

  return (
    <Box flexDirection="column" height={height} paddingX={1} overflow="hidden">
      <Text bold dimColor>
        AGENTS
      </Text>
      <AgentRow agent={orchestrator} />
      {subagents.length > 0 && (
        <>
          <Text dimColor>subagents</Text>
          <SubagentScroll agents={subagents} height={subagentHeight} scrollBack={scrollBack} />
        </>
      )}
    </Box>
  );
}
