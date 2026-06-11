export interface DiffLine {
  kind: "context" | "add" | "remove";
  lineNo: number;
  text: string;
}

/**
 * Minimal line diff for the preview pane: trims the common prefix/suffix and
 * renders the changed middle with one line of context on each side.
 */
export function computeDiff(before: string, after: string, maxLines = 14): DiffLine[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const lines: DiffLine[] = [];
  if (start > 0) {
    lines.push({ kind: "context", lineNo: start, text: a[start - 1] });
  }
  for (let i = start; i < endA; i++) {
    lines.push({ kind: "remove", lineNo: i + 1, text: a[i] });
  }
  for (let i = start; i < endB; i++) {
    lines.push({ kind: "add", lineNo: i + 1, text: b[i] });
  }
  if (endA < a.length) {
    lines.push({ kind: "context", lineNo: endA + 1, text: a[endA] });
  }

  if (lines.length > maxLines) {
    const shown = lines.slice(0, maxLines);
    shown.push({ kind: "context", lineNo: 0, text: `... (${lines.length - maxLines} more diff lines)` });
    return shown;
  }
  return lines;
}
