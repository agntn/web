import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, onTestFinished } from "vite-plus/test";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const hook = fileURLToPath(new URL("fixtures/record-loads.mjs", import.meta.url));

/**
 * Runs `mcp` from a built bin under the load hook with stdin closed, so the server ends as soon as
 * it has started. An inherited WEB_DIST is dropped, so only `environment` sets it.
 * @param bin - Path to a `dist/cli.mjs`.
 * @param environment - Extra environment for the run.
 * @returns {Promise<string[]>} Every module URL the run loaded.
 */
async function mcpLoads(
  bin: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<string[]> {
  const { WEB_DIST: _inherited, ...inherited } = process.env;
  const pending = execute(process.execPath, ["--import", hook, bin, "mcp"], {
    cwd: root,
    env: { ...inherited, ...environment },
    timeout: 10_000,
  });
  pending.child.stdin?.end();
  const { stderr } = await pending;
  const report = /@loaded (\[.*\])/u.exec(stderr)?.[1];
  if (report === undefined) throw new Error(`the load hook reported nothing: ${stderr}`);
  return JSON.parse(report) as string[];
}

/**
 * Copies the named entries of the checkout into a fresh directory.
 * @param parent - Directory to create the copy in.
 * @param entries - Paths relative to the repo root.
 * @returns {string} The copy, removed when the test finishes.
 */
function copyOf(parent: string, entries: readonly string[]): string {
  mkdirSync(parent, { recursive: true });
  const copy = mkdtempSync(join(parent, "web-bin-"));
  onTestFinished(() => rmSync(copy, { recursive: true, force: true }));
  for (const entry of entries) cpSync(join(root, entry), join(copy, entry), { recursive: true });
  return copy;
}

describe.skipIf(!existsSync(join(root, "dist/cli.mjs")))("built bin", () => {
  const source = pathToFileURL(join(root, "src/")).href;
  const bundledMcp = pathToFileURL(join(root, "dist/mcp.mjs")).href;
  const bin = join(root, "dist/cli.mjs");

  it("serves mcp from src/ inside the checkout", async () => {
    const loaded = await mcpLoads(bin);
    expect(loaded).toContain(`${source}commands/mcp.ts`);
    expect(loaded).toContain(`${source}mcp.ts`);
    expect(loaded).not.toContain(bundledMcp);
  });

  it("keeps the bundle under WEB_DIST=1", async () => {
    const loaded = await mcpLoads(bin, { WEB_DIST: "1" });
    expect(loaded.filter((url) => url.startsWith(source))).toEqual([]);
    expect(loaded).toContain(bundledMcp);
  });

  it("keeps the bundle in a copy under node_modules, where Node strips no types", async () => {
    const copy = copyOf(join(root, "node_modules/.cache"), ["dist", "src", "package.json"]);
    const loaded = await mcpLoads(join(copy, "dist/cli.mjs"));
    expect(loaded.filter((url) => url.startsWith(pathToFileURL(join(copy, "src/")).href))).toEqual(
      [],
    );
    expect(loaded).toContain(pathToFileURL(join(copy, "dist/mcp.mjs")).href);
  });

  it("keeps the bundle when src/commands is missing, as in the npm package", async () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      readonly files: readonly string[];
    };
    const copy = copyOf(tmpdir(), [...manifest.files, "package.json"]);
    symlinkSync(join(root, "node_modules"), join(copy, "node_modules"));
    const loaded = await mcpLoads(join(copy, "dist/cli.mjs"));
    expect(loaded).toContain(pathToFileURL(join(copy, "dist/mcp.mjs")).href);
  });
});
