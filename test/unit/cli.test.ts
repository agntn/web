import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, it } from "vite-plus/test";
import { builtinProviders } from "../../src/core/providers.ts";

const execute = promisify(execFile);
const hook = fileURLToPath(new URL("../fixtures/record-loads.mjs", import.meta.url));

interface Failure {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

/*
 * A failed command rejects with its streams attached, so the test reads what a script would see.
 * Every case fails before a request, and the blank keys keep it that way.
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
      stderr: "Invalid search continuation token\n",
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
        'Invalid date filter startPublishedDate="foo x": must be ISO 8601 (e.g. "2024-01-01" or "2024-01-01T00:00:00Z")\n',
    });
  });

  it("refuses a continuation token for a fan-out before searching", async ({ expect }) => {
    await expect(
      failure("search", "query", "--provider", "all", "--continuation", "token"),
    ).resolves.toEqual({
      code: 1,
      stdout: "",
      stderr: "continuation is not supported with provider=all\n",
    });
  });

  it("refuses a continuation token for a batch before searching", async ({ expect }) => {
    await expect(
      failure("search", "first", "second", "--provider", "brave", "--continuation", "token"),
    ).resolves.toEqual({
      code: 1,
      stdout: "",
      stderr: "continuation is only supported for a single query\n",
    });
  });

  it("refuses an option the command does not declare instead of running without it", async ({
    expect,
  }) => {
    await expect(failure("providers", "--bogus")).resolves.toEqual({
      code: 1,
      stdout: "",
      stderr: 'Invalid arguments: unknown option "--bogus"; takes --json\n',
    });
    await expect(failure("search-image", "https://example.com/a.jpg", "-x")).resolves.toEqual({
      code: 1,
      stdout: "",
      stderr: 'Invalid arguments: unknown option "-x"; takes --provider, --max-results, --json\n',
    });
  });

  it("names a misspelled negated flag the way it was typed", async ({ expect }) => {
    await expect(
      failure("read", "https://example.com", "--provider", "exa", "--no-cahce"),
    ).resolves.toEqual({
      code: 1,
      stdout: "",
      stderr:
        'Invalid arguments: unknown option "--no-cahce"; takes --provider, --format, --max-tokens, --max-chars, --continuation, --links, --images, --target-selector, --remove-selector, --timeout, --timeout-seconds, --cache, --json\n',
    });
  });

  it("names a misspelled flag rather than searching for the value it left behind", async ({
    expect,
  }) => {
    const result = await failure("query", "--provider", "brave", "--max-reslts", "3", "--typo=1");

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^Invalid arguments: unknown option "--max-reslts"; takes /u);
    expect(result.stderr).toMatch(/\nInvalid arguments: unknown option "--typo=1"; takes /u);
  });

  it("takes the kebab spellings, short of a value for a flag", async ({ expect }) => {
    await expect(
      failure(
        "search",
        "query",
        "--max-results=3",
        "--no-highlights",
        "--full-text",
        "--provider",
        "brave",
        "--continuation",
        "garbage",
      ),
    ).resolves.toEqual({
      code: 1,
      stdout: "",
      stderr: "Invalid search continuation token\n",
    });
  });
});

interface Run {
  readonly code: number;
  readonly loaded: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
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
  return { code, loaded: JSON.parse(report) as string[], stdout, stderr };
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
    { args: ["--help"], code: 0, usage: /USAGE web <command>[\s\S]*search-image/u },
    { args: ["-h"], code: 0, usage: /USAGE web <command>[\s\S]*search-image/u },
    { args: ["mcp", "--help"], code: 0, usage: /USAGE web mcp/u },
    { args: [], code: 1, usage: /USAGE web <command>[\s\S]*search-image/u },
  ])(
    "web $args prints the usage without the server or a provider",
    async ({ args, code, usage }, { expect }) => {
      const { code: exit, loaded, stdout, stderr } = await run(...args);
      expect(exit).toBe(code);
      expect(`${stdout}${stderr}`).toMatch(usage);
      const packages = new Set(loaded.map(packageOf));
      expect(packages).toContain("@agntn/tools");
      expect(packages).not.toContain("@modelcontextprotocol/server");
      expect(packages).not.toContain("typebox");
      expect(
        loaded.filter((url) => /\/src\/(providers\/|mcp\.ts|core\/client\.ts)/u.test(url)),
      ).toEqual([]);
      expect(coreModules(loaded)).toEqual([
        "errors",
        "hidden-kinds",
        "limits",
        "providers",
        "redaction",
        "text",
        "types",
      ]);
    },
  );

  it("web mcp loads the server and leaves the providers to the first call", async ({ expect }) => {
    const { code, loaded } = await run("mcp");
    expect(code).toBe(0);
    const packages = new Set(loaded.map(packageOf));
    expect(packages).toContain("@modelcontextprotocol/server");
    expect(packages).not.toContain("string-width");
    expect(loaded.some((url) => url.endsWith("/src/providers/index.ts"))).toBe(false);
    expect(providerModules(loaded)).toEqual([]);
  });

  it("web mcp ignores a stray flag from a client config", async ({ expect }) => {
    const { code, loaded } = await run("mcp", "--bogus");
    expect(code).toBe(0);
    expect(new Set(loaded.map(packageOf))).toContain("@modelcontextprotocol/server");
  });
});

/**
 * The core modules a run loaded, so a usage path proves it stopped at the data the schemas need.
 * @param loaded - Every module URL the load hook reported.
 * @returns {string[]} Module names under `src/core/`, sorted.
 */
function coreModules(loaded: readonly string[]): string[] {
  return loaded.flatMap((url) => /\/src\/core\/([a-z-]+)\.ts$/u.exec(url)?.[1] ?? []).sort();
}

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
  it("web providers lists every adapter from the manifest and loads only the one it probes", async ({
    expect,
  }) => {
    const { code, loaded, stdout } = await run("providers", "--json");
    expect(code).toBe(0);
    const { providers } = (JSON.parse(stdout) as { result: { providers: { name: string }[] } })
      .result;
    expect(providers.map((row) => row.name)).toEqual([...builtinProviders]);
    expect(loaded.some((url) => url.endsWith("/src/providers/index.ts"))).toBe(true);
    expect(providerModules(loaded)).toEqual(["searxng"]);
  });

