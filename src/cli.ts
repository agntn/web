#!/usr/bin/env node

import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import type * as McpCommand from "./commands/mcp.ts";

/**
 * Narrows the module a runtime URL import returned, which TypeScript types as `any`.
 * @param value - The imported module namespace.
 * @returns {boolean} Whether it exports `serveMcp`.
 */
function isMcpModule(value: unknown): value is typeof McpCommand {
  return typeof value === "object" && value !== null && "serveMcp" in value;
}

/**
 * Loads the MCP command. A built bin inside a checkout runs the live source, as the Pi and OMP
 * extensions do, so a local server needs a restart after a change instead of a build. The npm
 * package ships no `src/commands` and keeps the bundle, and so does a copy under `node_modules`,
 * where Node refuses to strip types. `WEB_DIST=1` keeps it everywhere, for tests of the build. The
 * URL is built at runtime, because a literal import would pull the source into the bundle.
 * @returns {Promise<typeof McpCommand>} The module that starts the stdio server.
 */
async function loadMcpCommand(): Promise<typeof McpCommand> {
  // The same file from `src/cli.ts` and `dist/cli.mjs`.
  const source = new URL("../src/commands/mcp.ts", import.meta.url);
  const sourcePath = fileURLToPath(source);
  const fromSource =
    !import.meta.url.endsWith(".ts") &&
    process.env.WEB_DIST !== "1" &&
    !sourcePath.includes(`${sep}node_modules${sep}`) &&
    existsSync(sourcePath);
  if (!fromSource) return import("./commands/mcp.ts");
  const module: unknown = await import(source.href);
  if (!isMcpModule(module)) throw new TypeError(`${sourcePath} has no serveMcp`);
  return module;
}

const argv = process.argv.slice(2);

/** `web mcp` serves straight away, and a stray flag from a client config doesn't stop it. */
const servesMcp = argv[0] === "mcp" && !argv.some((word) => word === "--help" || word === "-h");

if (servesMcp) {
  await (await loadMcpCommand()).serveMcp();
} else {
  await (await import("./cli-run.ts")).runWebCli(argv);
}
