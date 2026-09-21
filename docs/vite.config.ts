import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["app", "content", "server", "wrangler.jsonc"],
  },
  check: {
    lint: false,
  },
});
