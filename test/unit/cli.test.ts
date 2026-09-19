import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, it } from "vitest";

const execute = promisify(execFile);
const hook = fileURLToPath(new URL("../fixtures/record-loads.mjs", import.meta.url));

interface Failure {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

/*
 * A failed command rejects with its streams attached, so the test reads what a script would see.
 * Every case fails before a request, and the blank keys keep it that way. consola prints its plain
 * reporter under NODE_ENV=test, so the line reads `[error] ...` here and ` ERROR  ...` in a shell.
 */
async function failure(...args: readonly string[]): Promise<Failure> {
  try {
    await execute(process.execPath, ["src/cli.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, BRAVE_API_KEY: "", EXA_API_KEY: "", NODE_ENV: "test" },
    });
  } catch (error) {
    const { code, stderr, stdout } = error as Failure;
    return { code, stderr, stdout };
  }
  throw new Error(`web ${args.join(" ")} exited 0`);
}

describe.concurrent("web CLI", () => {
  it("prints a bad continuation token as one line and exits 1", async ({ expect }) => {
    await expect(
      failure("search", "query", "--provider", "brave", "--continuation", "garbage", "--json"),
    ).resolves.toEqual({
      code: 1,
      stdout: "",
      stderr: "[error] Invalid search continuation token\n",
    });
  });

  it("keeps a date filter with a line break and an escape on one line", async ({ expect }) => {
    await expect(
      failure(
        "search",
        "query",
        "--provider",
        "brave",
        "--start-published-date",
        "foo\n\u001B[31mx",
      ),
    ).resolves.toEqual({
      code: 1,
      stdout: "",
      stderr:
        '[error] Invalid date filter startPublishedDate="foo x": must be ISO 8601 (e.g. "2024-01-01" or "2024-01-01T00:00:00Z")\n',
    });
  });

  it("refuses a continuation token for a fan-out before searching", async ({ expect }) => {
    await expect(
      failure("search", "query", "--provider", "all", "--continuation", "token"),
    ).resolves.toEqual({
      code: 1,
      stdout: "",
      stderr: "[error] --continuation is not supported with --provider all.\n",
    });
  });

  it("refuses a continuation token for a batch before searching", async ({ expect }) => {
    await expect(
      failure("search", "first", "second", "--provider", "brave", "--continuation", "token"),
    ).resolves.toEqual({
      code: 1,
      stdout: "",
      stderr: "[error] --continuation is only supported for a single query.\n",
    });
  });
});

interface Run {
  readonly code: number;
  readonly loaded: readonly string[];
  readonly stdout: string;
}

/**
 * Runs the CLI under the load hook with stdin closed, because the server reads stdin until it ends,
 * and kills it after ten seconds so a server that stops exiting on EOF fails here instead of outliving CI.
 * The blank Brave key keeps a search on that provider off the network.
 * @param args - Arguments for `web`.
 * @returns {Promise<Run>} The exit code, stdout and every module URL the run loaded.
 */
async function run(...args: readonly string[]): Promise<Run> {
  const pending = execute(process.execPath, ["--import", hook, "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, BRAVE_API_KEY: "", NODE_ENV: "test" },
    timeout: 10_000,
  });
  pending.child.stdin?.end();
  const { code, stderr, stdout } = await pending.then(
    (streams) => ({ code: 0, ...streams }),
    (error: unknown) => error as Failure,
  );
  const report = /@loaded (\[.*\])/u.exec(stderr)?.[1];
  if (report === undefined) throw new Error(`the load hook reported nothing: ${stderr}`);
  return { code, loaded: JSON.parse(report) as string[], stdout };
}

/**
 * The package a module URL sits in. pnpm's store nests node_modules, so the last one counts.
 * @param url - A module URL the load hook reported.
 * @returns {string | undefined} The package name, or undefined outside node_modules.
 */
function packageOf(url: string): string | undefined {
  const at = url.lastIndexOf("/node_modules/");
  if (at < 0) return undefined;
  const [scope = "", name = ""] = url.slice(at + "/node_modules/".length).split("/");
  return scope.startsWith("@") ? `${scope}/${name}` : scope;
}

describe.concurrent("web usage paths", () => {
  it.for([
    { args: ["--help"], code: 0, usage: /USAGE.*web search\|search-image\|read\|providers\|mcp/u },
    { args: ["-h"], code: 0, usage: /USAGE.*web search\|search-image\|read\|providers\|mcp/u },
    { args: ["mcp", "--help"], code: 0, usage: /USAGE.*web mcp/u },
    { args: [], code: 1, usage: /USAGE.*web search\|search-image\|read\|providers\|mcp/u },
  ])(
    "web $args prints the usage without the server or a provider",
    async ({ args, code, usage }, { expect }) => {
      const { code: exit, loaded, stdout } = await run(...args);
      expect(exit).toBe(code);
      expect(stdout).toMatch(usage);
      const packages = new Set(loaded.map(packageOf));
      expect(packages).toContain("citty");
      expect(packages).not.toContain("@modelcontextprotocol/sdk");
      expect(packages).not.toContain("typebox");
      expect(packages).not.toContain("ofetch");
      expect(loaded.filter((url) => /\/src\/(providers\/|mcp\.ts)/u.test(url))).toEqual([]);
    },
  );

  it("web mcp loads the server and the manifest once it runs", async ({ expect }) => {
    const { code, loaded } = await run("mcp");
    expect(code).toBe(0);
    const packages = new Set(loaded.map(packageOf));
    expect(packages).toContain("@modelcontextprotocol/sdk");
    expect(loaded.some((url) => url.endsWith("/src/providers/index.ts"))).toBe(true);
    expect(providerModules(loaded)).toEqual([]);
  });
});

/**
 * The provider modules a run loaded, by name, so a test can say which adapters a command needs.
 * @param loaded - Every module URL the load hook reported.
 * @returns {string[]} Provider names under `src/providers/`, the manifest excluded.
 */
function providerModules(loaded: readonly string[]): string[] {
  return loaded.flatMap((url) => {
    const name = /\/src\/providers\/([a-z-]+)\.ts$/u.exec(url)?.[1];
    return name === undefined || name === "index" ? [] : [name];
  });
}

describe.concurrent("web data paths", () => {
  it("web providers lists every adapter from the manifest without loading one", async ({
    expect,
  }) => {
    const { code, loaded, stdout } = await run("providers", "--json");
    expect(code).toBe(0);
    expect((JSON.parse(stdout) as { name: string }[]).map((row) => row.name)).toHaveLength(12);
    expect(loaded.some((url) => url.endsWith("/src/providers/index.ts"))).toBe(true);
    expect(providerModules(loaded)).toEqual([]);
  });

  it("web search loads the one adapter the provider flag names", async ({ expect }) => {
    const { code, loaded } = await run("search", "query", "--provider", "brave");
    expect(code).toBe(1);
    expect(providerModules(loaded)).toEqual(["brave"]);
  });
});
