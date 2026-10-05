import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { text } from "node:stream/consumers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { Client } from "../../src/core/client.ts";
import { HTTPError, RateLimitError } from "../../src/core/errors.ts";
import { version } from "../../src/version.ts";

/* One request as the server saw it. */
interface Seen {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

/* An answer, or a server that never answers, or one that breaks off halfway through the body. */
type Reply =
  | Readonly<{ status: number; body?: string; headers?: Readonly<Record<string, string>> }>
  | "hang"
  | "cut";

const json = { "Content-Type": "application/json" };
/* What each path answers on its first, second and later hits; the last reply repeats. */
const routes = new Map<string, readonly Reply[]>();
const hits = new Map<string, number>();
const seen: Seen[] = [];
const server = createServer((request, response) => {
  void text(request).then((body) => {
    const path = request.url ?? "/";
    const hit = (hits.get(path) ?? 0) + 1;
    hits.set(path, hit);
    seen.push({ method: request.method ?? "", path, headers: request.headers, body });
    const replies = routes.get(path) ?? [{ status: 500, body: "no route" }];
    const reply = replies.at(Math.min(hit, replies.length) - 1) ?? "hang";
    if (reply === "hang") return;
    if (reply === "cut") {
      response.writeHead(200, { ...json, "Content-Length": "100" }).write('{"ok":');
      setTimeout(() => response.destroy(), 10);
      return;
    }
    response.writeHead(reply.status, reply.headers).end(reply.body);
  });
});
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  routes.clear();
  hits.clear();
  seen.length = 0;
});

/* Serve a fixed answer on one path. */
function answer(
  path: string,
  status: number,
  body?: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  routes.set(path, [{ status, body, headers }]);
}

