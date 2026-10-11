import { version } from "./version.ts";

/** How the MCP server introduces itself, kept off `mcp.ts` so the CLI skips the SDK. */
export const serverInfo = {
  name: "web",
  title: "Web",
  version,
  description: "Search the web, find pages by image, and read URLs through one set of tools.",
  websiteUrl: "https://web.agntn.dev",
};
