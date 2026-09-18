#!/usr/bin/env node

import { type ArgsDef, type CommandDef, defineCommand, runMain } from "citty";
import { normalizeMainArgs } from "./cli-args.ts";
import { WebError } from "./core/errors.ts";
import { version } from "./version.ts";

/**
 * Loads a subcommand and turns a `WebError` its handler did not translate, a spent key, a bad
 * token, a bad date, into one line on stderr and exit code 1. Anything else keeps citty's stack.
 * @param load - Imports the command module.
 * @returns {Promise<CommandDef<T>>} The command, its `run` guarded.
 */
async function command<T extends ArgsDef>(
  load: () => Promise<{ readonly default: CommandDef<T> }>,
): Promise<CommandDef<T>> {
  const loaded = (await load()).default;
  const run = loaded.run;
  if (run === undefined) return loaded;
  return {
    ...loaded,
    async run(context) {
      try {
        await run(context);
      } catch (error) {
        if (!(error instanceof WebError)) throw error;
        await reportError(error.message);
        process.exitCode = 1;
      }
    },
  };
}

/**
 * Prints one failure line the way the commands print their own, loading the reporter only now so
 * `web --version` stays light.
 * @param message - Failure text, sanitized before it reaches the terminal.
 */
async function reportError(message: string): Promise<void> {
  const [{ consola }, { sanitizeTerminalText }] = await Promise.all([
    import("consola"),
    import("./tui.ts"),
  ]);
  consola.error(sanitizeTerminalText(message, 2048));
}

const main = defineCommand({
  meta: {
    name: "web",
    version,
    description: "Unified web search and read provider for agents and CLI",
  },
  subCommands: {
    search: () => command(() => import("./commands/search.ts")),
    "search-image": () => command(() => import("./commands/search-image.ts")),
    read: () => command(() => import("./commands/read.ts")),
    providers: () => command(() => import("./commands/providers.ts")),
    mcp: () => command(() => import("./commands/mcp.ts")),
  },
});

await runMain(main, { rawArgs: [...normalizeMainArgs(process.argv.slice(2))] });
