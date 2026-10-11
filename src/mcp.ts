import type { Server } from "@modelcontextprotocol/server";
import { createMcpServer as createToolServer } from "@agntn/tools/mcp";

import { serverInfo } from "./server-info.ts";
import { webTools } from "./tools.ts";

/**
 * Creates the unconnected MCP server with the same four tools Pi, OMP, the AI SDK and the CLI get.
 * Each answer carries the model text and, as `structuredContent`, the data under `result`. A
 * provider module loads with the first call that names it.
 * @returns {Server} Unconnected MCP server.
 */
export function createMcpServer(): Server {
  return createToolServer(serverInfo, webTools());
}
