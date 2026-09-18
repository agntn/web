import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it } from "vitest";

const execute = promisify(execFile);

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
