import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import webExtension, { resolveWebModuleUrl } from "../../packages/pi/extensions/web.ts";
import { builtinProviders } from "../../src/index.ts";

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
      const tools = new Map<string, CapturedTool>();
      Reflect.apply(webExtension, undefined, [
        {
          registerTool(tool: CapturedTool) {
            tools.set(tool.name, tool);
          },
          registerCommand() {},
        },
      ]);
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
});
