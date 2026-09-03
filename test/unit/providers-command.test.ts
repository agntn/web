import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLog = vi.fn<(message: unknown) => void>();

vi.mock("consola", () => ({
  consola: {
    log: (message: unknown) => mockLog(message),
  },
}));

import providersCommand from "../../src/commands/providers.ts";
import { builtinProviders, Provider, register } from "../../src/index.ts";
import type { ProviderStatus } from "../../src/index.ts";
import type { ProviderConfig } from "../../src/core/types.ts";

const envKeys = [
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "CONTEXT_DEV_API_KEY",
  "FIRECRAWL_API_KEY",
  "JINA_API_KEY",
  "MOJEEK_API_KEY",
  "TAVILY_API_KEY",
  "TINYFISH_API_KEY",
  "SERPAPI_API_KEY",
  "SERPBASE_API_KEY",
];

describe("providers command", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const customProviderCleanups: Array<() => void> = [];
  let writes: string[];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    mockLog.mockClear();
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    writes = [];
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    for (const unregister of customProviderCleanups.splice(0).reverse()) unregister();
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    process.stdout.write = originalWrite;
  });

  describe("human output", () => {
    it("lists all built-in providers", async () => {
      await providersCommand.run!({ args: { json: false } } as never);

      const output = mockLog.mock.calls.map((c) => String(c[0])).join("\n");
      for (const name of builtinProviders) {
        expect(output).toContain(name);
      }
      expect(output).toContain(
        "operations=search,searchImage filters=none pagination=continuation searchLimit=10 imageLimit=10",
      );
    });

    it("shows configured provider with checkmark when env var is set", async () => {
      process.env.EXA_API_KEY = "test-key";

      await providersCommand.run!({ args: { json: false } } as never);

      const output = mockLog.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("\u2713");
      expect(output).toContain("exa");
      expect(output).toContain("operations=search");
      expect(output).toContain(
        "filters=includeDomains,excludeDomains,category,startPublishedDate,endPublishedDate",
      );
      expect(output).toContain("contentOptions=highlights,summary,fullText");
      expect(output).toContain("searchLimit=10..100");
      expect(output).toContain(
        "resultFields=score,publishedDate,author,image,favicon,text,highlights,summary",
      );
    });

    it("shows unconfigured provider with cross and env var hint", async () => {
      await providersCommand.run!({ args: { json: false } } as never);

      const output = mockLog.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("\u2717");
      expect(output).toContain("EXA_API_KEY not set");
    });

    it("shows searxng as configured without any env var", async () => {
      await providersCommand.run!({ args: { json: false } } as never);

      const lines = mockLog.mock.calls.map((c) => String(c[0]));
      const searxngLine = lines.find((l) => l.includes("searxng"));
      expect(searxngLine).toBeDefined();
      expect(searxngLine).toContain("\u2713");
    });
  });

  describe("JSON output", () => {
    it("outputs array of provider status objects", async () => {
      await providersCommand.run!({ args: { json: true } } as never);

      expect(writes).toHaveLength(1);
      const raw = writes[0] ?? "";
      const parsed = JSON.parse(raw) as readonly ProviderStatus[];

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(builtinProviders.length);
    });

    it("includes name, envVar, and configured fields", async () => {
      process.env.BRAVE_API_KEY = "test-key";

      await providersCommand.run!({ args: { json: true } } as never);

      const parsed = JSON.parse(writes[0] ?? "") as readonly ProviderStatus[];
      const brave = parsed.find((provider) => provider.name === "brave");

      expect(brave).toMatchObject({
        name: "brave",
        envVar: "BRAVE_API_KEY",
        configured: true,
        searchFilters: [],
      });
    });

    it("includes machine-readable operation details", async () => {
      await providersCommand.run!({ args: { json: true } } as never);

      const parsed = JSON.parse(writes[0] ?? "") as readonly ProviderStatus[];
      const jina = parsed.find((provider) => provider.name === "jina");

      expect(jina?.capabilities).toMatchObject({
        search: {
          supported: true,
          resultLimit: { default: 10, maximum: 20 },
          resultFields: ["publishedDate", "image", "text", "metadata"],
        },
        searchImage: { supported: false },
        read: {
          supported: true,
          options: [
            "format",
            "maxTokens",
            "targetSelector",
            "removeSelector",
            "timeout",
            "noCache",
          ],
          formats: ["markdown", "text", "html"],
        },
      });
    });

    it("marks unconfigured providers correctly", async () => {
      await providersCommand.run!({ args: { json: true } } as never);

      const parsed = JSON.parse(writes[0] ?? "") as readonly ProviderStatus[];
      const exa = parsed.find((provider) => provider.name === "exa");

      expect(exa).toMatchObject({
        name: "exa",
        envVar: "EXA_API_KEY",
        configured: false,
        searchFilters: [
          "includeDomains",
          "excludeDomains",
          "category",
          "startPublishedDate",
          "endPublishedDate",
        ],
      });
    });

    it("marks searxng as configured with null envVar", async () => {
      await providersCommand.run!({ args: { json: true } } as never);

      const parsed = JSON.parse(writes[0] ?? "") as readonly ProviderStatus[];
      const searxng = parsed.find((provider) => provider.name === "searxng");

      expect(searxng).toMatchObject({
        name: "searxng",
        envVar: null,
        configured: true,
        searchFilters: ["category"],
      });
    });

    it("reflects env var changes between calls", async () => {
      await providersCommand.run!({ args: { json: true } } as never);
      const before = JSON.parse(writes[0] ?? "") as readonly ProviderStatus[];
      const tavBefore = before.find((provider) => provider.name === "tavily");
      expect(tavBefore.configured).toBe(false);

      writes.length = 0;
      process.env.TAVILY_API_KEY = "test-key";

      await providersCommand.run!({ args: { json: true } } as never);
      const after = JSON.parse(writes[0] ?? "") as readonly ProviderStatus[];
      const tavAfter = after.find((provider) => provider.name === "tavily");
      expect(tavAfter.configured).toBe(true);
    });

    it("lists a registered custom provider", async () => {
      const providerName = `command-provider-${Math.random().toString(36).slice(2)}`;
      class CommandProvider extends Provider {
        static readonly providerName = providerName;
        static readonly defaultBaseURL = "https://command.example.com";
        static readonly apiKeyEnvVar = null;

        constructor(config: Readonly<ProviderConfig>) {
          super(config, CommandProvider);
        }
      }
      customProviderCleanups.push(register(CommandProvider));

      await providersCommand.run!({ args: { json: true } } as never);

      const parsed = JSON.parse(writes[0] ?? "") as readonly ProviderStatus[];
      expect(parsed).toContainEqual({
        name: providerName,
        envVar: null,
        configured: true,
        capabilities: {
          search: { supported: false },
          searchImage: { supported: false },
          read: { supported: false },
        },
      });
    });
  });
});
