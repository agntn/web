import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLog = vi.fn<(message: unknown) => void>();

vi.mock("consola", () => ({
  consola: {
    log: (message: unknown) => mockLog(message),
  },
}));

import providersCommand from "../../src/commands/providers.ts";
import { builtinProviders } from "../../src/index.ts";

type ProviderStatus = {
  readonly name: string;
  readonly envVar: string | null;
  readonly configured: boolean;
};

const envKeys = [
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "JINA_API_KEY",
  "TAVILY_API_KEY",
  "SERPAPI_API_KEY",
  "SERPBASE_API_KEY",
];

describe("providers command", () => {
  const savedEnv: Record<string, string | undefined> = {};
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
    });

    it("shows configured provider with checkmark when env var is set", async () => {
      process.env.EXA_API_KEY = "test-key";

      await providersCommand.run!({ args: { json: false } } as never);

      const output = mockLog.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("\u2713");
      expect(output).toContain("exa");
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

      expect(brave).toEqual({
        name: "brave",
        envVar: "BRAVE_API_KEY",
        configured: true,
      });
    });

    it("marks unconfigured providers correctly", async () => {
      await providersCommand.run!({ args: { json: true } } as never);

      const parsed = JSON.parse(writes[0] ?? "") as readonly ProviderStatus[];
      const exa = parsed.find((provider) => provider.name === "exa");

      expect(exa).toEqual({
        name: "exa",
        envVar: "EXA_API_KEY",
        configured: false,
      });
    });

    it("marks searxng as configured with null envVar", async () => {
      await providersCommand.run!({ args: { json: true } } as never);

      const parsed = JSON.parse(writes[0] ?? "") as readonly ProviderStatus[];
      const searxng = parsed.find((provider) => provider.name === "searxng");

      expect(searxng).toEqual({
        name: "searxng",
        envVar: null,
        configured: true,
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
  });
});
