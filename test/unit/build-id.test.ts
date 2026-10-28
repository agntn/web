import { createHash } from "node:crypto";
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createSourceBuildId } from "../../src/build-id.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/* The pre-`hashes` build id, kept as the oracle: OpenSSL fed the same pieces in the same order. */
function openSslBuildId(projectRoot: string): string {
  const paths = [
    "build.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ...globSync("tsconfig*.json", { cwd: projectRoot }),
    ...globSync("src/**/*.ts", { cwd: projectRoot }),
    ...globSync("extensions/pi/**/*.ts", { cwd: projectRoot }),
  ].sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash
      .update(path)
      .update("\0")
      .update(readFileSync(resolve(projectRoot, path)))
      .update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

/* A package root holding exactly these files. */
function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "agntn-web-build-id-"));
  scratch.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("createSourceBuildId", () => {
  it("matches the node:crypto id for this checkout", () => {
    expect(createSourceBuildId(root)).toBe(openSslBuildId(root));
  });

  it("matches the node:crypto id for empty files and non-ASCII paths and text", () => {
    const dir = project({
      "build.config.ts": "",
      "package.json": "{}",
      "pnpm-lock.yaml": "",
      "pnpm-workspace.yaml": "",
      "tsconfig.json": "{}",
      "src/zażółć.ts": "export const jaźń = '🦀';\n",
      "extensions/pi/index.ts": "a".repeat(200),
    });
    expect(createSourceBuildId(dir)).toBe(openSslBuildId(dir));
  });
});
