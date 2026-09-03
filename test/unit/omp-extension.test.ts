import { readFileSync } from "node:fs";

import * as ompTypebox from "@oh-my-pi/omptype/typebox";
import type { ExtensionAPI, Theme, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import stringWidth from "string-width";
import { afterEach, describe, expect, it, vi } from "vitest";

import webOmpExtension from "../../packages/omp/extensions/web.ts";
import { resetDefaultClientForTests } from "../../src/core/client.ts";
import { Provider, register } from "../../src/index.ts";
import type { ProviderStatus } from "../../src/index.ts";
import type { ProviderConfig, SearchRequestOptions, SearchResult } from "../../src/core/types.ts";

type OmpTool = {
  readonly name: ToolDefinition["name"];
  readonly approval: ToolDefinition["approval"];
  readonly parameters: ToolDefinition["parameters"];
  readonly execute: ToolDefinition["execute"];
  readonly renderCall: ToolDefinition["renderCall"];
  readonly renderResult: ToolDefinition["renderResult"];
};

const theme = {} as unknown as Theme;
const customProviderCleanups: Array<() => void> = [];

function captureOmpExtension(): { readonly label: string; readonly tools: Map<string, OmpTool> } {
  let label = "";
  const tools = new Map<string, OmpTool>();
  const host = {
    typebox: ompTypebox,
    setLabel(value: string) {
      label = value;
    },
    registerTool(tool: unknown) {
      const captured = tool as OmpTool;
      tools.set(captured.name, captured);
    },
  } as unknown as ExtensionAPI;

  webOmpExtension(host);
  return { label, tools };
}

function requiredTool(tools: Readonly<{ get: (name: string) => unknown }>, name: string): OmpTool {
  const tool = tools.get(name) as OmpTool | undefined;
  if (!tool) throw new Error(`Missing OMP tool: ${name}`);
  return tool;
}

function renderedText(component: unknown, width = 240): string {
  return (component as { render(viewportWidth: number): readonly string[] })
    .render(width)
    .join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const unregister of customProviderCleanups.splice(0).reverse()) unregister();
  resetDefaultClientForTests();
});

