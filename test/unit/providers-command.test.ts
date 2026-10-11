import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";

import { runWeb } from "../fixtures/cli.ts";
import { builtinProviders, Provider, register } from "../../src/index.ts";
import type { ProviderStatus } from "../../src/index.ts";
import type { ProviderConfig } from "../../src/core/types.ts";

const envKeys = [
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "CONTEXT_DEV_API_KEY",
  "FIRECRAWL_API_KEY",
  "JINA_API_KEY",
  "MARGINALIA_API_KEY",
  "MOJEEK_API_KEY",
  "OPENAI_CODEX_ACCESS_TOKEN",
  "OPENAI_CODEX_ACCOUNT_ID",
  "TAVILY_API_KEY",
  "TINYFISH_API_KEY",
  "SERPAPI_API_KEY",
  "SERPBASE_API_KEY",
];

describe("providers command", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const customProviderCleanups: Array<() => void> = [];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no SearXNG here")));
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
    vi.unstubAllGlobals();
  });

  /**
   * Runs `web providers` and returns the human text.
   * @returns {Promise<string>} What it printed.
   */
  async function humanOutput(): Promise<string> {
    return (await runWeb("providers")).stdout;
  }

  /**
   * Runs `web providers --json` and returns the provider statuses it printed.
   * @returns {Promise<readonly ProviderStatus[]>} One status per registered provider.
   */
  async function jsonProviders(): Promise<readonly ProviderStatus[]> {
    const { stdout } = await runWeb("providers", "--json");
    return (JSON.parse(stdout) as { readonly result: { readonly providers: ProviderStatus[] } })
      .result.providers;
  }

  describe("human output", () => {
    it("lists all built-in providers", async () => {
      const output = await humanOutput();
      for (const name of builtinProviders) {
        expect(output).toContain(name);
      }
      expect(output).toContain(
        "operations=search,searchImage filters=startPublishedDate,endPublishedDate pagination=continuation searchLimit=10 imageLimit=10",
      );
    });

    it("prints plain text even when colors are forced", async () => {
      vi.stubEnv("FORCE_COLOR", "1");

      const output = await humanOutput();
      expect(output).toContain("· exa (EXA_API_KEY) operations=search");
      expect(output).not.toContain("\x1B");
    });

    it("starts with the running build and the package guarantees", async () => {
      const [build, guarantees] = (await humanOutput()).split("\n");
      expect(build).toMatch(/^web \S+ build [a-f0-9]{12}, started /u);
      expect(guarantees).toContain("portable read content: maxChars defaults to 20000");
    });

    it("shows configured provider with checkmark when env var is set", async () => {
      process.env.EXA_API_KEY = "test-key";

      const output = await humanOutput();
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

    it("shows an unconfigured provider with a dot and the variable it reads", async () => {
      const output = await humanOutput();
      expect(output).toContain("· exa (EXA_API_KEY)");
    });

    it("shows searxng as configured without any env var, and unreachable when it is down", async () => {
      const lines = (await humanOutput()).split("\n");
      const searxngLine = lines.find((l) => l.includes("searxng"));
      expect(searxngLine).toMatch(/^⚠ searxng - unreachable /u);
    });
  });

  describe("JSON output", () => {
    it("outputs array of provider status objects", async () => {
      const parsed = await jsonProviders();

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(builtinProviders.length);
    });

    it("includes name, envVar, and configured fields", async () => {
      process.env.BRAVE_API_KEY = "test-key";

      const parsed = await jsonProviders();
      const brave = parsed.find((provider) => provider.name === "brave");

      expect(brave).toMatchObject({
        name: "brave",
        envVar: "BRAVE_API_KEY",
        configured: true,
        searchFilters: ["startPublishedDate", "endPublishedDate"],
      });
    });

    it("includes machine-readable operation details", async () => {
      const parsed = await jsonProviders();
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
      const parsed = await jsonProviders();
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
      const parsed = await jsonProviders();
      const searxng = parsed.find((provider) => provider.name === "searxng");

      expect(searxng).toMatchObject({
        name: "searxng",
        envVar: null,
        configured: true,
        reachable: false,
        searchFilters: ["category"],
      });
    });

    it("reflects env var changes between calls", async () => {
      const before = await jsonProviders();
      const tavBefore = before.find((provider) => provider.name === "tavily");
      expect(tavBefore?.configured).toBe(false);

      process.env.TAVILY_API_KEY = "test-key";

      const after = await jsonProviders();
      const tavAfter = after.find((provider) => provider.name === "tavily");
      expect(tavAfter?.configured).toBe(true);
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

      const parsed = await jsonProviders();
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
