import { defineBuildConfig } from "obuild/config";
import { createSourceBuildId } from "./src/build-id.ts";

const buildId = createSourceBuildId(import.meta.dirname);

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: ["./src/index.ts", "./src/cli.ts", "./src/ai.ts", "./src/mcp.ts"],
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
