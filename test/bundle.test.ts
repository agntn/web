import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ompTypebox from "@oh-my-pi/omptype/typebox";
import { createJiti } from "jiti/static";
import { build } from "vite-plus/pack";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vite-plus/test";
import { builtinProviders } from "../src/index.ts";
import { packSource } from "./fixtures/pack.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
let packageDir = "";

/**
 * Packages Pi hands its extensions (`HOST_PROVIDED_EXTENSION_PACKAGES` in Pi's resource loader).
 * A copy in "dependencies" can bypass the host's module mapping, and Pi 0.99 warns on every load
 * of such a package.
 */
const hostProvidedPackages = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-tui",
  "@sinclair/typebox",
  "typebox",
];

/**
 * Bundles a consumer of one root export against the packed dist/ the way a consumer's bundler
 * would: trusting package.json about side effects.
 * @param name - The export the consumer re-exports.
 * @returns {Promise<string>} The output directory, removed when the test finishes.
 */
async function bundleConsumer(name: "providers" | "version"): Promise<string> {
  const consumerDir = mkdtempSync(join(root, "node_modules/.cache/web-consumer-"));
  onTestFinished(() => rmSync(consumerDir, { recursive: true, force: true }));
  const entry = join(consumerDir, "consumer.mjs");
  writeFileSync(
    entry,
    `export { ${name} } from ${JSON.stringify(join(packageDir, "dist/index.mjs"))};\n`,
  );

  const outDir = join(consumerDir, "out");
  await build({
    cwd: root,
    entry: { consumer: entry },
    outDir,
    dts: false,
    clean: false,
    hash: false,
    fixedExtension: true,
    treeshake: true,
  });
  return outDir;
}

describe("package manifest", () => {
  it("leaves the packages Pi supplies to the host", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly peerDependencies?: Readonly<Record<string, string>>;
    };

    expect(hostProvidedPackages.filter((name) => name in (manifest.dependencies ?? {}))).toEqual(
      [],
    );
    expect(manifest.peerDependencies?.typebox).toBe("*");
  });
});

describe("bundled package", () => {
  /**
   * Packs the current source with the repo's own `vp pack` config and copies the other files
   * package.json publishes beside it, so no test reads a dist/ left from an older build. The
   * directory sits under node_modules, where bare imports resolve the way they do in a consumer's
   * install.
   */
  beforeAll(() => {
    mkdirSync(join(root, "node_modules/.cache"), { recursive: true });
    packageDir = mkdtempSync(join(root, "node_modules/.cache/web-package-"));
    packSource(join(packageDir, "dist"));

    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      readonly files: readonly string[];
    };
    cpSync(join(root, "package.json"), join(packageDir, "package.json"));
    for (const entry of manifest.files.filter((file) => file !== "dist")) {
      cpSync(join(root, entry), join(packageDir, entry), { recursive: true });
    }
  });

  afterAll(() => {
    if (packageDir) rmSync(packageDir, { recursive: true, force: true });
  });

  /** typebox is only an optional peer, so the CLI, the MCP server and their types have to carry their own copy. */
  it("bundles typebox instead of importing it from dist/", () => {
    const importers = readdirSync(join(packageDir, "dist"), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".mjs") || file.endsWith(".d.mts"))
      .filter((file) =>
        /(?:from|import)\s*\(?\s*["']typebox(?:\/[^"']*)?["']/u.test(
          readFileSync(join(packageDir, "dist", file), "utf8"),
        ),
      );

    expect(importers).toEqual([]);
  });

  it("keeps every built-in provider listed after a consumer bundles dist/", async () => {
    const outDir = await bundleConsumer("providers");
    const bundle = (await import(pathToFileURL(join(outDir, "consumer.mjs")).href)) as Pick<
      typeof import("../src/index.ts"),
      "providers"
    >;

    expect(bundle.providers().sort()).toEqual([...builtinProviders].sort());
  });

  /** With no import side effects declared, a consumer that never touches the registry ships no adapter, not even as a chunk. */
  it("drops every provider from a consumer that only reads the version", async () => {
    const outDir = await bundleConsumer("version");
    const bundle = (await import(pathToFileURL(join(outDir, "consumer.mjs")).href)) as Pick<
      typeof import("../src/index.ts"),
      "version"
    >;
    const files = readdirSync(outDir, { recursive: true, encoding: "utf8" }).filter((file) =>
      file.endsWith(".mjs"),
    );

    expect(bundle.version).toMatch(/^\d+\.\d+\.\d+/u);
    expect(files).toEqual(["consumer.mjs"]);
  });

  /** Pi and OMP load the extension source from the installed package, so every file it imports has to ship. */
  it("loads the Pi and OMP extensions from the published files", async () => {
    const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: false });
    const load = (host: string) =>
      jiti.import<(pi: unknown) => Promise<void>>(
        join(packageDir, `packages/${host}/extensions/web.ts`),
        { default: true },
      );

    const piExtension = await load("pi");
    const piTools: string[] = [];
    await piExtension({
      registerTool: (tool: { readonly name: string }) => piTools.push(tool.name),
      registerCommand() {},
    });
    const ompExtension = await load("omp");
    const ompTools: string[] = [];
    await ompExtension({
      typebox: ompTypebox,
      setLabel() {},
      registerTool: (tool: { readonly name: string }) => ompTools.push(tool.name),
    });

    expect(piTools).toContain("web_search");
    expect(ompTools).toContain("web_search");
  });
});