  it("web search loads the one adapter the provider flag names", async ({ expect }) => {
    const { code, loaded } = await run("search", "query", "--provider", "brave");
    expect(code).toBe(1);
    expect(providerModules(loaded)).toEqual(["brave"]);
  });

  it("web search refuses an undeclared flag before it loads the adapter", async ({ expect }) => {
    const { code, loaded, stdout } = await run("search", "query", "--provider", "brave", "--bogus");
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(providerModules(loaded)).toEqual([]);
  });
});

interface Closed {
  readonly code: number | null;
  readonly output: string;
}

/**
 * Runs the CLI with one of its output streams closed before the first write, as after `| head -1`
 * or a pager that quits early, and collects what reached the other one.
 * @param closed - The stream whose reader goes away.
 * @param args - Arguments for `web`.
 * @returns {Promise<Closed>} The exit code and the text on the stream left open.
 */
async function closedPipe(
  closed: "stdout" | "stderr",
  ...args: readonly string[]
): Promise<Closed> {
  const child = spawn(process.execPath, ["src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, BRAVE_API_KEY: "", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  child[closed].destroy();
  let output = "";
  child[closed === "stdout" ? "stderr" : "stdout"]
    .setEncoding("utf8")
    .on("data", (chunk: string) => (output += chunk));
  await once(child, "close");
  return { code: child.exitCode, output };
}

describe.concurrent("web with a closed pipe", () => {
  it.for([{ args: ["providers"] }, { args: ["providers", "--json"] }])(
    "web $args ends quietly when stdout closes",
    async ({ args }, { expect }) => {
      await expect(closedPipe("stdout", ...args)).resolves.toEqual({ code: 0, output: "" });
    },
  );

  it("keeps exit code 1 when stderr closes under a failure", async ({ expect }) => {
    await expect(
      closedPipe("stderr", "search", "query", "--provider", "brave", "--continuation", "garbage"),
    ).resolves.toEqual({ code: 1, output: "" });
  });
});
