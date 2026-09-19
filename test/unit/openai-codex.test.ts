import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthError,
  HTTPError,
  RateLimitError,
  createSearchProvider,
  getProviderCapabilities,
  isDetailedSearchProvider,
  isProviderConfigured,
  searchProviderDetailed,
} from "../../src/index.ts";

import { completedEvents, sse } from "../fixtures/codex.ts";

const credentials = { accessToken: "test-access-token", accountId: "test-account" };
const endpoint = "https://chatgpt.com/backend-api/codex/responses";

function mockSearch(events: readonly unknown[] = completedEvents()) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => sse(events, "\r\n"));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("OPENAI_CODEX_ACCESS_TOKEN", "");
  vi.stubEnv("OPENAI_CODEX_ACCOUNT_ID", "");
  vi.stubEnv("OPENAI_CODEX_MODEL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OpenAI Codex search", () => {
  it("requires both environment credentials and declares only search", async () => {
    expect(isProviderConfigured("openai-codex")).toBe(false);
    vi.stubEnv("OPENAI_CODEX_ACCESS_TOKEN", credentials.accessToken);
    expect(isProviderConfigured("openai-codex")).toBe(false);
    await expect(createSearchProvider("openai-codex")).rejects.toThrow(AuthError);
    vi.stubEnv("OPENAI_CODEX_ACCOUNT_ID", credentials.accountId);
    expect(isProviderConfigured("openai-codex")).toBe(true);
    expect(getProviderCapabilities("openai-codex")).toMatchObject({
      search: {
        supported: true,
        filters: [],
        contentOptions: ["summary"],
        resultLimit: { default: 10, maximum: 100 },
      },
      searchImage: { supported: false },
      read: { supported: false },
    });
  });

  it("uses OAuth with forced search and returns native sources, not generated snippets", async () => {
    const requests = mockSearch();
    const provider = await createSearchProvider("openai-codex", {
      codex: { credentials, model: "gpt-5.4" },
    });
    if (!isDetailedSearchProvider(provider)) throw new Error("Missing detailed search");
    const result = await provider.searchDetailed("public search", { maxResults: 1, summary: true });
    expect(result.results).toEqual([
      { url: "https://example.com/", title: "Example", snippet: "" },
    ]);
    expect(result.metadata).toMatchObject({
      answer: "Generated answer with a citation. https://invented.example/",
      model: "gpt-5.5",
      requestId: "resp-test",
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    });
    expect(requests.mock.calls).toHaveLength(1);
    const request = new Request(...requests.mock.calls[0]);
    expect(request.url).toBe(endpoint);
    expect(request.redirect).toBe("error");
    expect(request.headers.get("Authorization")).toBe("Bearer test-access-token");
    expect(request.headers.get("chatgpt-account-id")).toBe("test-account");
    expect(await request.json()).toMatchObject({
      model: "gpt-5.4",
      stream: true,
      store: false,
      include: ["web_search_call.action.sources"],
      tools: [{ type: "web_search" }],
      tool_choice: { type: "web_search" },
      input: [{ role: "user", content: [{ type: "input_text", text: "public search" }] }],
    });
  });

  it("uses environment credentials through the detailed helper and reports unsupported filters", async () => {
    mockSearch();
    vi.stubEnv("OPENAI_CODEX_ACCESS_TOKEN", credentials.accessToken);
    vi.stubEnv("OPENAI_CODEX_ACCOUNT_ID", credentials.accountId);
    const response = await searchProviderDetailed("openai-codex", "public search", {
      includeDomains: ["example.com"],
    });
    expect(response.results).toHaveLength(2);
    expect(response.pagination).toEqual({ status: "unsupported" });
    expect(response.ignoredFilters).toEqual(["includeDomains"]);
    expect(response.metadata).not.toHaveProperty("answer");
  });

  it("refreshes a supplied credential once after 401 without exposing upstream secrets", async () => {
    const refreshes: boolean[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("test-access-token private account diagnostic", { status: 401 }),
      )
      .mockImplementation(async () => sse(completedEvents()));
    vi.stubGlobal("fetch", fetchMock);
    const provider = await createSearchProvider("openai-codex", {
      codex: {
        credentials: ({ refresh }) => {
          refreshes.push(refresh);
          return {
            accessToken: refresh ? "rotated-token" : "test-access-token",
            accountId: "test-account",
          };
        },
      },
    });
    expect(await provider.search("query")).toHaveLength(2);
    expect(refreshes).toEqual([false, true]);
    const tokens = fetchMock.mock.calls.map((args) =>
      new Request(...args).headers.get("Authorization"),
    );
    expect(tokens).toEqual(["Bearer test-access-token", "Bearer rotated-token"]);
  });

  it.each([
    [401, AuthError],
    [403, HTTPError],
    [429, RateLimitError],
    [503, HTTPError],
  ])(
    "classifies HTTP %i without replaying a metered request or leaking its body",
    async (status, errorType) => {
      let calls = 0;
      vi.stubGlobal("fetch", async () => {
        calls += 1;
        return new Response("test-access-token test-account", {
          status,
          headers: { "Retry-After": "7" },
        });
      });
      const provider = await createSearchProvider("openai-codex", { codex: { credentials } });
      const error: unknown = await provider.search("query").catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(errorType);
      expect(String(error)).not.toContain("test-access-token");
      expect(String(error)).not.toContain("test-account");
      if (error instanceof RateLimitError) expect(error.retryAfter).toBe(7);
      expect(calls).toBe(1);
    },
  );

  it("rejects arbitrary endpoints before resolving credentials", async () => {
    await expect(
      createSearchProvider("openai-codex", {
        baseURL: "https://attacker.example/",
        codex: { credentials },
      }),
    ).rejects.toThrow(/official ChatGPT endpoint/);
  });

  it.each([
    ["no search", [{ type: "response.completed", response: { status: "completed" } }]],
    ["truncated stream", completedEvents().slice(0, -1)],
    [
      "failed stream",
      [
        {
          type: "response.failed",
          response: { error: { code: "server_error", message: "test-access-token" } },
        },
      ],
    ],
  ])("rejects %s instead of returning partial results", async (_label, events) => {
    mockSearch(events);
    const provider = await createSearchProvider("openai-codex", { codex: { credentials } });
    await expect(provider.search("query")).rejects.toBeInstanceOf(HTTPError);
  });

  it("accepts sources in the terminal response and ignores unsafe or invented URLs", async () => {
    mockSearch([
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            {
              type: "web_search_call",
              status: "completed",
              action: {
                sources: [
                  { url: "javascript:alert(1)" },
                  { url: "https://user:password@example.com/" },
                  { url: "https://example.com/" },
                ],
              },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "https://invented.example/",
                  annotations: [
                    { type: "url_citation", url: "https://example.com/", title: "Real source" },
                    { type: "url_citation", url: "https://other.example/", title: "Cited source" },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);
    const provider = await createSearchProvider("openai-codex", { codex: { credentials } });
    expect(await provider.search("query")).toEqual([
      { url: "https://example.com/", title: "Real source", snippet: "" },
      { url: "https://other.example/", title: "Cited source", snippet: "" },
    ]);
  });

  it("accepts an empty completed search without treating generated links as evidence", async () => {
    mockSearch([
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            { type: "web_search_call", status: "completed", action: { sources: [] } },
            {
              type: "message",
              content: [{ type: "output_text", text: "https://invented.example/" }],
            },
          ],
        },
      },
    ]);
    const provider = await createSearchProvider("openai-codex", { codex: { credentials } });
    expect(await provider.search("query")).toEqual([]);
  });

  it.each(["error", "response.failed"])(
    "classifies a rate limit in %s without exposing backend diagnostics",
    async (type) => {
      const error = { code: "rate_limit_exceeded", message: "test-access-token" };
      mockSearch([{ type, ...(type === "error" ? { error } : { response: { error } }) }]);
      const provider = await createSearchProvider("openai-codex", { codex: { credentials } });
      await expect(provider.search("query")).rejects.toBeInstanceOf(RateLimitError);
    },
  );

  it("stops after one credential refresh and hides callback errors", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response("sensitive diagnostic", { status: 401 });
    });
    const provider = await createSearchProvider("openai-codex", {
      codex: { credentials: () => credentials },
    });
    await expect(provider.search("query")).rejects.toBeInstanceOf(AuthError);
    expect(calls).toBe(2);
    const broken = await createSearchProvider("openai-codex", {
      codex: {
        credentials: () => {
          throw new Error("test-access-token");
        },
      },
    });
    await expect(broken.search("query")).rejects.toThrow("Codex credential provider failed");
    expect(calls).toBe(2);
  });

  it("cancels a credential callback that ignores the signal", async () => {
    const requests = mockSearch();
    const provider = await createSearchProvider("openai-codex", {
      codex: { credentials: () => new Promise(() => {}) },
    });
    await expect(provider.search("query", { deadline: Date.now() + 15 })).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(requests.mock.calls).toHaveLength(0);
  });

  it("honors an already aborted signal before resolving credentials or fetching", async () => {
    const requests = mockSearch();
    let resolved = false;
    const controller = new AbortController();
    controller.abort(new DOMException("Cancelled", "AbortError"));
    const provider = await createSearchProvider("openai-codex", {
      codex: {
        credentials: () => {
          resolved = true;
          return credentials;
        },
      },
    });
    await expect(provider.search("query", { signal: controller.signal })).rejects.toThrow(
      "Cancelled",
    );
    expect(requests.mock.calls).toHaveLength(0);
    expect(resolved).toBe(false);
  });
});
