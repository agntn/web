import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Packs the current source with the repo's own `vp pack` config, so no test trusts a stale dist/.
 * @param outDir - Directory the bundle lands in.
 */
export function packSource(outDir: string): void {
  const bin = fileURLToPath(import.meta.resolve("vite-plus/bin"));
  const { status, stderr } = spawnSync(process.execPath, [bin, "pack", "--out-dir", outDir], {
    cwd: root,
    encoding: "utf8",
  });
  if (status !== 0) throw new Error(`vp pack failed:\n${stderr}`);
}
