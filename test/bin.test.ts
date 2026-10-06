import { execFile } from "node:child_process";
import {
  cpSync,
  globSync,
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
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vite-plus/test";
import { packSource } from "./fixtures/pack.ts";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const hook = fileURLToPath(new URL("fixtures/record-loads.mjs", import.meta.url));
/** The dist/ packed from the current source, never the checkout's own. */
let packed = "";

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
 * Copies the named checkout entries and the freshly packed dist/ into a new directory.
 * @param parent - Directory to create the copy in.
 * @param entries - Paths relative to the repo root, besides `dist`.
 * @returns {string} The copy, removed when the test finishes.
 */
function copyOf(parent: string, entries: readonly string[]): string {
  mkdirSync(parent, { recursive: true });
  const copy = mkdtempSync(join(parent, "web-bin-"));
  onTestFinished(() => rmSync(copy, { recursive: true, force: true }));
  cpSync(packed, join(copy, "dist"), { recursive: true });
  for (const entry of entries) cpSync(join(root, entry), join(copy, entry), { recursive: true });
  return copy;
}

/**
 * A checkout outside node_modules: packed dist/ next to every file `createSourceBuildId` hashes.
 * @returns {string} The checkout, removed when the test finishes.
 */
function checkout(): string {
  const copy = copyOf(tmpdir(), [
    "src",
    "packages/pi/extensions",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "build.config.ts",
    ...globSync("tsconfig*.json", { cwd: root }),
  ]);
  symlinkSync(join(root, "node_modules"), join(copy, "node_modules"));
  return copy;
}

describe("built bin", () => {
  beforeAll(() => {
    packed = mkdtempSync(join(tmpdir(), "web-bin-dist-"));
    packSource(packed);
  });

  afterAll(() => {
    if (packed) rmSync(packed, { recursive: true, force: true });
  });

  it("serves mcp from src/ inside the checkout", async () => {
    const copy = checkout();
    const source = pathToFileURL(join(copy, "src/")).href;
    const loaded = await mcpLoads(join(copy, "dist/cli.mjs"));
    expect(loaded).toContain(`${source}commands/mcp.ts`);
    expect(loaded).toContain(`${source}mcp.ts`);
    expect(loaded).not.toContain(pathToFileURL(join(copy, "dist/mcp.mjs")).href);
  });

  it("keeps the bundle under WEB_DIST=1", async () => {
    const copy = checkout();
    const loaded = await mcpLoads(join(copy, "dist/cli.mjs"), { WEB_DIST: "1" });
    expect(loaded.filter((url) => url.startsWith(pathToFileURL(join(copy, "src/")).href))).toEqual(
      [],
    );
    expect(loaded).toContain(pathToFileURL(join(copy, "dist/mcp.mjs")).href);
  });

  it("keeps the bundle in a copy under node_modules, where Node strips no types", async () => {
    const copy = copyOf(join(root, "node_modules/.cache"), ["src", "package.json"]);
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
    const copy = copyOf(tmpdir(), [
      ...manifest.files.filter((file) => file !== "dist"),
      "package.json",
    ]);
    symlinkSync(join(root, "node_modules"), join(copy, "node_modules"));
    const loaded = await mcpLoads(join(copy, "dist/cli.mjs"));
    expect(loaded).toContain(pathToFileURL(join(copy, "dist/mcp.mjs")).href);
  });
});
