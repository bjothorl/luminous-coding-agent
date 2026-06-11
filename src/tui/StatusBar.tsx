import React from "react";
import { Box, Text } from "ink";
import { formatTokens } from "../session/usage.js";

export interface StatusInfo {
  activeAgents: number;
  tokens: number;
  baseURL: string;
  connected: boolean | undefined;
  busy: boolean;
}

export function StatusBar({ status }: { status: StatusInfo }) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text dimColor>
        {status.activeAgents} agent{status.activeAgents === 1 ? "" : "s"} active {"\u2502"}{" "}
        {"\u25B2"} {formatTokens(status.tokens)} tok {"\u2502"} {status.baseURL}{" "}
        {status.connected === undefined ? (
          <Text color="yellow">{"\u25CF"}</Text>
        ) : status.connected ? (
          <Text color="green">{"\u25CF"}</Text>
        ) : (
          <Text color="red">{"\u25CF"}</Text>
        )}
      </Text>
      <Text dimColor>
        {status.busy ? "esc to cancel" : "\u2191\u2193 PgUp/Dn scroll \u00B7 End latest \u00B7 /help"}
      </Text>
    </Box>
  );
}
