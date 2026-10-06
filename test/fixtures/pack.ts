import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

/** Runs obuild on the repo's own `build.config.ts`, every entry sent to the directory in argv. */
const script = `
const { build } = await import("obuild");
const { default: config } = await import("./build.config.ts");
const outDir = process.argv[1];
await build({
  ...config,
  entries: config.entries.map((entry) => (typeof entry === "string" ? entry : { ...entry, outDir })),
});
`;

/**
 * Packs the current source with `build.config.ts` in a child, which keeps obuild's report quiet.
 * @param outDir - Directory the bundle lands in.
 */
export function packSource(outDir: string): void {
  const { status, stderr } = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, outDir],
    { cwd: root, encoding: "utf8" },
  );
  if (status !== 0) throw new Error(`obuild failed:\n${stderr}`);
}
