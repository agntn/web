import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Client } from "../../src/core/client.ts";
import { HTTPError } from "../../src/core/errors.ts";

const client = new Client({ timeout: 1000 });
const endpoint = "https://stream.example/";

function mockBody(text: string) {
  vi.stubGlobal(
    "fetch",
    async () => new Response(text, { headers: { "Content-Type": "text/event-stream" } }),
  );
}

async function collectEvents(source = client) {
  const events: unknown[] = [];
  for await (const event of source.postSSE(endpoint, {})) events.push(event);
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SSE transport", () => {
  it.each(["\n", "\r\n", "\r"])(
    "handles multiline data, comments, Unicode and DONE with %j delimiters",
    async (newline) => {
      const text = [
        ": keepalive",
        "",
        "event: message",
        "data: {",
        'data: "text":"Źródło 🔎"}',
        "",
        "data: [DONE]",
        "",
        "data: invalid",
        "",
      ].join(newline);
      const bytes = new TextEncoder().encode(text);
      let offset = 0;
      let cancelled = false;
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (offset === bytes.length) return controller.close();
                controller.enqueue(bytes.slice(offset, ++offset));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
          ),
      );
      expect(await collectEvents()).toEqual([{ text: "Źródło 🔎" }]);
      expect(cancelled).toBe(true);
    },
  );

  it.each([
    "data: {invalid}\n\n",
    'data: {"unfinished":true}',
    `data: ${"x".repeat(1024 * 1024 + 1)}`,
    `: ${"x".repeat(8 * 1024 * 1024)}\n\n`,
  ])(
    "rejects malformed or oversized streams without including the body in errors",
    async (body) => {
      mockBody(body);
      await expect(collectEvents()).rejects.toBeInstanceOf(HTTPError);
    },
  );

  it("enforces its timeout after headers when the response body stalls", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    const result = expect(collectEvents(new Client({ timeout: 10 }))).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(11);
    await result;
    expect(cancelled).toBe(true);
  });

  it("parses valid SSE when the Codex backend omits Content-Type", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'event: response.completed\ndata: {"type":"response.completed"}\n\n',
                ),
              );
              controller.close();
            },
          }),
        ),
    );
    expect(await collectEvents()).toEqual([{ type: "response.completed" }]);
  });

  it("rejects a successful non-SSE body and cancels it", async () => {
    let cancelled = false;
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "Content-Type": "text/html" } },
        ),
    );
    await expect(collectEvents()).rejects.toThrow("Expected an SSE response body");
    expect(cancelled).toBe(true);
  });
});
