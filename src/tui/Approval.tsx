import React from "react";
import { Box, Text } from "ink";
import type { ApprovalRequest } from "../session/events.js";

export function Approval({ request }: { request: ApprovalRequest }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginX={1}>
      <Text color="yellow" bold>
        {"\u26A0"} approval needed {"\u00B7"} {request.agentId}
      </Text>
      <Text wrap="truncate-end">
        {request.kind === "shell" ? "run: " : "write: "}
        <Text bold>{request.detail}</Text>
      </Text>
      <Text dimColor>[y] allow once {"\u00B7"} [a] always allow {"\u00B7"} [n] deny</Text>
    </Box>
  );
}
