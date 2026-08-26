import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: ["./src/index.ts", "./src/cli.ts", "./src/ai.ts", "./src/opencode.ts", "./src/mcp.ts"],
    },
  ],
  hooks: {
    rolldownConfig(config) {
      if (!Array.isArray(config.external)) return;

      config.external = config.external.filter((entry) => {
        if (typeof entry === "string") {
          return (
            entry !== "@opencode-ai/plugin" && entry !== "typebox" && !entry.startsWith("typebox/")
          );
        }

        return (
          !(entry instanceof RegExp) ||
          (!entry.test("@opencode-ai/plugin/tool") && !entry.test("typebox/value"))
        );
      });
    },
  },
});
