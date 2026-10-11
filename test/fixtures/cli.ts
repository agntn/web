import { vi } from "vite-plus/test";

import { runWebCli } from "../../src/cli-run.ts";

/** What one `web` command line printed and the exit code it set. */
export interface CliRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * Runs `web` in this process, so a stubbed `fetch` and the test env reach the providers, and
 * collects what it printed instead of letting it reach the terminal.
 * @param argv - The words after `web`.
 * @returns {Promise<CliRun>} Both streams and the exit code.
 */
export async function runWeb(...argv: readonly string[]): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    await runWebCli(argv);
    return {
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      code: Number(process.exitCode ?? 0),
    };
  } finally {
    out.mockRestore();
    err.mockRestore();
    process.exitCode = previous;
  }
}
