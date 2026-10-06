import { readdirSync } from "node:fs";
import type { BuildConfig } from "obuild";
import { defineBuildConfig } from "obuild/config";
import { createSourceBuildId } from "./src/build-id.ts";

/** Read off the disk, so a new provider lands in `dist/providers/` without a line here. */
const providerInputs = readdirSync(new URL("src/providers/", import.meta.url))
  .filter((file) => file.endsWith(".ts"))
  .map((file) => `./src/providers/${file}`);

/** typebox is an optional peer the CLI can't count on, so both of obuild's externals for it go. */
const bundleTypebox: NonNullable<BuildConfig["hooks"]> = {
  rolldownConfig(config) {
    const external = config.external;
    const isTypebox = (id: string): boolean => /^typebox(?:\/|$)/u.test(id);

    if (typeof external === "function") {
      config.external = (id, importer, isResolved) =>
        isTypebox(id) ? false : external(id, importer, isResolved);
      return;
    }

    if (Array.isArray(external)) {
      config.external = external.filter((item) =>
        typeof item === "string" ? !isTypebox(item) : !item.test("typebox/value"),
      );
    }
  },
};

export default defineBuildConfig({
  entries: [
    {
      /** One bundle, so the providers share the core chunks instead of each carrying a copy. */
      type: "bundle",
      input: ["./src/index.ts", "./src/cli.ts", "./src/ai.ts", "./src/mcp.ts", ...providerInputs],
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
  hooks: bundleTypebox,
});
