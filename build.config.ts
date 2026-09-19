import { readdirSync } from "node:fs";
import { defineBuildConfig } from "obuild/config";
import { createSourceBuildId } from "./src/build-id.ts";

const buildId = createSourceBuildId(import.meta.dirname);

/**
 * Every provider file is its own bundle input, so the manifest's `import()` resolves to a stable
 * `dist/providers/<name>.mjs` that the `./providers/*` export also serves. Read from the directory
 * so a new provider needs only its file and its manifest entry.
 */
const providerInputs = readdirSync(new URL("./src/providers/", import.meta.url))
  .filter((file) => file.endsWith(".ts") && file !== "index.ts")
  .map((file) => `./src/providers/${file}`);

/**
 * One bundle, many inputs: the entries share their chunks and therefore the registry table.
 * Separate bundles would each carry their own copy, so a provider registered through the
 * package entrypoint would be invisible to the MCP server.
 */
export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/cli.ts",
        "./src/ai.ts",
        "./src/mcp.ts",
        "./src/providers/index.ts",
        ...providerInputs,
      ],
    },
  ],
  hooks: {
    rolldownConfig(config) {
      config.transform = {
        ...config.transform,
        define: {
          ...config.transform?.define,
          __AGNTN_WEB_BUILD_ID__: JSON.stringify(buildId),
        },
      };

      if (Array.isArray(config.plugins)) {
        config.plugins = config.plugins.filter(
          (plugin: unknown) =>
            typeof plugin !== "object" ||
            plugin === null ||
            !("name" in plugin) ||
            plugin.name !== "remove-comments",
        );
      }

      if (!Array.isArray(config.external)) return;

      config.external = config.external.filter((entry) => {
        if (typeof entry === "string") {
          return entry !== "typebox" && !entry.startsWith("typebox/");
        }

        return !(entry instanceof RegExp) || !entry.test("typebox/value");
      });
    },
  },
});
