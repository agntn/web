import oxlint from "@agntn/ox/oxlint";
import { defineConfig } from "oxlint";

export default defineConfig({
  ...oxlint,
  rules: { ...oxlint.rules },
  ignorePatterns: ["dist", "coverage"],
});
