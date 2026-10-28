import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Sha256Hasher } from "@agntn/hashes/sha2";

const separator = new Uint8Array(1);

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
    ...globSync("extensions/pi/**/*.ts", { cwd: projectRoot }),
  ].sort();
  const hash = new Sha256Hasher();

  for (const path of paths) {
    hash.update(Buffer.from(path)).update(separator);
    hash.update(readFileSync(resolve(projectRoot, path))).update(separator);
  }

  return Buffer.from(hash.digest()).toString("hex").slice(0, 12);
}
