import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "mcp",
    description: "Run the @agntn/web MCP server over stdio",
  },
  /**
   * The server, the SDK and consola load here, because citty resolves every
   * subcommand to print `web --help`.
   *
   * stdout carries the JSON-RPC frames. consola's default reporter sends
   * anything at log level or below to that same descriptor, and `DEBUG` in the
   * environment raises the level on import, so one stray line would corrupt
   * the stream. Warnings and errors still reach stderr.
   */
  async run() {
    const [{ createMcpServer }, { StdioServerTransport }, { consola, LogLevels }] =
      await Promise.all([
        import("../mcp.ts"),
        import("@modelcontextprotocol/sdk/server/stdio.js"),
        import("consola"),
      ]);
    consola.level = LogLevels.warn;

    await createMcpServer().connect(new StdioServerTransport());
  },
});
