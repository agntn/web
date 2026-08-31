import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import webExtension, { resolveWebModuleUrl } from "../../packages/pi/extensions/web.ts";
import { builtinProviders } from "../../src/index.ts";
import { resetDefaultClientForTests } from "../../src/core/client.ts";
import { providerApiKeyEnvVar } from "../../src/core/providers.ts";

type CapturedTool = Readonly<Pick<ToolDefinition, "name" | "execute">>;
type CapturedCommand = Parameters<ExtensionAPI["registerCommand"]>[1];

describe("Pi extension", () => {
  it("loads current source instead of a potentially stale ignored build", () => {
    expect(fileURLToPath(resolveWebModuleUrl())).toBe(
      fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
    );
  });

  it("accepts a search provider added by the live web module", async () => {
    const providerName = `liveprovider${Math.random().toString(36).slice(2)}`;
    Reflect.apply(Array.prototype.push, builtinProviders, [providerName]);

    try {
      const tools = captureTools();
      const searchTool = tools.get("web_search");
      if (!searchTool) throw new Error("web_search was not registered");

      const execute = searchTool.execute.bind(searchTool);
      const execution: unknown = Reflect.apply(execute, undefined, [
        "test-call",
        { query: " ", provider: providerName },
        undefined,
        undefined,
        undefined,
      ]);

      await expect(execution).rejects.toThrow("Query cannot be empty");
    } finally {
      Reflect.apply(Array.prototype.pop, builtinProviders, []);
    }
  });

  it("falls past 402 when the search provider is automatic", async () => {
    const previousExaKey = process.env.EXA_API_KEY;
    const previousBraveKey = process.env.BRAVE_API_KEY;
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : "";
      requestedUrls.push(url);
      if (url === "https://api.exa.ai/search") {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("https://api.search.brave.com/res/v1/web/search")) {
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "Brave Result",
                  url: "https://brave.example.com",
                  description: "Fallback result",
                  extra_snippets: [],
                  meta_url: { favicon: "" },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    resetDefaultClientForTests();

    try {
      const searchTool = captureTools().get("web_search");
      if (!searchTool) throw new Error("web_search was not registered");
      const execution: unknown = Reflect.apply(searchTool.execute.bind(searchTool), undefined, [
        "test-call",
        { query: "test query" },
        undefined,
        undefined,
        undefined,
      ]);

      await expect(execution).resolves.toHaveProperty("details.provider", "brave");
      await expect(execution).resolves.toHaveProperty(
        "details.results.0.url",
        "https://brave.example.com",
      );
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringContaining("[provider=brave]"),
      );
      const searchUrls = requestedUrls.filter((url) => !url.startsWith("http://localhost:8080"));
      expect(searchUrls).toHaveLength(2);
      expect(searchUrls[0]).toBe("https://api.exa.ai/search");
      expect(searchUrls[1]).toContain("https://api.search.brave.com/res/v1/web/search");
    } finally {
      if (previousExaKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previousExaKey;
      if (previousBraveKey === undefined) delete process.env.BRAVE_API_KEY;
      else process.env.BRAVE_API_KEY = previousBraveKey;
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });

  it("keeps the no-provider command failure at warning severity", async () => {
    const previousEnv = new Map<string, string | undefined>();
    for (const provider of builtinProviders) {
      const envVar = providerApiKeyEnvVar(provider);
      if (!envVar) continue;
      previousEnv.set(envVar, process.env[envVar]);
      delete process.env[envVar];
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unreachable")));

    try {
      const command = captureExtension().commands.get("web");
      if (!command) throw new Error("web command was not registered");
      const notify = vi.fn();
      const execution: unknown = Reflect.apply(command.handler, undefined, [
        "test query",
        {
          hasUI: true,
          ui: {
            input: vi.fn(),
            notify,
            pasteToEditor: vi.fn(),
            select: vi.fn(),
          },
        },
      ]);

      await expect(execution).resolves.toBeUndefined();
      expect(notify).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("No reachable web providers."),
        "warning",
      );
    } finally {
      for (const [envVar, value] of previousEnv) {
        if (value === undefined) delete process.env[envVar];
        else process.env[envVar] = value;
      }
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });

  it("reports the effective reader after automatic fallback", async () => {
    const previousContextKey = process.env.CONTEXT_DEV_API_KEY;
    process.env.CONTEXT_DEV_API_KEY = "test-key";
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url.startsWith("https://r.jina.ai/")) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("https://api.context.dev/")) {
        return new Response(
          JSON.stringify({
            success: true,
            markdown: "Fallback content",
            url: "https://example.com",
            metadata: {
              sourceUrl: "https://example.com",
              finalUrl: "https://example.com",
              title: "Fallback result",
            },
            cache_metadata: {},
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    resetDefaultClientForTests();

    try {
      const readTool = captureTools().get("web_read");
      if (!readTool) throw new Error("web_read was not registered");
      const execution: unknown = Reflect.apply(readTool.execute.bind(readTool), undefined, [
        "test-call",
        { url: "https://example.com", provider: "auto" },
        undefined,
        undefined,
        undefined,
      ]);

      await expect(execution).resolves.toMatchObject({
        content: [
          {
            text: "[provider=context requested=auto] read https://example.com\n\nFallback result\n   https://example.com\n\nFallback content",
          },
        ],
        details: {
          provider: "auto",
          effectiveProvider: "context",
          attempts: ["jina", "context"],
          result: { content: "Fallback content" },
        },
      });

      const batchExecution: unknown = Reflect.apply(readTool.execute.bind(readTool), undefined, [
        "test-batch-call",
        { url: ["https://example.com"] },
        undefined,
        undefined,
        undefined,
      ]);
      await expect(batchExecution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringContaining("[1] https://example.com [provider=context requested=auto]"),
      );
      expect(requestedUrls).toEqual([
        "https://r.jina.ai/https%3A%2F%2Fexample.com",
        "https://api.context.dev/v1/web/scrape/markdown?url=https%3A%2F%2Fexample.com",
        "https://r.jina.ai/https%3A%2F%2Fexample.com",
        "https://api.context.dev/v1/web/scrape/markdown?url=https%3A%2F%2Fexample.com",
      ]);
    } finally {
      if (previousContextKey === undefined) delete process.env.CONTEXT_DEV_API_KEY;
      else process.env.CONTEXT_DEV_API_KEY = previousContextKey;
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });
});

function captureExtension(): {
  readonly tools: Map<string, CapturedTool>;
  readonly commands: Map<string, CapturedCommand>;
} {
  const tools = new Map<string, CapturedTool>();
  const commands = new Map<string, CapturedCommand>();
  Reflect.apply(webExtension, undefined, [
    {
      registerTool(tool: CapturedTool) {
        tools.set(tool.name, tool);
      },
      registerCommand(name: string, command: CapturedCommand) {
        commands.set(name, command);
      },
    },
  ]);
  return { tools, commands };
}

function captureTools(): Map<string, CapturedTool> {
  return captureExtension().tools;
}
