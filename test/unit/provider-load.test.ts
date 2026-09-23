import { describe, expect, it, vi } from "vite-plus/test";
import { WebError } from "../../src/core/errors.ts";
import type { ProviderConstructor } from "../../src/core/provider.ts";
import { createReadProvider } from "../../src/core/registry.ts";
import type { ProviderConfig } from "../../src/core/types.ts";

/** What the mocked Jina module exports; `undefined` is the namespace a re-entered import hands back. */
const jina = vi.hoisted(() => ({ provider: undefined as ProviderConstructor | undefined }));

vi.mock("../../src/providers/jina.ts", () => ({
  get JinaProvider() {
    return jina.provider;
  },
}));

describe("provider loading", () => {
  it("names the provider whose module resolves to no class, then loads it on the next call", async () => {
    const failure = createReadProvider("jina");
    await expect(failure).rejects.toBeInstanceOf(WebError);
    await expect(failure).rejects.toThrow('Provider "jina" did not load a provider class');

    const { Provider } = await import("../../src/core/provider.ts");
    class JinaStub extends Provider {
      static readonly providerName = "jina";
      static readonly defaultBaseURL = "https://r.jina.ai";

      constructor(config: Readonly<ProviderConfig>) {
        super(config, JinaStub);
      }

      async read(url: string) {
        return { url, content: "Loaded" };
      }
    }
    jina.provider = JinaStub;

    await expect(createReadProvider("jina")).resolves.toBeInstanceOf(JinaStub);
  });
});
