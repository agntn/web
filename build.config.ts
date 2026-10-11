import { readdirSync } from "node:fs";
import { defineBuildConfig } from "obuild/config";
import { createSourceBuildId } from "./src/build-id.ts";

/** Read off the disk, so a new provider lands in `dist/providers/` without a line here. */
const providerInputs = readdirSync(new URL("src/providers/", import.meta.url))
  .filter((file) => file.endsWith(".ts"))
  .map((file) => `./src/providers/${file}`);

export default defineBuildConfig({
  entries: [
    {
      /** One bundle, so the providers share the core chunks instead of each carrying a copy. */
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/cli.ts",
        "./src/ai.ts",
        "./src/mcp.ts",
        "./src/tools.ts",
        ...providerInputs,
      ],
      /** Declaration maps would point at a src/ the tarball doesn't carry. */
      dts: { sourcemap: false },
      rolldown: {
        transform: {
          define: {
            __AGNTN_WEB_BUILD_ID__: JSON.stringify(createSourceBuildId(import.meta.dirname)),
          },
        },
      },
    },
  ],
});
