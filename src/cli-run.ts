import { runCli } from "@agntn/tools/cli";

import { WebError } from "./core/errors.ts";
import { serverInfo } from "./server-info.ts";
import { webCommands, webTools } from "./tools.ts";
import { version } from "./version.ts";

/** Flags the root answers itself; any other leading option opens a search. */
const ROOT_FLAGS = new Set(["-h", "--help", "-v", "--version"]);

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
    searchFirst(argv),
  );
}

/**
 * `web --provider brave "query"` searches like `web "query" --provider brave` does.
 * @param argv - The words after `web`.
 * @returns {readonly string[]} The line with `search` in front when it opens with a search flag.
 */
function searchFirst(argv: readonly string[]): readonly string[] {
  const [first] = argv;
  if (first === undefined || first === "-" || !first.startsWith("-") || ROOT_FLAGS.has(first)) {
    return argv;
  }
  return ["search", ...argv];
}
