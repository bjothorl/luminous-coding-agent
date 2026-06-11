import React from "react";
import path from "node:path";
import { Box, Text } from "ink";
import { computeDiff } from "./diff.js";

export interface EditView {
  path: string;
  before: string;
  after: string;
}

export function DiffView({ edit, cwd }: { edit: EditView | undefined; cwd: string }) {
  if (!edit) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold dimColor>
          DIFF
        </Text>
        <Text dimColor>(no edits yet)</Text>
      </Box>
    );
  }
  const rel = path.relative(cwd, edit.path) || edit.path;
  const lines = computeDiff(edit.before, edit.after);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold dimColor>
        DIFF <Text color="cyan">{rel}</Text>
      </Text>
      {lines.map((line, i) => (
        <Text
          key={i}
          color={line.kind === "add" ? "green" : line.kind === "remove" ? "red" : undefined}
          dimColor={line.kind === "context"}
          wrap="truncate-end"
        >
          {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
          {line.text}
        </Text>
      ))}
    </Box>
  );
}
