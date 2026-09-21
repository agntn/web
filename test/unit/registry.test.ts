import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  create,
  createSearchProvider,
  getProviderApiKeyEnvVar,
  getProviderCapabilities,
  has,
  isProviderConfigured,
  probesAvailability,
  searchImageProviders,
  providers,
  readProviders,
  register as registerProvider,
  searchProviders,
} from "../../src/core/registry.ts";
import {
  InvalidProviderUrlError,
  SearchNotSupportedError,
  UnknownProviderError,
} from "../../src/core/errors.ts";
import { searchProviderDetailed } from "../../src/core/all.ts";
import { probeConfiguredProvider } from "../../src/core/resolve.ts";
import { Provider, type ProviderConstructor } from "../../src/core/provider.ts";
import type { ProviderConfig, SearchResult } from "../../src/core/types.ts";

describe("registry", () => {
  const registrations: Array<() => void> = [];
  const register = (provider: ProviderConstructor): (() => void) => {
    const unregister = registerProvider(provider);
    registrations.push(unregister);
    return unregister;
  };

  // Use unique names per test suite to avoid collisions with module-level Maps.
  const testProviderName = `testprovider${Math.random().toString(36).slice(2)}`;
  const testProviderName2 = `testprovider${Math.random().toString(36).slice(2)}`;
  const testProviderName3 = `testprovider${Math.random().toString(36).slice(2)}`;
  const testProviderName4 = `testprovider${Math.random().toString(36).slice(2)}`;
  const testProviderName5 = `testprovider${Math.random().toString(36).slice(2)}`;
  const testProviderName6 = `testprovider${Math.random().toString(36).slice(2)}`;
  const envVarName = `${testProviderName.toUpperCase()}_API_KEY`;

  class MockProvider extends Provider {
    static readonly providerName = testProviderName;
    static readonly defaultBaseURL = "https://api.example.com";
    static readonly capturedConfigs: ProviderConfig[] = [];

    constructor(config: Readonly<ProviderConfig>) {
      super(config, MockProvider);
      MockProvider.capturedConfigs.push(config);
    }

    async search(): Promise<readonly SearchResult[]> {
      return [];
    }
  }

  class SecondMockProvider extends Provider {
    static readonly providerName = testProviderName2;
    static readonly defaultBaseURL = "https://api2.example.com";

    constructor(config: Readonly<ProviderConfig>) {
      super(config, SecondMockProvider);
    }
  }

  class ReadOnlyProvider extends Provider {
    static readonly providerName = testProviderName3;
    static readonly defaultBaseURL = "https://reader.example.com";

    constructor(config: Readonly<ProviderConfig>) {
      super(config, ReadOnlyProvider);
    }

    async read(): Promise<{ url: string; content: string }> {
      return { url: "https://example.com", content: "ok" };
    }
  }

  class ImageOnlyProvider extends Provider {
    static readonly providerName = testProviderName4;
    static readonly defaultBaseURL = "https://images.example.com";
    static readonly apiKeyEnvVar = null;

    constructor(config: Readonly<ProviderConfig>) {
      super(config, ImageOnlyProvider);
    }

    async searchByImage(): Promise<[]> {
      return [];
    }
  }

  class ClassFieldProvider extends Provider {
    static readonly providerName = testProviderName5;
    static readonly defaultBaseURL = "https://fields.example.com";
    static readonly capabilities = ["search"] as const;

    readonly search = async (): Promise<readonly SearchResult[]> => [];

    constructor(config: Readonly<ProviderConfig>) {
      super(config, ClassFieldProvider);
    }
  }

  class FalsePaginationDeclarationProvider extends Provider {
    static readonly providerName = testProviderName6;
    static readonly defaultBaseURL = "https://declaration.example.com";
    static readonly capabilityDetails = {
      search: {
        contentOptions: [],
        pagination: true,
        resultFields: [],
      },
    } as const;

    constructor(config: Readonly<ProviderConfig>) {
      super(config, FalsePaginationDeclarationProvider);
    }

    async search(): Promise<readonly SearchResult[]> {
      return [];
    }
  }

  beforeEach(() => {
    delete process.env[envVarName];
    MockProvider.capturedConfigs.length = 0;
  });

  afterEach(() => {
    for (const unregister of registrations.splice(0).reverse()) unregister();
  });

  describe("register() + has()", () => {
    it("registers a provider class and returns an isolated cleanup", () => {
      const unregister = register(MockProvider);
      expect(has(testProviderName)).toBe(true);

      unregister();

      expect(has(testProviderName)).toBe(false);
    });

    it("restores the previous registration when a replacement is removed", async () => {
      class ReplacementProvider extends Provider {
        static readonly providerName = testProviderName;
        static readonly defaultBaseURL = "https://replacement.example.com";

        constructor(config: Readonly<ProviderConfig>) {
          super(config, ReplacementProvider);
        }
      }
      register(MockProvider);
      const removeReplacement = register(ReplacementProvider);

      removeReplacement();

      await expect(create(testProviderName)).resolves.toBeInstanceOf(MockProvider);
    });

    it("does not restore a registration removed before its replacement", () => {
      class ReplacementProvider extends Provider {
        static readonly providerName = testProviderName;
        static readonly defaultBaseURL = "https://replacement.example.com";

        constructor(config: Readonly<ProviderConfig>) {
          super(config, ReplacementProvider);
        }
      }
      const removeOriginal = register(MockProvider);
      const removeReplacement = register(ReplacementProvider);

      removeOriginal();
      removeReplacement();

      expect(has(testProviderName)).toBe(false);
    });

    it.each([
      "",
      " custom",
      "custom ",
      "auto",
      "all",
      "custom\nprovider",
      "custom_provider",
      "Custom",
      "custom--provider",
      "custom\u202Eprovider",
      "custom\u2028provider",
    ])("rejects the unsafe provider name %j", (providerName) => {
      class InvalidNameProvider extends Provider {
        static readonly providerName = providerName;
        static readonly defaultBaseURL = "https://invalid.example.com";

        constructor(config: Readonly<ProviderConfig>) {
          super(config, InvalidNameProvider);
        }
      }

      expect(() => register(InvalidNameProvider)).toThrow(TypeError);
    });

    it("returns false for unregistered providers", () => {
      const unregisteredName = `nonexistent-${Math.random().toString(36).slice(2)}`;
      expect(has(unregisteredName)).toBe(false);
    });
  });

  describe("providers()", () => {
    it("includes registered provider class names", () => {
      register(MockProvider);
      expect(providers()).toContain(testProviderName);
    });

    it("returns every registered provider class name", () => {
      register(MockProvider);
      register(SecondMockProvider);

      const registeredProviders = providers();
      expect(registeredProviders).toContain(testProviderName);
      expect(registeredProviders).toContain(testProviderName2);
      expect(Array.isArray(registeredProviders)).toBe(true);
    });
  });

  describe("create()", () => {
    it("creates an instance of the abstract provider base", async () => {
      register(MockProvider);

      const provider = await create(testProviderName);

      expect(provider).toBeInstanceOf(Provider);
      expect(provider.name).toBe(testProviderName);
    });

    it("keeps provider identity immutable at runtime", async () => {
      register(MockProvider);
      const provider = await create(testProviderName);

      expect(() => Object.assign(provider, { name: "changed" })).toThrow(TypeError);
      expect(provider.name).toBe(testProviderName);
    });

    it("passes config.apiKey to the provider constructor", async () => {
      register(MockProvider);
      const apiKey = "test-api-key-12345";

      await create(testProviderName, { apiKey });

      expect(MockProvider.capturedConfigs).toHaveLength(1);
      expect(MockProvider.capturedConfigs[0]?.apiKey).toBe(apiKey);
    });

    it("reads the API key from the environment", async () => {
      register(MockProvider);
      const apiKey = "env-api-key-67890";
      process.env[envVarName] = apiKey;

      await create(testProviderName);

      expect(MockProvider.capturedConfigs[0]?.apiKey).toBe(apiKey);
    });

    it("prefers config.apiKey over the environment", async () => {
      register(MockProvider);
      process.env[envVarName] = "env-api-key";

      await create(testProviderName, { apiKey: "config-api-key" });

      expect(MockProvider.capturedConfigs[0]?.apiKey).toBe("config-api-key");
    });

    it("throws for an unregistered provider name", async () => {
      const unregisteredName = `unknown-${Math.random().toString(36).slice(2)}`;
      await expect(create(unregisteredName)).rejects.toThrow(UnknownProviderError);
      await expect(create(unregisteredName)).rejects.toThrow(
        `Unknown provider: ${unregisteredName}`,
      );
    });

    it("passes a custom baseURL to the provider constructor", async () => {
      register(MockProvider);

      await create(testProviderName, { baseURL: "https://custom.example.com" });

      expect(MockProvider.capturedConfigs[0]?.baseURL).toBe("https://custom.example.com");
    });

    it("rejects provider base URLs that are not absolute HTTP(S) URLs", async () => {
      register(MockProvider);

      for (const baseURL of ["ftp://example.com", "/relative"]) {
        await expect(create(testProviderName, { baseURL })).rejects.toThrow(
          InvalidProviderUrlError,
        );
      }

      await expect(create(testProviderName, { baseURL: "ftp://example.com" })).rejects.toThrow(
        `Invalid base URL for provider "${testProviderName}": expected an absolute http or https URL`,
      );
    });

    it("uses class metadata as the default baseURL", async () => {
      register(MockProvider);

      await create(testProviderName);

      expect(MockProvider.capturedConfigs[0]?.baseURL).toBe(MockProvider.defaultBaseURL);
    });
  });

  describe("capabilities", () => {
    it("discovers registered providers by implemented capability", async () => {
      register(MockProvider);
      register(ReadOnlyProvider);
      register(ImageOnlyProvider);
      register(ClassFieldProvider);

      expect(searchProviders()).toContain(testProviderName);
      expect(searchProviders()).toContain(testProviderName5);
      await expect(
        (await createSearchProvider(testProviderName5)).search("query"),
      ).resolves.toEqual([]);
      expect(searchProviders()).not.toContain(testProviderName3);
      expect(readProviders()).toContain(testProviderName3);
      expect(readProviders()).not.toContain(testProviderName);
      expect(searchImageProviders()).toContain(testProviderName4);
      expect(searchImageProviders()).not.toContain(testProviderName);
      expect(getProviderApiKeyEnvVar(testProviderName4)).toBeNull();
      expect(getProviderApiKeyEnvVar("custom-provider")).toBe("CUSTOM_PROVIDER_API_KEY");
    });

    it("builds capability status from registered methods and declarations", () => {
      register(MockProvider);
      register(ReadOnlyProvider);
      register(ImageOnlyProvider);
      register(ClassFieldProvider);

      expect(getProviderCapabilities(testProviderName)).toEqual({
        search: { supported: true },
        searchImage: { supported: false },
        read: { supported: false },
      });
      expect(getProviderCapabilities(testProviderName3)).toEqual({
        search: { supported: false },
        searchImage: { supported: false },
        read: { supported: true },
      });
      expect(getProviderCapabilities(testProviderName4)?.searchImage.supported).toBe(true);
      expect(getProviderCapabilities(testProviderName5)?.search.supported).toBe(true);
      expect(getProviderCapabilities("not-registered")).toBeUndefined();
    });

    it("derives pagination only from the searchPage method", () => {
      register(FalsePaginationDeclarationProvider);

      expect(getProviderCapabilities(testProviderName6)?.search).toEqual({
        supported: true,
        contentOptions: [],
        resultFields: [],
      });
    });

    it("calls a static isConfigured() on its class", () => {
      const name = `testprovider${Math.random().toString(36).slice(2)}`;
      class ThisBoundProvider extends Provider {
        static readonly providerName = name;
        static readonly defaultBaseURL = "https://bound.example.com";
        static readonly ready = true;

        constructor(config: Readonly<ProviderConfig>) {
          super(config, ThisBoundProvider);
        }

        static isConfigured(): boolean {
          return this.ready;
        }
      }
      register(ThisBoundProvider);

      expect(isProviderConfigured(name)).toBe(true);
    });

    it("probes a registered class that carries isAvailable as an instance field", async () => {
      const name = `testprovider${Math.random().toString(36).slice(2)}`;
      class FieldProbeProvider extends Provider {
        static readonly providerName = name;
        static readonly defaultBaseURL = "https://probe.example.com";
        static readonly apiKeyEnvVar = null;
        readonly isAvailable = async (): Promise<boolean> => false;

        constructor(config: Readonly<ProviderConfig>) {
          super(config, FieldProbeProvider);
        }
      }
      register(FieldProbeProvider);

      expect(probesAvailability(name)).toBe(true);
      expect(probesAvailability("brave")).toBe(false);
      expect(probesAvailability("searxng")).toBe(true);
      await expect(probeConfiguredProvider(name)).resolves.toBe(false);
    });

    it("returns a search-capable provider when required", async () => {
      register(MockProvider);

      const provider = await createSearchProvider(testProviderName);

      await expect(provider.search("query")).resolves.toEqual([]);
    });

    it("rejects a read-only provider when search is required", async () => {
      register(ReadOnlyProvider);

      await expect(createSearchProvider(testProviderName3)).rejects.toThrow(
        SearchNotSupportedError,
      );
    });

    it("keeps undeclared custom filter support distinct from ignored filters", async () => {
      register(MockProvider);

      await expect(
        searchProviderDetailed(testProviderName, "query", { includeDomains: ["example.com"] }),
      ).resolves.toMatchObject({
        provider: testProviderName,
        ignoredFilters: [],
        undeclaredFilters: ["includeDomains"],
      });
    });
  });
});
