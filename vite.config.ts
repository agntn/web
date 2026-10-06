import { fileURLToPath } from "node:url";
import oxfmt from "@agntn/ox/oxfmt";
import oxlint from "@agntn/ox/oxlint";
import { defineConfig } from "vite-plus";

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
  /** `docs/tsconfig.json` only points at `nuxt prepare` output, which CI never builds. */
  tsconfig: "tsconfig.json",
  test: {
    globals: true,
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.test.ts"],
    /** A docs module resolves the library as the worker bundles it, from `src/`. */
    alias: {
      "@agntn/web": fileURLToPath(new URL("src/index.ts", import.meta.url)),
    },
  },
});
