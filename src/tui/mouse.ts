import process from "node:process";
import { PassThrough } from "node:stream";

/**
 * Terminal mouse support for the TUI.
 *
 * Enables SGR mouse reporting (so the terminal sends wheel events to us
 * instead of scrolling its own buffer) and wraps stdin so that mouse escape
 * sequences are stripped before Ink sees them -- otherwise they would leak
 * into the text input as garbage characters. Wheel events are surfaced
 * through a small subscription API.
 */

const MOUSE_ON = "\u001b[?1000h\u001b[?1006h";
const MOUSE_OFF = "\u001b[?1006l\u001b[?1000l";

/** SGR mouse sequence: ESC [ < button ; col ; row (M|m) */
const MOUSE_SEQ = /\u001b\[<(\d+);\d+;\d+([Mm])/g;
/** An incomplete SGR mouse sequence at the end of a chunk. */
const PARTIAL_MOUSE_SEQ = /\u001b\[<[\d;]*$/;

const WHEEL_UP = 64;
const WHEEL_DOWN = 65;

export interface MouseInput {
  /** Stdin-compatible stream with mouse sequences filtered out. Pass to Ink's render(). */
  stdin: NodeJS.ReadStream;
  /** Subscribe to wheel events. delta is +1 (scroll up / back) or -1 (scroll down). */
  onWheel(listener: (delta: 1 | -1) => void): () => void;
  /** Stop mouse reporting and detach from process.stdin. */
  dispose(): void;
}

export function createMouseInput(stdout: NodeJS.WriteStream): MouseInput {
  const filtered = new PassThrough();
  const listeners = new Set<(delta: 1 | -1) => void>();
  let carry = "";

  // Ink expects a TTY-ish ReadStream: it checks isTTY and calls
  // setRawMode/ref/unref. Delegate those to the real stdin.
  const wrapped = filtered as unknown as NodeJS.ReadStream;
  wrapped.isTTY = process.stdin.isTTY;
  wrapped.setRawMode = (mode: boolean) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(mode);
    return wrapped;
  };
  wrapped.ref = () => {
    process.stdin.ref();
    return wrapped;
  };
  wrapped.unref = () => {
    process.stdin.unref();
    return wrapped;
  };

  const emitWheel = (delta: 1 | -1) => {
    for (const listener of listeners) listener(delta);
  };

  const onData = (data: Buffer | string) => {
    let text = carry + data.toString();
    carry = "";

    // Hold back a trailing incomplete mouse sequence until the next chunk.
    const partial = PARTIAL_MOUSE_SEQ.exec(text);
    if (partial) {
      carry = partial[0];
      text = text.slice(0, partial.index);
    }

    let rest = "";
    let last = 0;
    MOUSE_SEQ.lastIndex = 0;
    for (const match of text.matchAll(MOUSE_SEQ)) {
      rest += text.slice(last, match.index);
      last = match.index + match[0].length;
      const button = Number(match[1]);
      // Some terminals (incl. Windows Terminal) report wheel on release (m) not press (M).
      if (button === WHEEL_UP) emitWheel(1);
      else if (button === WHEEL_DOWN) emitWheel(-1);
      // Other mouse events (clicks, drags) are swallowed.
    }
    rest += text.slice(last);
    if (rest.length > 0) filtered.write(rest);
  };

  process.stdin.on("data", onData);
  stdout.write(MOUSE_ON);
  let disposed = false;

  return {
    stdin: wrapped,
    onWheel(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stdout.write(MOUSE_OFF);
      process.stdin.off("data", onData);
      listeners.clear();
    },
  };
}
