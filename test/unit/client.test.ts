import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";

import { Client, defaultClient, resetDefaultClientForTests } from "../../src/core/client.ts";
import { HTTPError, RateLimitError } from "../../src/core/errors.ts";
import { version } from "../../src/version.ts";

const mockFetch = vi.fn<typeof fetch>();

describe("Client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetDefaultClientForTests();
  });

  describe("constructor", () => {
    it("should use default values when no options provided", () => {
      const client = new Client();

      expect(client.maxRetries).toBe(5);
      expect(client.baseDelay).toBe(50);
      expect(client.timeout).toBe(30_000);
      expect(client.userAgent).toBe(`agntn-web/${version}`);
    });

    it("should accept custom options", () => {
      const client = new Client({
        maxRetries: 3,
        baseDelay: 100,
        timeout: 60_000,
        userAgent: "custom-agent/1.0.0",
      });

      expect(client.maxRetries).toBe(3);
      expect(client.baseDelay).toBe(100);
      expect(client.timeout).toBe(60_000);
      expect(client.userAgent).toBe("custom-agent/1.0.0");
    });

    it("should accept partial options and use defaults for missing values", () => {
      const client = new Client({
        maxRetries: 10,
        timeout: 45_000,
      });

      expect(client.maxRetries).toBe(10);
      expect(client.baseDelay).toBe(50); // default
      expect(client.timeout).toBe(45_000);
      expect(client.userAgent).toBe(`agntn-web/${version}`); // default
    });
  });

  describe("getJSON", () => {
    it("should call fetch with url and a signal that follows the caller", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/data";
      const testData = { result: "success" };
      const controller = new AbortController();
      const reason = new DOMException("cancelled after response", "AbortError");

      respondJSON(testData);

      const result = await client.getJSON(testUrl, undefined, controller.signal);

      expect(sent(0)).toMatchObject({ url: testUrl, method: "GET", body: undefined });
      expect(result).toEqual(testData);
      controller.abort(reason);
      expect(abortReason(0)).toBe(reason);
    });

    it("should apply the timeout while a caller signal remains active", async () => {
      const client = new Client({ timeout: 20, maxRetries: 0 });
      const controller = new AbortController();
      mockFetch.mockImplementationOnce(async (_url, init) => rejectOnAbort(init?.signal));

      const outcome = await Promise.race([
        client.getJSON("https://api.example.com/slow", undefined, controller.signal).then(
          () => "resolved",
          (error: unknown) => error,
        ),
        new Promise((resolve) => setTimeout(() => resolve("still pending"), 500)),
      ]);

      expect(outcome).toBeInstanceOf(HTTPError);
      if (outcome instanceof HTTPError) {
        expect(outcome.message).toBe(
          "HTTP 0: https://api.example.com/slow: The operation was aborted due to timeout",
        );
      }
      expect(controller.signal.aborted).toBe(false);
      expect(abortReason(0).name).toBe("TimeoutError");
    });

    it("should retry after a timeout with a fresh timeout", async () => {
      const client = new Client({ timeout: 20, maxRetries: 1, baseDelay: 0 });
      mockFetch
        .mockImplementationOnce(async (_url, init) => rejectOnAbort(init?.signal))
        .mockImplementationOnce(async () => jsonResponse({ result: "success" }));

      await expect(
        client.getJSON("https://api.example.com/slow", undefined, new AbortController().signal),
      ).resolves.toEqual({ result: "success" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(abortReason(0).name).toBe("TimeoutError");
      expect(forwardedSignal(1).aborted).toBe(false);
    });

    it("should retry eligible failures while a caller signal remains active", async () => {
      const client = new Client({ maxRetries: 1, baseDelay: 0 });
      respond(500, "Server error");
      respondJSON({ result: "success" });

      await expect(
        client.getJSON("https://api.example.com/data", undefined, new AbortController().signal),
      ).resolves.toEqual({ result: "success" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should stop before a retry when the caller aborts during backoff", async () => {
      const client = new Client({ maxRetries: 2, baseDelay: 10_000 });
      const signalController = new AbortController();
      const reason = new DOMException("cancelled during backoff", "AbortError");
      respondAlways(500, "Server error");

      const pending = client.getJSON(
        "https://api.example.com/data",
        undefined,
        signalController.signal,
      );
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      signalController.abort(reason);

      await expect(pending).rejects.toBe(reason);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should give the request a timeout signal when the caller passes none", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/data";
      const testData = { result: "success" };

      respondJSON(testData);

      const result = await client.getJSON(testUrl);

      expect(sent(0)).toMatchObject({ url: testUrl, method: "GET" });
      expect(forwardedSignal(0).aborted).toBe(false);
      expect(result).toEqual(testData);
    });

    it("should preserve generic type", async () => {
      const client = new Client();
      interface TestResponse {
        readonly id: number;
        readonly name: string;
      }

      const testData: TestResponse = { id: 1, name: "test" };
      respondJSON(testData);

      const result = await client.getJSON<TestResponse>("https://api.example.com/data");

      expect(result).toEqual(testData);
      expect(result.id).toBe(1);
      expect(result.name).toBe("test");
    });

    it("should pass custom headers through", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/data";
      const customHeaders = {
        Authorization: "Bearer token123",
        "X-Custom-Header": "custom-value",
      };
      const testData = { result: "success" };

      respondJSON(testData);

      const result = await client.getJSON(testUrl, customHeaders);

      const { headers } = sent(0);
      expect(headers.get("Authorization")).toBe("Bearer token123");
      expect(headers.get("X-Custom-Header")).toBe("custom-value");
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("User-Agent")).toBe(`agntn-web/${version}`);
      expect(result).toEqual(testData);
    });

    it("should throw HTTPError on fetch error", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/data";

      respond(404, "Resource not found");

      try {
        await client.getJSON(testUrl, undefined, undefined);
        throw new Error("Should have thrown HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (err instanceof HTTPError) {
          expect(err.message).toContain("HTTP 404");
        }
      }
    });
  });

  describe("postJSON", () => {
    it("should call fetch with url, method POST, body, and signal", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/submit";
      const testBody = { name: "test", value: 123 };
      const testResponse = { success: true };
      const signal = new AbortController().signal;

      respondJSON(testResponse);

      const result = await client.postJSON(testUrl, testBody, undefined, signal);

      expect(sent(0)).toMatchObject({
        url: testUrl,
        method: "POST",
        body: JSON.stringify(testBody),
      });
      expect(sent(0).headers.get("Content-Type")).toBe("application/json");
      expect(result).toEqual(testResponse);
    });

    it("should pass custom auth headers through", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/submit";
      const testBody = { data: "test" };
      const customHeaders = {
        Authorization: "Bearer token123",
        "X-Custom-Header": "custom-value",
      };
      const testResponse = { success: true };

      respondJSON(testResponse);

      const result = await client.postJSON(testUrl, testBody, customHeaders);

      expect(sent(0)).toMatchObject({ method: "POST", body: JSON.stringify(testBody) });
      expect(sent(0).headers.get("Authorization")).toBe("Bearer token123");
      expect(sent(0).headers.get("X-Custom-Header")).toBe("custom-value");
      expect(result).toEqual(testResponse);
    });

    it("should work without headers and signal", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/submit";
      const testBody = { data: "test" };
      const testResponse = { success: true };

      respondJSON(testResponse);

      const result = await client.postJSON(testUrl, testBody);

      expect(sent(0)).toMatchObject({
        url: testUrl,
        method: "POST",
        body: JSON.stringify(testBody),
      });
      expect(sent(0).headers.get("Content-Type")).toBe("application/json");
      expect(result).toEqual(testResponse);
    });

    it("should preserve generic type", async () => {
      const client = new Client();
      interface SubmitResponse {
        readonly id: string;
        readonly timestamp: number;
      }

      const testResponse: SubmitResponse = { id: "abc123", timestamp: 1234567890 };
      respondJSON(testResponse);

      const result = await client.postJSON<SubmitResponse>("https://api.example.com/submit", {
        data: "test",
      });

      expect(result).toEqual(testResponse);
      expect(result.id).toBe("abc123");
    });

    it("should throw HTTPError on fetch error", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/submit";

      respond(400, "Invalid input");

      await expect(client.postJSON(testUrl, { data: "test" })).rejects.toThrow(HTTPError);
    });
  });

  describe("error mapping", () => {
    it("should map a 429 to RateLimitError", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(429, null, { "Retry-After": "120" });

      await expect(
        client.getJSON("https://api.example.com/data", undefined, undefined),
      ).rejects.toThrow(RateLimitError);

      try {
        await client.getJSON("https://api.example.com/data", undefined, undefined);
      } catch (err) {
        if (err instanceof RateLimitError) {
          expect(err.retryAfter).toBe(120);
        }
      }
    });

    it("should use default retryAfter of 60 when Retry-After header missing", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(429, null);

      try {
        await client.getJSON("https://api.example.com/data", undefined, undefined);
      } catch (err) {
        if (err instanceof RateLimitError) {
          expect(err.retryAfter).toBe(60);
        }
      }
    });

    it("should fall back to 60 for non-numeric Retry-After header", async () => {
      expect.assertions(2);
      const client = new Client({ maxRetries: 0 });

      respond(429, null, { "Retry-After": "soon" });

      try {
        await client.getJSON("https://api.example.com/data", undefined, undefined);
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        if (err instanceof RateLimitError) {
          expect(err.retryAfter).toBe(60);
        }
      }
    });

    it("should fall back to 60 for negative Retry-After header", async () => {
      expect.assertions(2);
      const client = new Client({ maxRetries: 0 });

      respond(429, null, { "Retry-After": "-10" });

      try {
        await client.getJSON("https://api.example.com/data", undefined, undefined);
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        if (err instanceof RateLimitError) {
          expect(err.retryAfter).toBe(60);
        }
      }
    });

    it("should map any other status to HTTPError", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(500, "Internal server error");

      try {
        await client.getJSON("https://api.example.com/data", undefined, undefined);
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (err instanceof HTTPError) {
          expect(err.statusCode).toBe(500);
          expect(err.url).toBe("https://api.example.com/data");
          expect(err.body).toBe("Internal server error");
        }
      }
    });

    it("should keep a JSON error body as the server sent it", async () => {
      expect.assertions(1);
      const client = new Client({ maxRetries: 0 });
      const data = JSON.stringify({ field: "email", message: "Invalid format" }, null, 2);

      respond(400, data, { "Content-Type": "application/json" });

      try {
        await client.getJSON("https://api.example.com/data", undefined, undefined);
      } catch (err) {
        if (err instanceof HTTPError) {
          expect(err.body).toBe(data);
        }
      }
    });

    it("should leave the body empty for an error without one", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(404, null);

      try {
        await client.getJSON("https://api.example.com/data", undefined, undefined);
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.body).toBe("");
        expect(err.message).toBe("HTTP 404: https://api.example.com/data");
      }
    });

    it("should name the transport failure when no response arrived", async () => {
      const client = new Client({ maxRetries: 0 });
      const dns = Object.assign(new Error("getaddrinfo ENOTFOUND api.example.com"), {
        code: "ENOTFOUND",
      });
      const fetchFailed = new TypeError("fetch failed", { cause: dns });

      mockFetch.mockRejectedValueOnce(fetchFailed);

      try {
        await client.getJSON("https://api.example.com/data?api_key=sk-live-secret");
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.statusCode).toBe(0);
        expect(err.body).toBe("fetch failed: getaddrinfo ENOTFOUND api.example.com");
        expect(err.message).toBe(
          "HTTP 0: https://api.example.com/data?api_key=%5BREDACTED%5D: fetch failed: getaddrinfo ENOTFOUND api.example.com",
        );
        expect(err.message).not.toContain("sk-live-secret");
        expect(err.cause).toBe(fetchFailed);
      }
    });

    it("should list every address behind an aggregate connection failure", async () => {
      const client = new Client({ maxRetries: 0 });
      const refused = new AggregateError([
        new Error("connect ECONNREFUSED ::1:8080"),
        new Error("connect ECONNREFUSED 127.0.0.1:8080"),
      ]);

      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed", { cause: refused }));

      await expect(client.getJSON("http://localhost:8080/search")).rejects.toThrow(
        "HTTP 0: http://localhost:8080/search: fetch failed: connect ECONNREFUSED ::1:8080, connect ECONNREFUSED 127.0.0.1:8080",
      );
    });

    it("should leave the body empty when fetch rejects with a non-Error", async () => {
      const client = new Client({ maxRetries: 0 });

      mockFetch.mockRejectedValueOnce("socket gone");

      try {
        await client.getJSON("https://api.example.com/data");
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.statusCode).toBe(0);
        expect(err.body).toBe("");
        expect(err.message).toBe("HTTP 0: https://api.example.com/data");
        expect(err.cause).toBe("socket gone");
      }
    });

    it("should redact api_key from URL in HTTPError", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(500, "");

      try {
        await client.getJSON(
          "https://serpapi.com/search?q=test&api_key=sk-live-secret123&num=10",
          undefined,
          undefined,
        );
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (err instanceof HTTPError) {
          expect(err.url).not.toContain("sk-live-secret123");
          expect(err.url).toContain("api_key=%5BREDACTED%5D");
          expect(err.message).not.toContain("sk-live-secret123");
        }
      }
    });

    it("should redact a nested target URL from HTTPError", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(500, "");

      try {
        await client.getJSON(
          "https://api.context.dev/v1/web/scrape/markdown?url=https%3A%2F%2Fexample.com%2Fprivate%3Ftoken%3Dsigned-secret&maxAgeMs=0",
          undefined,
          undefined,
        );
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.url).not.toContain("signed-secret");
        expect(err.url).toContain("url=%5BREDACTED%5D");
        expect(err.url).toContain("maxAgeMs=0");
      }
    });

    it("should redact secrets from an encoded target URL in the request path", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(500, "");

      try {
        await client.getJSON(
          "https://r.jina.ai/https%3A%2F%2Freader%3Asigned-pass%40example.com%2Fprivate%3Ftoken%3Dsigned-secret%26q%3Dkept",
          undefined,
          undefined,
        );
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.url).not.toContain("signed-pass");
        expect(err.url).not.toContain("signed-secret");
        expect(err.message).not.toContain("signed-pass");
        expect(err.message).not.toContain("signed-secret");
        expect(decodeURIComponent(new URL(err.url).pathname.slice(1))).toBe(
          "https://[REDACTED]:[REDACTED]@example.com/private?token=%5BREDACTED%5D&q=kept",
        );
      }
    });

    it("should preserve an encoded target URL when it contains no secrets", async () => {
      const client = new Client({ maxRetries: 0 });
      const requestUrl =
        "https://r.jina.ai/https%3A%2F%2Fexample.com%2Fpublic%3Fq%3Dhello%2520world";

      respond(404, "");

      try {
        await client.getJSON(requestUrl, undefined, undefined);
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.url).toBe(requestUrl);
      }
    });

    it("should redact multiple sensitive params from URL in HTTPError", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(401, "");

      try {
        await client.getJSON(
          "https://example.com/api?key=abc123&token=xyz789&q=test",
          undefined,
          undefined,
        );
      } catch (err) {
        if (err instanceof HTTPError) {
          expect(err.url).not.toContain("abc123");
          expect(err.url).not.toContain("xyz789");
          expect(err.url).toContain("q=test");
        }
      }
    });

    it("should redact case variants of sensitive params from URL in HTTPError", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(401, "");

      try {
        await client.getJSON(
          "https://example.com/api?apiKey=abc123&API_KEY=def456&Token=ghi789&q=test",
          undefined,
          undefined,
        );
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.url).not.toContain("abc123");
        expect(err.url).not.toContain("def456");
        expect(err.url).not.toContain("ghi789");
        expect(err.url).toContain("apiKey=%5BREDACTED%5D");
        expect(err.url).toContain("API_KEY=%5BREDACTED%5D");
        expect(err.url).toContain("Token=%5BREDACTED%5D");
        expect(err.url).toContain("q=test");
      }
    });

    it("should redact repeated mixed-case sensitive params from URL in HTTPError", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(401, "");

      try {
        await client.getJSON(
          "https://example.com/api?Token=a&token=b&TOKEN=c&q=test",
          undefined,
          undefined,
        );
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.url).not.toContain("Token=a");
        expect(err.url).not.toContain("token=b");
        expect(err.url).not.toContain("TOKEN=c");
        expect(err.url).toContain("Token=%5BREDACTED%5D");
        expect(err.url).toContain("token=%5BREDACTED%5D");
        expect(err.url).toContain("TOKEN=%5BREDACTED%5D");
        expect(err.url).toContain("q=test");
      }
    });

    it("should preserve non-sensitive query encoding when redacting secrets", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(401, "");

      try {
        await client.getJSON(
          "https://example.com/api?api_key=abc123&q=hello%20world",
          undefined,
          undefined,
        );
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.url).toContain("api_key=%5BREDACTED%5D");
        expect(err.url).toContain("q=hello%20world");
      }
    });

    it("should preserve flag params and redact sensitive params with explicit values", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(401, "");

      try {
        await client.getJSON("https://example.com/api?api_key&token=&q=test", undefined, undefined);
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.url).toContain("api_key");
        expect(err.url).not.toContain("api_key=%5BREDACTED%5D");
        expect(err.url).toContain("token=%5BREDACTED%5D");
        expect(err.url).toContain("q=test");
      }
    });

    it("should redact userinfo credentials from URL in HTTPError", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(401, "");

      try {
        await client.getJSON(
          "https://user:password@example.com/api?key=abc123",
          undefined,
          undefined,
        );
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.url).not.toContain("user:password@");
        expect(err.url).toContain("https://[REDACTED]:[REDACTED]@example.com");
        expect(err.url).toContain("key=%5BREDACTED%5D");
      }
    });

    it("should leave URL unchanged when no sensitive params present", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(404, "");

      try {
        await client.getJSON(
          "https://api.example.com/search?q=hello&count=10",
          undefined,
          undefined,
        );
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.url).toBe("https://api.example.com/search?q=hello&count=10");
      }
    });

    it("should preserve original URL string when no sensitive params are present", async () => {
      const client = new Client({ maxRetries: 0 });

      respond(404, "");

      const originalUrl = "https://api.example.com/search?q=hello%20world&x=~tilde";

      try {
        await client.getJSON(originalUrl, undefined, undefined);
        throw new Error("Expected HTTPError");
      } catch (err) {
        expect(err).toBeInstanceOf(HTTPError);
        if (!(err instanceof HTTPError)) {
          throw err;
        }
        expect(err.url).toBe(originalUrl);
      }
    });

    it("should treat any fetch rejection as a transport failure", async () => {
      const client = new Client({ maxRetries: 0 });
      const genericError = new Error("Network timeout");

      mockFetch.mockRejectedValueOnce(genericError);

      const error = await client.getJSON("https://api.example.com/data").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HTTPError);
      expect(error).toMatchObject({ statusCode: 0, cause: genericError });
      expect(error).toHaveProperty(
        "message",
        "HTTP 0: https://api.example.com/data: Network timeout",
      );
    });
  });

  describe("rate limits", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("waits for the window Brave names before it retries", async () => {
      vi.useFakeTimers();
      const client = new Client({ maxRetries: 1, baseDelay: 0 });
      mockFetch
        .mockImplementationOnce(rateLimited({ remaining: "0, 445", reset: "1, 56000" }))
        .mockImplementationOnce(async () => jsonResponse({ result: "success" }));

      const pending = client.getJSON("https://api.search.brave.com/res/v1/web/search");
      await vi.advanceTimersByTimeAsync(999);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toEqual({ result: "success" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("waits for Retry-After before it retries", async () => {
      vi.useFakeTimers();
      const client = new Client({ maxRetries: 1, baseDelay: 0 });
      mockFetch
        .mockImplementationOnce(rateLimited({ retryAfter: "2" }))
        .mockImplementationOnce(async () => jsonResponse({ result: "success" }));

      const pending = client.getJSON(
        "https://api.example.com/data",
        undefined,
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(1_999);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toEqual({ result: "success" });
    });

    it("fails at once with the reset when the wait is too long to retry", async () => {
      const client = new Client({ maxRetries: 5, baseDelay: 0 });
      mockFetch.mockImplementation(rateLimited({ remaining: "0, 0", reset: "1, 56000" }));

      const error = await client.getJSON("https://api.example.com/data").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RateLimitError);
      expect(error).toHaveProperty("retryAfter", 56_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("reports the reset of the exhausted window after the last retry", async () => {
      const client = new Client({ maxRetries: 0 });
      mockFetch.mockImplementationOnce(rateLimited({ remaining: "0, 445", reset: "1, 56000" }));

      const error = await client.getJSON("https://api.example.com/data").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RateLimitError);
      expect(error).toHaveProperty("message", "Rate limited. Retry after 1s");
    });

    it("keeps the backoff when a 429 names no reset", async () => {
      const client = new Client({ maxRetries: 2, baseDelay: 0 });
      mockFetch.mockImplementation(rateLimited({}));

      const error = await client.getJSON("https://api.example.com/data").catch((e: unknown) => e);

      expect(error).toHaveProperty("retryAfter", 60);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("defaultClient", () => {
    it("should return a Client instance", () => {
      const client = defaultClient();

      expect(client).toBeInstanceOf(Client);
    });

    it("should return the same instance on multiple calls (singleton)", () => {
      const client1 = defaultClient();
      const client2 = defaultClient();
      const client3 = defaultClient();

      expect(client1).toBe(client2);
      expect(client2).toBe(client3);
    });

    it("should use default configuration", () => {
      const client = defaultClient();

      expect(client.maxRetries).toBe(5);
      expect(client.baseDelay).toBe(50);
      expect(client.timeout).toBe(30_000);
      expect(client.userAgent).toBe(`agntn-web/${version}`);
    });
  });
});

/* What one fetch call sent, read back from its arguments. */
function sent(call: number): {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
} {
  const [url, init] = mockFetch.mock.calls[call] ?? [];
  return {
    url: url instanceof Request ? url.url : url.toString(),
    method: init?.method ?? "GET",
    body: init?.body,
    headers: new Headers(init?.headers),
  };
}

function forwardedSignal(call: number): AbortSignal {
  const signal = mockFetch.mock.calls[call]?.[1]?.signal;
  if (!(signal instanceof AbortSignal)) {
    throw new Error(`fetch call ${call} carried no signal`);
  }
  return signal;
}

function abortReason(call: number): DOMException {
  const reason: unknown = forwardedSignal(call).reason;
  if (!(reason instanceof DOMException)) {
    throw new Error(`fetch call ${call} was not aborted with a DOMException`);
  }
  return reason;
}

/* Native fetch rejects with the abort reason itself. */
function rejectOnAbort(signal?: Readonly<AbortSignal> | null): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/* A fresh JSON answer each call, since a Response body reads once. */
function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

function respondJSON(data: unknown): void {
  mockFetch.mockImplementationOnce(async () => jsonResponse(data));
}

function statusResponse(
  status: number,
  body: string | null,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(body, { status, headers });
}

function respond(
  status: number,
  body: string | null,
  headers?: Readonly<Record<string, string>>,
): void {
  mockFetch.mockImplementationOnce(async () => statusResponse(status, body, headers));
}

function respondAlways(
  status: number,
  body: string | null,
  headers?: Readonly<Record<string, string>>,
): void {
  mockFetch.mockImplementation(async () => statusResponse(status, body, headers));
}

function rateLimited(headers: {
  readonly retryAfter?: string;
  readonly remaining?: string;
  readonly reset?: string;
}): () => Promise<Response> {
  return async () =>
    statusResponse(429, null, {
      ...(headers.retryAfter === undefined ? {} : { "Retry-After": headers.retryAfter }),
      ...(headers.remaining === undefined ? {} : { "X-RateLimit-Remaining": headers.remaining }),
      ...(headers.reset === undefined ? {} : { "X-RateLimit-Reset": headers.reset }),
    });
}
