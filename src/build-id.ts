import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Hashes every shipped TypeScript source plus the package and build contracts.
 * @param {string} projectRoot - Absolute package root.
 * @returns {string} Twelve hexadecimal characters from the source SHA-256.
 */
export function createSourceBuildId(projectRoot: string): string {
  const paths = [
    "build.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ...globSync("tsconfig*.json", { cwd: projectRoot }),
    ...globSync("src/**/*.ts", { cwd: projectRoot }),
    ...globSync("packages/pi/extensions/**/*.ts", { cwd: projectRoot }),
  ].sort();
  const hash = createHash("sha256");

  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(resolve(projectRoot, path)));
    hash.update("\0");
  }

  return hash.digest("hex").slice(0, 12);
}
