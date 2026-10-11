import { Client as McpClient, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { searchTool } from "../../src/ai.ts";
import { createMcpServer } from "../../src/mcp.ts";
import { runWeb } from "../fixtures/cli.ts";
import { completedEvents, sse } from "../fixtures/codex.ts";

beforeEach(() => {
  vi.stubEnv("OPENAI_CODEX_ACCESS_TOKEN", "test-token");
  vi.stubEnv("OPENAI_CODEX_ACCOUNT_ID", "test-account");
  vi.stubGlobal("fetch", async () => sse(completedEvents()));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Codex public transports", () => {
  it("runs CLI search with environment credentials and JSON output", async () => {
    const { stdout, code } = await runWeb(
      "search",
      "public query",
      "--provider",
      "openai-codex",
      "--summary",
      "--json",
    );
    expect(code).toBe(0);
    const output: unknown = JSON.parse(stdout);
    expect(output).toHaveProperty("result");
    expect((output as { result: unknown }).result).toMatchObject({
      provider: "openai-codex",
      results: [
        { url: "https://example.com/", snippet: "" },
        { url: "https://other.example/page", snippet: "" },
      ],
      metadata: { answer: "Generated answer with a citation. https://invented.example/" },
    });
  });

  it("exposes sources and generated answer through the AI SDK tool", async () => {
    if (!searchTool.execute) throw new Error("Missing AI SDK executor");
    const output = await searchTool.execute(
      { query: "public query", provider: "openai-codex", summary: true },
      { toolCallId: "codex-test", messages: [], context: {} },
    );
    expect(output).toHaveProperty("text");
    expect((output as { result: unknown }).result).toMatchObject({
      provider: "openai-codex",
      results: [{ url: "https://example.com/" }, { url: "https://other.example/page" }],
      metadata: { answer: "Generated answer with a citation. https://invented.example/" },
    });
  });

  it("discovers Codex and runs search over the MCP client/server transport", async () => {
    const server = createMcpServer();
    const client = new McpClient({ name: "codex-test", version: "1.0.0" });
    try {
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools();
      expect(JSON.stringify(tools.tools.find((tool) => tool.name === "web_search"))).toContain(
        "openai-codex",
      );
      const response = await client.callTool({
        name: "web_search",
        arguments: { query: "public query", provider: "openai-codex", summary: true },
      });
      expect(response.isError).not.toBe(true);
      const content = JSON.stringify(response.content);
      expect(content).toContain("https://example.com/");
      expect(content).toContain("Generated answer with a citation.");
      expect(content).not.toContain("test-token");
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
