import oxfmt from "@agntn/ox/oxfmt";
import oxlint from "@agntn/ox/oxlint";
import { defineConfig } from "vite-plus";
import { createSourceBuildId } from "./src/build-id.ts";

const buildId = createSourceBuildId(import.meta.dirname);

export default defineConfig({
  fmt: {
    ...oxfmt,
    ignorePatterns: ["dist", "coverage", "docs", "CHANGELOG.md"],
  },
  lint: {
    ...oxlint,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      ...oxlint.rules,
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      ...oxlint.options,
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: ["dist", "coverage", "docs"],
  },
  test: {
    globals: true,
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.test.ts"],
  },
  pack: {
    entry: {
      index: "src/index.ts",
      cli: "src/cli.ts",
      ai: "src/ai.ts",
      mcp: "src/mcp.ts",
      "providers/index": "src/providers/index.ts",
      "providers/*": ["src/providers/*.ts", "!src/providers/index.ts"],
    },
    dts: true,
    format: "esm",
    platform: "node",
    sourcemap: true,
    define: {
      __AGNTN_WEB_BUILD_ID__: JSON.stringify(buildId),
    },
    deps: {
      onlyBundle: [/^typebox(?:\/|$)/u],
      alwaysBundle: [/^typebox(?:\/|$)/u],
      resolveDepSubpath: true,
    },
  },
});
