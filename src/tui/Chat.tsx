import React from "react";
import { Box, Text } from "ink";

export interface ChatItem {
  id: number;
  kind: "user" | "assistant" | "tool" | "subagent" | "info" | "error";
  label?: string;
  text: string;
  ok?: boolean;
}

const STREAMING_ID = -1;

type InkColor = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white";

export interface DisplayLine {
  text: string;
  color?: InkColor;
  bold?: boolean;
  dimColor?: boolean;
}

/** Greedy word wrap (mirrors Ink's wrap-ansi behaviour closely enough to budget lines). */
function wrapLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) return [line];
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    const sep = current.length > 0 ? 1 : 0;
    if (current.length + sep + word.length <= width) {
      current += (sep ? " " : "") + word;
      continue;
    }
    if (current.length > 0) out.push(current);
    let rest = word;
    while (rest.length > width) {
      out.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    current = rest;
  }
  out.push(current);
  return out;
}

function wrapText(text: string, width: number): string[] {
  return text.split("\n").flatMap((line) => (line.length === 0 ? [""] : wrapLine(line, width)));
}

/** Ink collapses zero-width Text nodes; preserve intentional blank rows. */
function renderLineText(text: string): string {
  return text.length === 0 ? " " : text;
}

function pushWrapped(lines: DisplayLine[], text: string, width: number, style: Omit<DisplayLine, "text">) {
  for (const line of wrapText(text, width)) {
    lines.push({ text: line, ...style });
  }
}

function itemToLines(item: ChatItem, width: number): DisplayLine[] {
  const lines: DisplayLine[] = [];
  switch (item.kind) {
    case "user":
      lines.push({ text: " " });
      lines.push({ text: "\u276F you", color: "cyan", bold: true });
      pushWrapped(lines, item.text, width, {});
      break;
    case "assistant":
      lines.push({ text: " " });
      lines.push({ text: "\u2726 orchestrator", color: "magenta", bold: true });
      pushWrapped(lines, item.text, width, {});
      break;
    case "tool": {
      const mark = item.ok === false ? "\u2717" : "\u2192";
      pushWrapped(lines, `  ${mark} ${item.label} ${item.text}`, width, { dimColor: true });
      break;
    }
    case "subagent":
      pushWrapped(lines, `\u251C\u2500 ${item.label} ${item.text}`, width, { color: "yellow" });
      break;
    case "error":
      pushWrapped(lines, item.text, width, { color: "red" });
      break;
    default:
      pushWrapped(lines, item.text, width, { dimColor: true });
      break;
  }
  return lines;
}

/** Flatten chat items into terminal rows at the given text width. */
export function buildChatLines(items: ChatItem[], width: number): DisplayLine[] {
  const w = Math.max(20, width);
  return items.flatMap((item) => itemToLines(item, w));
}

function withStreaming(items: ChatItem[], streamingText: string): ChatItem[] {
  if (streamingText.length === 0) return items;
  return [...items, { id: STREAMING_ID, kind: "assistant", text: streamingText }];
}

export function countChatLines(items: ChatItem[], streamingText: string, width: number): number {
  return buildChatLines(withStreaming(items, streamingText), width).length;
}

interface SliceResult {
  visible: DisplayLine[];
  hiddenAbove: number;
  hiddenBelow: number;
  showTopBar: boolean;
  showBottomBar: boolean;
}

/** View a window of `height` lines, scrolled `scrollBack` lines up from the bottom. */
function sliceLines(lines: DisplayLine[], height: number, scrollBack: number): SliceResult {
  const viewport = Math.max(1, height);
  const total = lines.length;
  const maxScrollBack = Math.max(0, total - viewport);
  const back = Math.max(0, Math.min(scrollBack, maxScrollBack));
  const end = total - back;
  const showBottomBar = back > 0;

  let chrome = showBottomBar ? 1 : 0;
  let contentHeight = viewport - chrome;
  let start = Math.max(0, end - contentHeight);
  // When pinned to the latest, use the full viewport for content (no top chrome).
  const showTopBar = back > 0 && start > 0;
  if (showTopBar) {
    contentHeight -= 1;
    start = Math.max(0, end - contentHeight);
  }

  return {
    visible: lines.slice(start, end),
    hiddenAbove: start,
    hiddenBelow: back,
    showTopBar,
    showBottomBar,
  };
}

export interface ChatProps {
  items: ChatItem[];
  streamingText: string;
  height: number;
  width: number;
  /** Lines scrolled up from the bottom (0 = pinned to latest). */
  scrollBack: number;
}

export function Chat({ items, streamingText, height, width, scrollBack }: ChatProps) {
  const lines = buildChatLines(withStreaming(items, streamingText), width);
  const { visible, hiddenAbove, hiddenBelow, showTopBar, showBottomBar } = sliceLines(
    lines,
    height,
    scrollBack
  );
  const pinBottom = scrollBack === 0;

  return (
    <Box flexDirection="column" height={height} flexGrow={1} paddingX={1} overflow="hidden">
      {showTopBar && (
        <Text dimColor>
          {"\u2191"} {hiddenAbove} more {hiddenAbove === 1 ? "line" : "lines"} above
        </Text>
      )}
      <Box
        flexDirection="column"
        flexGrow={1}
        justifyContent={pinBottom ? "flex-end" : "flex-start"}
        overflow="hidden"
      >
        {visible.map((line, i) => (
          <Text key={i} color={line.color} bold={line.bold} dimColor={line.dimColor}>
            {renderLineText(line.text)}
          </Text>
        ))}
      </Box>
      {showBottomBar && (
        <Text dimColor>
          {"\u2193"} {hiddenBelow} more {hiddenBelow === 1 ? "line" : "lines"} below {"\u00B7"} End for latest
        </Text>
      )}
    </Box>
  );
}