describe("OMP extension", () => {
  it("types against checkout source instead of the self package", () => {
    expect(
      readFileSync(new URL("../../packages/omp/extensions/web.ts", import.meta.url), "utf8"),
    ).not.toMatch(/(?:from|import\()\s*["']@agntn\/web["']/u);
  });

  it("ships the extension manifest and registers the complete read surface", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      omp: { extensions: string[] };
      files: string[];
    };
    const { label, tools } = captureOmpExtension();

    expect(manifest.omp.extensions).toEqual(["./packages/omp/extensions/web.ts"]);
    expect(manifest.files).toContain("packages/omp/extensions");
    expect(manifest.files).toContain("src/tui.ts");
    expect(label).toBe("Web");
    expect([...tools.keys()]).toEqual([
      "web_search",
      "web_search_image",
      "web_read",
      "web_providers",
    ]);
    for (const tool of tools.values()) {
      expect(tool.approval).toBe("read");
      expect(tool.renderCall).toBeTypeOf("function");
      expect(tool.renderResult).toBeTypeOf("function");
    }
  });

  it("renders progress and structured result summaries without repeating the title", () => {
    const search = requiredTool(captureOmpExtension().tools, "web_search");
    if (!search.renderCall || !search.renderResult) throw new Error("Missing OMP renderers");

    const call = search.renderCall(
      { query: ["first", "second"], provider: "all", maxResults: 8 },
      { expanded: false, isPartial: true, spinnerFrame: 2 },
      theme,
    );
    const result = search.renderResult(
      {
        content: [{ type: "text", text: "result" }],
        details: {
          mode: "all",
          count: 14,
          results: [],
          successfulProviders: ["brave", "jina"],
          errors: [{ provider: "exa", error: "down" }],
        },
      },
      { expanded: false, isPartial: false },
      theme,
    );

    expect(renderedText(call)).toBe("⠹ ⌕ Web Search 2 queries all · top 8");
    expect(renderedText(result)).toBe("✓ found 14 results · 2 providers · 1 provider error");
    expect(renderedText(result)).not.toContain("Web Search");
  });

  it("bounds expanded output and removes terminal control sequences", () => {
    const read = requiredTool(captureOmpExtension().tools, "web_read");
    if (!read.renderCall || !read.renderResult) throw new Error("Missing OMP renderers");
    const hostileUrl = "https://example.com/\u001B]0;bad\u0007page";
    const longBody = Array.from(
      { length: 20 },
      (_, index) => `line ${index} ${"x".repeat(220)}`,
    ).join("\n");

    const call = read.renderCall(
      { url: hostileUrl, provider: "auto", format: "markdown" },
      { expanded: false, isPartial: true },
      theme,
    );
    const details = {
      mode: "read",
      provider: "auto",
      effectiveProvider: "context",
      attempts: ["jina", "context"],
      result: { content: longBody },
    };
    const result = read.renderResult(
      {
        content: [{ type: "text", text: JSON.stringify(details) }],
        details,
      },
      { expanded: true, isPartial: false },
      theme,
    );
    const output = renderedText(result);

    expect(renderedText(call)).not.toMatch(/\p{Cc}/u);
    expect(renderedText(call)).not.toContain("bad");
    expect(renderedText(call, 80).split("\n")).toHaveLength(1);
    expect(stringWidth(renderedText(call, 80))).toBeLessThanOrEqual(80);
    expect(output.split("\n")).toHaveLength(12);
    expect(output).toContain("context · 4,569 chars · 2 attempts");
    expect(output).toContain("… preview truncated");
    expect(Math.max(...output.split("\n").map((line) => stringWidth(line)))).toBeLessThanOrEqual(
      182,
    );
    const narrowOutput = renderedText(result, 80);
    expect(narrowOutput.split("\n")).toHaveLength(12);
    expect(
      Math.max(...narrowOutput.split("\n").map((line) => stringWidth(line))),
    ).toBeLessThanOrEqual(80);

    const wideBody = "界".repeat(300);
    const wideOutput = renderedText(
      read.renderResult(
        {
          content: [{ type: "text", text: JSON.stringify({ result: { content: wideBody } }) }],
          details: { mode: "read", result: { content: wideBody } },
        },
        { expanded: true, isPartial: false },
        theme,
      ),
    );
    expect(
      Math.max(...wideOutput.split("\n").map((line) => stringWidth(line))),
    ).toBeLessThanOrEqual(182);
  });

  it("rejects schema and executor boundary violations", async () => {
    const search = requiredTool(captureOmpExtension().tools, "web_search");
    const read = requiredTool(captureOmpExtension().tools, "web_read");
    const searchSchema = search.parameters as unknown as ompTypebox.TSchema;

    expect(searchSchema.safeParse({ query: "valid", maxResults: 5 }).success).toBe(true);
    expect(searchSchema.safeParse({ query: "valid", maxResults: 5.5 }).success).toBe(false);
    expect(
      searchSchema.safeParse({ query: Array.from({ length: 11 }, () => "query") }).success,
    ).toBe(false);

    await expect(
      read.execute(
        "call-1",
        { url: "https://example.com", format: "pdf" },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow("Unknown read format: pdf");
  });

  it("keeps detailed search metadata in OMP results", async () => {
    const previousKey = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              id: "omp-request",
              creditsUsed: 2,
              data: { web: [] },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    resetDefaultClientForTests();

    try {
      const search = requiredTool(captureOmpExtension().tools, "web_search");
      const result = await search.execute(
        "call-metadata",
        { query: "test query", provider: "firecrawl" },
        undefined,
        undefined,
        {} as never,
      );

      expect(result.details).toMatchObject({
        mode: "single",
        provider: "firecrawl",
        metadata: { id: "omp-request", creditsUsed: 2 },
      });
      expect(result.content[0]).toMatchObject({ type: "text" });
      expect(
        result.content[0]?.type === "text" && "text" in result.content[0]
          ? result.content[0].text
          : "",
      ).toContain('"metadata":{"id":"omp-request","creditsUsed":2}');
    } finally {
      if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = previousKey;
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });

  it("accepts registered custom providers for each implemented capability", async () => {
    const providerName = `ompprovider${Math.random().toString(36).slice(2)}`;
    let receivedSearchOptions: SearchRequestOptions | undefined;
    class OmpProvider extends Provider {
      static readonly providerName = providerName;
      static readonly defaultBaseURL = "https://omp.example.com";

      constructor(config: Readonly<ProviderConfig>) {
        super(config, OmpProvider);
      }

      async search(_query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
        receivedSearchOptions = options;
        return [{ url: "https://example.com", title: "Custom", snippet: "Search result" }];
      }

      async searchByImage() {
        return [
          {
            pageUrl: "https://example.com/page",
            imageUrl: "https://example.com/image.jpg",
            title: "Custom image",
            provider: providerName,
          },
        ];
      }

      async read(url: string) {
        return { url, content: "Custom page" };
      }
    }
    customProviderCleanups.push(register(OmpProvider));
    const { tools } = captureOmpExtension();

    const searchResult = await requiredTool(tools, "web_search").execute(
      "search-call",
      { query: "custom query", provider: providerName, summary: true, fullText: true },
      undefined,
      undefined,
      {} as never,
    );
    const imageResult = await requiredTool(tools, "web_search_image").execute(
      "image-call",
      { url: "https://example.com/input.jpg", provider: providerName },
      undefined,
      undefined,
      {} as never,
    );
    const readResult = await requiredTool(tools, "web_read").execute(
      "read-call",
      { url: "https://example.com", provider: providerName },
      undefined,
      undefined,
      {} as never,
    );

    expect(searchResult.details).toMatchObject({
      provider: providerName,
      results: [{ title: "Custom" }],
    });
    expect(receivedSearchOptions).toMatchObject({ summary: true, fullText: true });
    expect(imageResult.details).toMatchObject({
      provider: providerName,
      results: [{ title: "Custom image" }],
    });
    expect(readResult.details).toMatchObject({
      provider: providerName,
      options: { maxChars: 20_000 },
      result: { content: "Custom page", truncated: false },
    });
  });

  it("executes provider discovery through the live package", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unreachable")));
    const providers = requiredTool(captureOmpExtension().tools, "web_providers");

    const result = await providers.execute("call-1", {}, undefined, undefined, {} as never);
    const details = result.details as {
      runtime: { buildId: string };
      packageCapabilities: Readonly<Record<string, unknown>>;
      providers: ProviderStatus[];
    };

    expect(details.runtime.buildId).toMatch(/^[a-f0-9]{12}$/u);
    expect(details.packageCapabilities).toMatchObject({
      read: {
        outputLimit: { option: "maxChars", agentDefault: 20_000, agentMaximum: 200_000 },
        continuation: { option: "continuation", opaque: true },
      },
    });
    const jina = details.providers.find((provider) => provider.name === "jina");
    expect(jina?.capabilities.search.supported).toBe(true);
    expect(jina?.capabilities.searchImage).toEqual({ supported: false });
    expect(jina?.capabilities.read.supported).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    if (!providers.renderResult) throw new Error("Missing providers renderer");
    const rendered = renderedText(
      providers.renderResult(result, { expanded: true, isPartial: false }, theme),
    );
    expect(rendered).toContain("jina ·");
    expect(rendered).not.toContain('{"runtime"');
  });
});
