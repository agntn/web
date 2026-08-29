import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import webExtension, { resolveWebModuleUrl } from "../../packages/pi/extensions/web.ts";
import { builtinProviders } from "../../src/index.ts";
import { resetDefaultClientForTests } from "../../src/core/client.ts";

type CapturedTool = Readonly<Pick<ToolDefinition, "name" | "execute">>;

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

  it("keeps an omitted read provider eligible for fallback", async () => {
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
        { url: "https://example.com" },
        undefined,
        undefined,
        undefined,
      ]);

      await expect(execution).resolves.toMatchObject({
        content: [
          {
            text: "[provider=auto] read https://example.com\n\nFallback result\n   https://example.com\n\nFallback content",
          },
        ],
        details: { provider: "auto", result: { content: "Fallback content" } },
      });
      expect(requestedUrls).toEqual([
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

function captureTools(): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  Reflect.apply(webExtension, undefined, [
    {
      registerTool(tool: CapturedTool) {
        tools.set(tool.name, tool);
      },
      registerCommand() {},
    },
  ]);
  return tools;
}
