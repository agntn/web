#!/usr/bin/env node

import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type ArgsDef, type CommandDef, defineCommand, type Resolvable, runMain } from "citty";
import { normalizeMainArgs } from "./cli-args.ts";
import type McpCommand from "./commands/mcp.ts";
import { WebError } from "./core/errors.ts";
import { version } from "./version.ts";

/**
 * Settles a command field citty lets be a value, a promise, or a function returning either.
 * @param value - The field as the command declares it.
 * @returns {Promise<Readonly<T>>} Its value.
 */
async function settle<T>(value: Readonly<Resolvable<T>>): Promise<Readonly<T>> {
  return typeof value === "function" ? (value as () => T | Promise<T>)() : (value as Readonly<T>);
}

/** The part of an argument definition the check reads. */
type Declared = Readonly<{ type?: string; alias?: string | readonly string[] }>;

/**
 * Names the options on the command line that the command does not declare. citty 0.2 parses
 * without `strict` and keeps them as keys, so `read <url> --bogus` would read the page and exit 0.
 * A declared option may arrive under its name, an alias, or the camelCase spelling citty adds for a
 * kebab name, `maxResults` for `max-results`. Positionals parse under their own names, and extra
 * ones stay allowed, because `search` and `read` take several.
 * @param name - The command, for the message.
 * @param defs - The arguments the command declares.
 * @param context - What citty parsed, and the arguments it parsed them from.
 * @returns {string | undefined} The failure line, or undefined when every option is declared.
 */
function undeclaredOptions(
  name: string,
  defs: Readonly<Record<string, Declared>>,
  context: Readonly<{ args: Readonly<Record<string, unknown>>; rawArgs: readonly string[] }>,
): string | undefined {
  const entries = Object.entries(defs);
  const known = new Set(
    entries.flatMap(([key, def]) => [
      key,
      key.replaceAll(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()),
      ...(def.alias === undefined ? [] : [def.alias].flat()),
    ]),
  );
  const unknown = Object.keys(context.args)
    .filter((key) => key !== "_" && !known.has(key))
    .map((key) => {
      if (key.length === 1) return `-${key}`;
      // citty strips the `no-` of a negated flag, so `--no-cahce` parses as `cahce`.
      return context.rawArgs.includes(`--no-${key}`) ? `--no-${key}` : `--${key}`;
    });
  if (unknown.length === 0) return undefined;
  const takes = entries.filter(([, def]) => def.type !== "positional").map(([key]) => `--${key}`);
  return `Unknown option${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}; web ${name} takes ${takes.join(", ")}`;
}

/**
 * Loads a subcommand and turns a `WebError` its handler did not translate, a spent key, a bad
 * token, a bad date, into one line on stderr and exit code 1. An option the command does not
 * declare ends the same way before it runs; `mcp` declares none and stays open, so a stray flag in
 * an MCP client config does not stop the server. Anything else keeps citty's stack.
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
      if (loaded.args !== undefined) {
        const meta = loaded.meta === undefined ? undefined : await settle(loaded.meta);
        const refusal = undeclaredOptions(meta?.name ?? "", await settle(loaded.args), context);
        if (refusal !== undefined) {
          await reportError(refusal);
          process.exitCode = 1;
          return;
        }
      }
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

/**
 * Narrows the module a runtime URL import returned, which TypeScript types as `any`.
 * @param value - The imported module namespace.
 * @returns {boolean} Whether it exports a default command.
 */
function isMcpModule(value: unknown): value is { readonly default: typeof McpCommand } {
  return typeof value === "object" && value !== null && "default" in value;
}

/**
 * Loads the MCP command. A built bin inside a checkout runs the live source, as the Pi and OMP
 * extensions do, so a local server needs a restart after a change instead of `vp pack`. The npm
 * package ships no `src/commands` and keeps the bundle, and so does a copy under `node_modules`,
 * where Node refuses to strip types. `WEB_DIST=1` keeps it everywhere, for tests of the build. The
 * URL is built at runtime, because a literal import would pull the source into the bundle.
 * @returns {Promise<{ readonly default: typeof McpCommand }>} The module whose default command
 * starts the stdio server.
 */
async function loadMcpCommand(): Promise<{ readonly default: typeof McpCommand }> {
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
  if (!isMcpModule(module)) throw new TypeError(`${sourcePath} has no default command`);
  return module;
}

/**
 * Ends the process once the reader of stdout or stderr is gone, as after `| head -1` or a pager that
 * quits early. Node ignores SIGPIPE, so without a listener the next write throws `EPIPE` with a stack
 * trace. The exit code stays whatever the command set.
 * @param error - The error the stream emitted.
 */
function exitOnClosedPipe(error: Readonly<NodeJS.ErrnoException>): void {
  if (error.code !== "EPIPE") throw error;
  process.exit();
}

process.stdout.on("error", exitOnClosedPipe);
process.stderr.on("error", exitOnClosedPipe);

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
    mcp: () => command(loadMcpCommand),
  },
});

await runMain(main, { rawArgs: [...normalizeMainArgs(process.argv.slice(2))] });
