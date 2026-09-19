import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "obuild";
import { describe, expect, it, onTestFinished } from "vitest";
import { builtinProviders } from "../src/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const registryEntry = "test/fixtures/bundle-entry.mjs";
const versionEntry = "test/fixtures/bundle-entry-version.mjs";

/**
 * Bundles one consumer entry against dist/ the way a consumer's bundler would: trusting
 * package.json about side effects, which obuild ignores while it builds a library.
 * @param entry - Consumer entry, relative to the repo root.
 * @returns {Promise<string>} The output directory, removed when the test finishes.
 */
async function bundleConsumer(entry: string): Promise<string> {
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
  return outDir;
}

describe.skipIf(!existsSync(join(root, "dist/index.mjs")))("bundled package", () => {
  it("keeps every built-in provider listed after a consumer bundles dist/", async () => {
    const outDir = await bundleConsumer(registryEntry);
    const bundle = (await import(pathToFileURL(join(outDir, registryEntry)).href)) as Pick<
      typeof import("../src/index.ts"),
      "providers"
    >;

    expect(bundle.providers().sort()).toEqual([...builtinProviders].sort());
  });

  /** With no import side effects declared, a consumer that never touches the registry ships no adapter, not even as a chunk. */
  it("drops every provider from a consumer that only reads the version", async () => {
    const outDir = await bundleConsumer(versionEntry);
    const bundle = (await import(pathToFileURL(join(outDir, versionEntry)).href)) as Pick<
      typeof import("../src/index.ts"),
      "version"
    >;
    const files = readdirSync(outDir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".mjs"))
      .map((file) => file.split(sep).join("/"));

    expect(bundle.version).toMatch(/^\d+\.\d+\.\d+/u);
    expect(files).toEqual([versionEntry]);
  });
});
