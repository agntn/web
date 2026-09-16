import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "obuild";
import { describe, expect, it, onTestFinished } from "vitest";
import { builtinProviders } from "../src/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const entry = "test/fixtures/bundle-entry.mjs";

describe("bundled package", () => {
  it.skipIf(!existsSync(join(root, "dist/index.mjs")))(
    "keeps every built-in provider registered after a consumer bundles dist/",
    async () => {
      mkdirSync(join(root, "node_modules/.cache"), { recursive: true });
      const outDir = mkdtempSync(join(root, "node_modules/.cache/web-bundle-"));
      onTestFinished(() => rmSync(outDir, { recursive: true, force: true }));

      await build({
        cwd: root,
        entries: [
          {
            type: "bundle",
            input: `./${entry}`,
            outDir: relative(root, outDir),
            dts: false,
            license: false,
          },
        ],
        hooks: {
          /**
           * obuild keeps every module's side effects while it builds a library; a consumer's bundler trusts package.json instead.
           * @param {InputOptions} config - Rolldown options obuild assembled for the entry.
           */
          rolldownConfig(config) {
            config.treeshake = true;
          },
        },
      });

      const bundle = (await import(pathToFileURL(join(outDir, entry)).href)) as Pick<
        typeof import("../src/index.ts"),
        "providers"
      >;

      expect(bundle.providers().sort()).toEqual([...builtinProviders].sort());
    },
  );
});
