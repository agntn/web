import { runCli } from "@agntn/tools/cli";

import { WebError } from "./core/errors.ts";
import { serverInfo } from "./server-info.ts";
import { webCommands, webTools } from "./tools.ts";
import { version } from "./version.ts";

/**
 * Runs one `web` command line: a command per tool, with `search` and `read` taking several words
 * as a batch, and a first word that names no command, or a search flag, searched for.
 * @param argv - The words after `web`.
 * @returns {Promise<void>} Once the command has written its answer and set the exit code.
 */
export async function runWebCli(argv: readonly string[]): Promise<void> {
  await runCli(
    {
      name: "web",
      version,
      description: "Unified web search and read provider for agents and CLI",
      tools: webTools(),
      commands: webCommands(),
      fallback: "search",
      mcp: serverInfo,
      expected: (error) => error instanceof WebError,
    },
    argv,
  );
}
