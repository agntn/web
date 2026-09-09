import { HTTPError } from "./errors.ts";

const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const MAX_EVENT_CHARACTERS = 1024 * 1024;

/**
 * Decode bounded JSON SSE frames, cancelling the reader on early return or abort.
 * @param stream - Response body.
 * @param url - Safe request URL for protocol errors.
 * @param signal - Cancellation for the entire stream.
 * @yields {unknown} Parsed JSON data events.
 * @returns {AsyncGenerator<unknown>} Parsed JSON data events.
 */
export async function* readSseJson(
  stream: Readonly<ReadableStream<Uint8Array>>,
  url: string,
  signal: Readonly<AbortSignal>,
): AsyncGenerator<unknown> {
  let data: string[] = [];
  let frameSize = 0;
  for await (const line of readLines(stream, url, signal)) {
    frameSize += line.length + 1;
    if (frameSize > MAX_EVENT_CHARACTERS) throw streamError(url, "event exceeds 1 MiB");
    if (line === "") {
      const payload = data.join("\n");
      data = [];
      frameSize = 0;
      if (payload === "[DONE]") return;
      if (payload) yield parseEvent(payload, url);
    } else if (line === "data" || line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /u, ""));
    }
  }
  if (data.length > 0) throw streamError(url, "incomplete event");
}

async function* readLines(
  stream: Readonly<ReadableStream<Uint8Array>>,
  url: string,
  signal: Readonly<AbortSignal>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const cancel = (): void => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  let buffer = "";
  let totalBytes = 0;
  let done = false;
  try {
    while (!done) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      done = Boolean(chunk.done);
      totalBytes += chunk.value?.byteLength ?? 0;
      if (totalBytes > MAX_STREAM_BYTES) throw streamError(url, "response exceeds 8 MiB");
      buffer += decoder.decode(chunk.value, { stream: !done });
      let newline = nextNewline(buffer, done);
      while (newline) {
        yield buffer.slice(0, newline.index);
        buffer = buffer.slice(newline.index + newline[0].length);
        newline = nextNewline(buffer, done);
      }
      if (buffer.length > MAX_EVENT_CHARACTERS) throw streamError(url, "event exceeds 1 MiB");
    }
    if (buffer.length > 0) throw streamError(url, "incomplete event");
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function nextNewline(buffer: string, done: boolean): RegExpExecArray | null {
  const match = /\r\n|\r|\n/u.exec(buffer);
  if (!done && match?.[0] === "\r" && match.index === buffer.length - 1) return null;
  return match;
}

function parseEvent(payload: string, url: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw streamError(url, "invalid JSON event");
  }
}

function streamError(url: string, reason: string): HTTPError {
  return new HTTPError(502, url, `Invalid event stream: ${reason}`);
}
