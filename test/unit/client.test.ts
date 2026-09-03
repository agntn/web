import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();

vi.mock("ofetch", () => ({
  ofetch: {
    create: vi.fn(() => mockFetch),
  },
  FetchError: class FetchError extends Error {
    statusCode: number;
    data: unknown;
    response?: Response;

    constructor(message: string) {
      super(message);
      this.name = "FetchError";
      this.statusCode = 0;
      this.data = null;
    }
  },
}));

import { Client, defaultClient, resetDefaultClientForTests } from "../../src/core/client.ts";
import { HTTPError, RateLimitError } from "../../src/core/errors.ts";
import { version } from "../../src/version.ts";
import { FetchError } from "ofetch";

describe("Client", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    vi.clearAllMocks();
  });

  afterEach(() => {
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
    it("should call fetch with url and signal", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/data";
      const testData = { result: "success" };
      const signal = new AbortController().signal;

      mockFetch.mockResolvedValueOnce(testData);

      const result = await client.getJSON(testUrl, undefined, signal);

      expect(mockFetch).toHaveBeenCalledWith(testUrl, {
        headers: undefined,
        signal,
        retry: false,
      });
      expect(result).toEqual(testData);
    });

    it("should retry eligible failures while a caller signal remains active", async () => {
      const client = new Client({ maxRetries: 1, baseDelay: 0 });
      const error = new FetchError("Server error");
      error.statusCode = 500;
      mockFetch.mockRejectedValueOnce(error).mockResolvedValueOnce({ result: "success" });

      await expect(
        client.getJSON("https://api.example.com/data", undefined, new AbortController().signal),
      ).resolves.toEqual({ result: "success" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should stop before a retry when the caller aborts during backoff", async () => {
      const client = new Client({ maxRetries: 2, baseDelay: 10_000 });
      const signalController = new AbortController();
      const reason = new DOMException("cancelled during backoff", "AbortError");
      const error = new FetchError("Server error");
      error.statusCode = 500;
      mockFetch.mockRejectedValue(error);

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

    it("should call fetch without signal when not provided", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/data";
      const testData = { result: "success" };

      mockFetch.mockResolvedValueOnce(testData);

      const result = await client.getJSON(testUrl);

      expect(mockFetch).toHaveBeenCalledWith(testUrl, { headers: undefined, signal: undefined });
      expect(result).toEqual(testData);
    });

    it("should preserve generic type", async () => {
      const client = new Client();
      interface TestResponse {
        readonly id: number;
        readonly name: string;
      }

      const testData: TestResponse = { id: 1, name: "test" };
      mockFetch.mockResolvedValueOnce(testData);

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

      mockFetch.mockResolvedValueOnce(testData);

      const result = await client.getJSON(testUrl, customHeaders);

      expect(mockFetch).toHaveBeenCalledWith(testUrl, {
        headers: customHeaders,
        signal: undefined,
      });
      expect(result).toEqual(testData);
    });

    it("should throw HTTPError on fetch error", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/data";

      const error = new FetchError("Not found");
      error.statusCode = 404;
      error.data = "Resource not found";

      mockFetch.mockRejectedValueOnce(error);

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

      mockFetch.mockResolvedValueOnce(testResponse);

      const result = await client.postJSON(testUrl, testBody, undefined, signal);

      expect(mockFetch).toHaveBeenCalledWith(testUrl, {
        method: "POST",
        body: testBody,
        headers: undefined,
        signal,
        retry: false,
      });
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

      mockFetch.mockResolvedValueOnce(testResponse);

      const result = await client.postJSON(testUrl, testBody, customHeaders);

      expect(mockFetch).toHaveBeenCalledWith(testUrl, {
        method: "POST",
        body: testBody,
        headers: customHeaders,
        signal: undefined,
      });
      expect(result).toEqual(testResponse);
    });

    it("should work without headers and signal", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/submit";
      const testBody = { data: "test" };
      const testResponse = { success: true };

      mockFetch.mockResolvedValueOnce(testResponse);

      const result = await client.postJSON(testUrl, testBody);

      expect(mockFetch).toHaveBeenCalledWith(testUrl, {
        method: "POST",
        body: testBody,
        headers: undefined,
        signal: undefined,
      });
      expect(result).toEqual(testResponse);
    });

    it("should preserve generic type", async () => {
      const client = new Client();
      interface SubmitResponse {
        readonly id: string;
        readonly timestamp: number;
      }

      const testResponse: SubmitResponse = { id: "abc123", timestamp: 1234567890 };
      mockFetch.mockResolvedValueOnce(testResponse);

      const result = await client.postJSON<SubmitResponse>("https://api.example.com/submit", {
        data: "test",
      });

      expect(result).toEqual(testResponse);
      expect(result.id).toBe("abc123");
    });

    it("should throw HTTPError on fetch error", async () => {
      const client = new Client();
      const testUrl = "https://api.example.com/submit";

      const error = new FetchError("Bad request");
      error.statusCode = 400;
      error.data = "Invalid input";

      mockFetch.mockRejectedValueOnce(error);

      await expect(client.postJSON(testUrl, { data: "test" })).rejects.toThrow(HTTPError);
    });
  });

  describe("error mapping", () => {
    it("should map FetchError with statusCode 429 to RateLimitError", async () => {
      const client = new Client();

      const error = new FetchError("Too many requests");
      error.statusCode = 429;
      error.data = null;
      error.response = new Response(null, {
        headers: { "Retry-After": "120" },
      });

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Too many requests");
      error.statusCode = 429;
      error.data = null;
      error.response = new Response(null);

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Too many requests");
      error.statusCode = 429;
      error.data = null;
      error.response = new Response(null, { headers: { "Retry-After": "soon" } });

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Too many requests");
      error.statusCode = 429;
      error.data = null;
      error.response = new Response(null, { headers: { "Retry-After": "-10" } });

      mockFetch.mockRejectedValueOnce(error);

      try {
        await client.getJSON("https://api.example.com/data", undefined, undefined);
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        if (err instanceof RateLimitError) {
          expect(err.retryAfter).toBe(60);
        }
      }
    });

    it("should map FetchError with other statusCode to HTTPError", async () => {
      const client = new Client();

      const error = new FetchError("Server error");
      error.statusCode = 500;
      error.data = "Internal server error";

      mockFetch.mockRejectedValueOnce(error);

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

    it("should stringify error.data when it is an object", async () => {
      const client = new Client();

      const error = new FetchError("Bad request");
      error.statusCode = 400;
      error.data = { field: "email", message: "Invalid format" };

      mockFetch.mockRejectedValueOnce(error);

      try {
        await client.getJSON("https://api.example.com/data", undefined, undefined);
      } catch (err) {
        if (err instanceof HTTPError) {
          expect(err.body).toBe(JSON.stringify(error.data));
        }
      }
    });

    it("should handle FetchError with null data", async () => {
      const client = new Client();

      const error = new FetchError("Not found");
      error.statusCode = 404;
      error.data = null;

      mockFetch.mockRejectedValueOnce(error);

      try {
        await client.getJSON("https://api.example.com/data", undefined, undefined);
      } catch (err) {
        if (err instanceof HTTPError) {
          expect(err.body).toBe('""');
        }
      }
    });

    it("should redact api_key from URL in HTTPError", async () => {
      const client = new Client();

      const error = new FetchError("Server error");
      error.statusCode = 500;
      error.data = "";

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Server error");
      error.statusCode = 500;
      error.data = "";

      mockFetch.mockRejectedValueOnce(error);

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

    it("should redact multiple sensitive params from URL in HTTPError", async () => {
      const client = new Client();

      const error = new FetchError("Unauthorized");
      error.statusCode = 401;
      error.data = "";

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Unauthorized");
      error.statusCode = 401;
      error.data = "";

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Unauthorized");
      error.statusCode = 401;
      error.data = "";

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Unauthorized");
      error.statusCode = 401;
      error.data = "";

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Unauthorized");
      error.statusCode = 401;
      error.data = "";

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Unauthorized");
      error.statusCode = 401;
      error.data = "";

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Not found");
      error.statusCode = 404;
      error.data = "";

      mockFetch.mockRejectedValueOnce(error);

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
      const client = new Client();

      const error = new FetchError("Not found");
      error.statusCode = 404;
      error.data = "";

      mockFetch.mockRejectedValueOnce(error);

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

    it("should handle non-FetchError errors", async () => {
      const client = new Client();
      const genericError = new Error("Network timeout");

      mockFetch.mockRejectedValueOnce(genericError);

      await expect(
        client.getJSON("https://api.example.com/data", undefined, undefined),
      ).rejects.toThrow("Network timeout");
    });

    it("should handle non-Error thrown values", async () => {
      const client = new Client();

      mockFetch.mockRejectedValueOnce("string error");

      await expect(
        client.getJSON("https://api.example.com/data", undefined, undefined),
      ).rejects.toThrow("string error");
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
