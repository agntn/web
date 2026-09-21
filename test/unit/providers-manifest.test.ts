import { readdirSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { builtins } from "../../src/providers/index.ts";
import { builtinProviders } from "../../src/core/providers.ts";
import { imageSearchProviderNames } from "../../src/core/image.ts";
import { readProviderNames } from "../../src/core/read.ts";
import {
  isAvailabilityProvider,
  isImageSearchProvider,
  isPaginatedSearchProvider,
  isReadProvider,
  isSearchProvider,
} from "../../src/core/provider.ts";

describe("provider manifest", () => {
  it("should list every provider file in builtinProviders order", () => {
    const files = readdirSync(new URL("../../src/providers/", import.meta.url))
      .filter((file) => file.endsWith(".ts") && file !== "index.ts")
      .map((file) => file.slice(0, -".ts".length))
      .sort();

    expect(builtins.map((entry) => entry.name)).toEqual([...builtinProviders]);
    expect(files).toEqual([...builtinProviders]);
  });

  /** The manifest carries the metadata, so a class whose methods drifted from its entry would answer create() with an operation the listing denies, or deny one it has. */
  it("should declare exactly the operations each class implements", async () => {
    for (const entry of builtins) {
      const ProviderClass = await entry.load();
      const prototype = ProviderClass.prototype;
      expect(ProviderClass.providerName).toBe(entry.name);
      expect(isSearchProvider(prototype), `${entry.name} search`).toBe(entry.search !== undefined);
      expect(isReadProvider(prototype), `${entry.name} read`).toBe(entry.read !== undefined);
      expect(isImageSearchProvider(prototype), `${entry.name} searchImage`).toBe(
        entry.searchImage !== undefined,
      );
      expect(isPaginatedSearchProvider(prototype), `${entry.name} pagination`).toBe(
        entry.search?.pagination === true,
      );
      expect(isAvailabilityProvider(prototype), `${entry.name} availability`).toBe(
        entry.availability === true,
      );
    }
  });

  it("should keep the static capability lists in step with the manifest", () => {
    const named = (capability: "read" | "searchImage") =>
      builtins.filter((entry) => entry[capability] !== undefined).map((entry) => entry.name);

    expect([...readProviderNames].sort()).toEqual(named("read").sort());
    expect([...imageSearchProviderNames].sort()).toEqual(named("searchImage").sort());
  });
});