describe("Client over a real socket", () => {
  describe("requests", () => {
    it("sends JSON headers and lets a lowercase caller header replace the default", async () => {
      answer("/data", 200, '{"ok":true}', json);
      const client = new Client({ maxRetries: 0 });

      await expect(client.getJSON(`${base}/data`)).resolves.toEqual({ ok: true });
      await client.getJSON(`${base}/data`, { accept: "application/geo+json", "user-agent": "me" });

      expect(seen[0]?.headers.accept).toBe("application/json");
      expect(seen[0]?.headers["user-agent"]).toBe(`agntn-web/${version}`);
      expect(seen[1]?.headers.accept).toBe("application/geo+json");
      expect(seen[1]?.headers["user-agent"]).toBe("me");
    });

    it("serializes a POST body as JSON", async () => {
      answer("/submit", 200, '{"id":"abc"}', json);
      const client = new Client({ maxRetries: 0 });

      await expect(
        client.postJSON(
          `${base}/submit`,
          { query: "zażółć", limit: 3 },
          { Authorization: "Bearer t" },
        ),
      ).resolves.toEqual({ id: "abc" });

      expect(seen[0]?.method).toBe("POST");
      expect(seen[0]?.headers["content-type"]).toBe("application/json");
      expect(seen[0]?.headers.authorization).toBe("Bearer t");
      expect(JSON.parse(seen[0]?.body ?? "")).toEqual({ query: "zażółć", limit: 3 });
    });

    it("leaves a body it cannot serialize as the caller's error", async () => {
      const client = new Client({ maxRetries: 0 });

      await expect(client.postJSON(`${base}/submit`, { size: 1n })).rejects.toThrow(TypeError);
      expect(seen).toEqual([]);
    });
  });

  describe("response bodies", () => {
    it("drops prototype keys from a JSON answer", async () => {
      answer("/proto", 200, '{"__proto__":{"polluted":true},"kept":1}', json);
      const client = new Client({ maxRetries: 0 });

      const result = await client.getJSON<Record<string, unknown>>(`${base}/proto`);

      expect(result).toEqual({ kept: 1 });
      expect(Object.hasOwn(result, "__proto__")).toBe(false);
      expect(Object.assign({}, result)).not.toHaveProperty("polluted");
    });

    it("parses an answer without a Content-Type as JSON", async () => {
      answer("/untyped", 200, '{"ok":true}');

      await expect(new Client().getJSON(`${base}/untyped`)).resolves.toEqual({ ok: true });
    });

    it("keeps text that only claims to be JSON as text", async () => {
      answer("/broken", 200, "<html>maintenance</html>", json);

      await expect(new Client().getJSON(`${base}/broken`)).resolves.toBe(
        "<html>maintenance</html>",
      );
    });

    it("returns a text/plain answer as text", async () => {
      answer("/plain", 200, '{"ok":true}', { "Content-Type": "text/plain; charset=utf-8" });

      await expect(new Client().getJSON(`${base}/plain`)).resolves.toBe('{"ok":true}');
    });

    it("returns an empty JSON answer as an empty string", async () => {
      answer("/empty", 200, "", json);

      await expect(new Client().getJSON(`${base}/empty`)).resolves.toBe("");
    });

    it("returns nothing for 204", async () => {
      answer("/none", 204);

      await expect(new Client().getJSON(`${base}/none`)).resolves.toBeUndefined();
    });
  });

  describe("failures", () => {
    it("carries the status, the redacted URL and the body of a 404", async () => {
      answer("/missing?api_key=secret", 404, '{"error":"missing"}', json);
      const client = new Client({ maxRetries: 3, baseDelay: 0 });

      const error = await client.getJSON(`${base}/missing?api_key=secret`).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HTTPError);
      expect(error).toMatchObject({
        statusCode: 404,
        url: `${base}/missing?api_key=%5BREDACTED%5D`,
        body: '{"error":"missing"}',
      });
      expect(hits.get("/missing?api_key=secret")).toBe(1);
    });

    it("retries a 503 and returns the answer that follows", async () => {
      routes.set("/flaky", [
        { status: 503, body: "busy" },
        { status: 200, body: '{"ok":true}', headers: json },
      ]);

      await expect(
        new Client({ maxRetries: 2, baseDelay: 0 }).getJSON(`${base}/flaky`),
      ).resolves.toEqual({ ok: true });
      expect(hits.get("/flaky")).toBe(2);
    });

    it("gives up after the last retry with the final status", async () => {
      answer("/down", 502, "bad gateway");

      const error = await new Client({ maxRetries: 2, baseDelay: 0 })
        .getJSON(`${base}/down`)
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ statusCode: 502, body: "bad gateway" });
      expect(hits.get("/down")).toBe(3);
    });

    it("waits out Retry-After: 0 and tries again", async () => {
      routes.set("/limited", [
        { status: 429, headers: { "Retry-After": "0" } },
        { status: 200, body: '{"ok":true}', headers: json },
      ]);

      await expect(
        new Client({ maxRetries: 1, baseDelay: 0 }).getJSON(`${base}/limited`),
      ).resolves.toEqual({ ok: true });
      expect(hits.get("/limited")).toBe(2);
    });

    it("fails at once on a rate limit too long to wait for", async () => {
      answer("/later", 429, "", { "Retry-After": "120" });

      const error = await new Client({ maxRetries: 3, baseDelay: 0 })
        .getJSON(`${base}/later`)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RateLimitError);
      expect(error).toHaveProperty("retryAfter", 120);
      expect(hits.get("/later")).toBe(1);
    });

    it("names the refused connection when nothing answers", async () => {
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/gone`;
      await new Promise((resolve) => closed.close(resolve));

      const error = await new Client({ maxRetries: 0 }).getJSON(url).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HTTPError);
      expect(error).toHaveProperty("statusCode", 0);
      expect(error).toHaveProperty(
        "message",
        expect.stringMatching(/fetch failed: .*ECONNREFUSED/u),
      );
      expect(error).toHaveProperty("cause", expect.any(TypeError));
    });

    it("times out a server that never answers", async () => {
      routes.set("/stuck", ["hang"]);

      const error = await new Client({ maxRetries: 0, timeout: 50 })
        .getJSON(`${base}/stuck`)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HTTPError);
      expect(error).toHaveProperty(
        "message",
        `HTTP 0: ${base}/stuck: The operation was aborted due to timeout`,
      );
    });

    it("rejects with the caller's reason when the caller aborts", async () => {
      routes.set("/stuck", ["hang"]);
      const controller = new AbortController();
      const reason = new DOMException("stop", "AbortError");

      const pending = new Client({ maxRetries: 3 }).getJSON(
        `${base}/stuck`,
        undefined,
        controller.signal,
      );
      while (!hits.has("/stuck")) await new Promise((resolve) => setTimeout(resolve, 5));
      controller.abort(reason);

      await expect(pending).rejects.toBe(reason);
      expect(hits.get("/stuck")).toBe(1);
    });
  });

  describe("what ofetch got wrong", () => {
    it("turns a body cut off halfway into a transport HTTPError without paying twice", async () => {
      routes.set("/cut", ["cut", { status: 200, body: '{"ok":true}', headers: json }]);

      const error = await new Client({ maxRetries: 3, baseDelay: 0 })
        .postJSON(`${base}/cut`, { q: 1 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HTTPError);
      expect(error).toHaveProperty("statusCode", 0);
      expect(hits.get("/cut")).toBe(1);
    });

    it("keeps an error body the way the server wrote it", async () => {
      answer("/invalid", 400, '{ "error": "bad query" }', json);

      const error = await new Client().getJSON(`${base}/invalid`).catch((e: unknown) => e);

      expect(error).toHaveProperty("body", '{ "error": "bad query" }');
    });

    it("fails on a 3xx it was left holding instead of returning it as data", async () => {
      answer("/choices", 300, "pick one", { "Content-Type": "text/plain" });

      const error = await new Client().getJSON(`${base}/choices`).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HTTPError);
      expect(error).toMatchObject({ statusCode: 300, body: "pick one" });
    });

    it("reads a binary answer as text, not a Blob", async () => {
      answer("/bytes", 200, "raw", { "Content-Type": "application/octet-stream" });

      await expect(new Client().getJSON(`${base}/bytes`)).resolves.toBe("raw");
    });
  });

  describe("event streams", () => {
    it("yields the data events of an SSE answer", async () => {
      answer("/sse", 200, 'data: {"n":1}\n\ndata: {"n":2}\n\ndata: [DONE]\n\n', {
        "Content-Type": "text/event-stream",
      });
      await expect(events(() => new Client().postSSE(`${base}/sse`, { q: 1 }))).resolves.toEqual([
        { n: 1 },
        { n: 2 },
      ]);
      expect(seen[0]?.headers.accept).toBe("text/event-stream");
      expect(seen[0]?.headers["content-type"]).toBe("application/json");
      expect(seen[0]?.body).toBe('{"q":1}');
    });

    it("never follows a redirect on a metered stream", async () => {
      answer("/moved", 302, "", { Location: "/sse" });

      await expect(events(() => new Client().postSSE(`${base}/moved`, {}))).rejects.toThrow(
        "Event stream transport failed",
      );
      expect(hits.has("/sse")).toBe(false);
    });

    it("refuses a stream that is not SSE", async () => {
      answer("/json-stream", 200, '{"n":1}', json);

      await expect(events(() => new Client().postSSE(`${base}/json-stream`, {}))).rejects.toThrow(
        "Expected an SSE response body",
      );
    });

    it("turns a rate limited stream into RateLimitError without a retry", async () => {
      answer("/sse-limited", 429, "", { "Retry-After": "7" });

      const error = await events(() => new Client().postSSE(`${base}/sse-limited`, {})).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(RateLimitError);
      expect(error).toHaveProperty("retryAfter", 7);
      expect(hits.get("/sse-limited")).toBe(1);
    });
  });
});

/* Read a stream to its end and keep what it yielded. */
async function events(open: () => AsyncGenerator<unknown>): Promise<unknown[]> {
  const seenEvents: unknown[] = [];
  for await (const event of open()) seenEvents.push(event);
  return seenEvents;
}
