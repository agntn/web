import { beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../../package.json" with { type: "json" };
import { Provider } from "../../src/core/provider.ts";
import { UnknownProviderError } from "../../src/core/errors.ts";
import {
  create,
  getProviderCapabilities,
  has,
  isProviderConfigured,
  providers,
  readProviders,
  register,
  searchImageProviders,
  searchProviders,
} from "../../src/core/registry.ts";
import { builtinProviders } from "../../src/core/providers.ts";
import { listProviders } from "../../src/core/resolve.ts";
import type { ProviderConfig } from "../../src/core/types.ts";

/**
 * Each provider module records its own evaluation. vitest runs a mock factory the first time the
 * module is imported, so the list is the import order the registry under test actually caused.
 */
const loaded = vi.hoisted(() => {
  const modules: string[] = [];
  return {
    modules,
    provider: (name: string, exportName: string) => async () => {
      modules.push(name);
      const { Provider } = await import("../../src/core/provider.ts");
      class Stub extends Provider {
        static readonly providerName = name;
        static readonly defaultBaseURL = "https://api.example.com";
        readonly config: Readonly<ProviderConfig>;

        constructor(config: Readonly<ProviderConfig>) {
          super(config, Stub);
          this.config = config;
        }

        async search() {
          return [];
        }
      }
      return { [exportName]: Stub };
    },
  };
});

vi.mock("../../src/providers/brave.ts", loaded.provider("brave", "BraveProvider"));
vi.mock("../../src/providers/context.ts", loaded.provider("context", "ContextProvider"));
vi.mock("../../src/providers/exa.ts", loaded.provider("exa", "ExaProvider"));
vi.mock("../../src/providers/firecrawl.ts", loaded.provider("firecrawl", "FirecrawlProvider"));
vi.mock("../../src/providers/jina.ts", loaded.provider("jina", "JinaProvider"));
vi.mock("../../src/providers/mojeek.ts", loaded.provider("mojeek", "MojeekProvider"));
vi.mock(
  "../../src/providers/openai-codex.ts",
  loaded.provider("openai-codex", "OpenAICodexProvider"),
);
vi.mock("../../src/providers/searxng.ts", loaded.provider("searxng", "SearXNGProvider"));
vi.mock("../../src/providers/serpapi.ts", loaded.provider("serpapi", "SerpApiProvider"));
vi.mock("../../src/providers/serpbase.ts", loaded.provider("serpbase", "SerpBaseProvider"));
vi.mock("../../src/providers/tavily.ts", loaded.provider("tavily", "TavilyProvider"));
vi.mock("../../src/providers/tinyfish.ts", loaded.provider("tinyfish", "TinyfishProvider"));

describe("lazy providers", () => {
  /** Each test reads its own delta and uses a provider no other test touches, so order and isolation do not matter. */
  beforeEach(() => {
    loaded.modules.length = 0;
  });

  it("should answer every listing and capability lookup without loading a provider", () => {
    expect(providers()).toEqual([...builtinProviders]);
    expect(searchProviders()).toEqual([...builtinProviders]);
    expect(readProviders()).toEqual(["context", "firecrawl", "jina", "tavily", "tinyfish"]);
    expect(searchImageProviders()).toEqual(["serpapi"]);
    expect(has("brave")).toBe(true);
    expect(has("bing")).toBe(false);
    expect(getProviderCapabilities("serpapi")).toMatchObject({
      search: { supported: true, pagination: true },
      searchImage: { supported: true, resultLimit: { default: 10 } },
      read: { supported: false },
    });
    expect(isProviderConfigured("searxng")).toBe(true);
    expect(listProviders().map((status) => status.name)).toEqual([...builtinProviders]);
    expect(loaded.modules).toEqual([]);
  });

  it("should import only the provider a create asks for", async () => {
    const provider = await create("brave", { apiKey: "key" });

    expect(loaded.modules).toEqual(["brave"]);
    expect(provider).toBeInstanceOf(Provider);
    expect(provider.name).toBe("brave");
  });

  it("should reuse the loaded module for the next instance", async () => {
    const first = await create("context", { apiKey: "key" });
    const second = await create("context", { apiKey: "key", baseURL: "https://ctx.example.com" });

    expect(loaded.modules).toEqual(["context"]);
    expect(second).not.toBe(first);
  });

  it("should reject an unknown provider without loading anything", async () => {
    await expect(create("bing")).rejects.toBeInstanceOf(UnknownProviderError);
    expect(loaded.modules).toEqual([]);
  });

  it("should read the key variable from the entry it resolved, not from a registration that lands during the import", async () => {
    class ShadowMojeek extends Provider {
      static readonly providerName = "mojeek";
      static readonly defaultBaseURL = "https://shadow.example.com";
      static readonly apiKeyEnvVar = null;

      constructor(config: Readonly<ProviderConfig>) {
        super(config, ShadowMojeek);
      }
    }
    const previousKey = process.env.MOJEEK_API_KEY;
    process.env.MOJEEK_API_KEY = "from-env";
    const pending = create("mojeek");
    const unregister = register(ShadowMojeek);
    try {
      const provider = (await pending) as Provider & { readonly config: ProviderConfig };

      expect(loaded.modules).toEqual(["mojeek"]);
      expect(provider.config.apiKey).toBe("from-env");
    } finally {
      unregister();
      if (previousKey === undefined) delete process.env.MOJEEK_API_KEY;
      else process.env.MOJEEK_API_KEY = previousKey;
    }
  });

  it("should share one import between parallel cold creates", async () => {
    const instances = await Promise.all([
      create("exa", { apiKey: "key" }),
      create("exa", { apiKey: "key" }),
      create("exa", { apiKey: "key" }),
    ]);

    expect(loaded.modules).toEqual(["exa"]);
    expect(new Set(instances).size).toBe(3);
  });
});

describe("package sideEffects", () => {
  /** Nothing registers at import anymore, so a bundler may drop every unused module of dist. */
  it("should declare the package free of import side effects", () => {
    expect(manifest.sideEffects).toBe(false);
  });
});
