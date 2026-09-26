import { afterEach, beforeEach, vi } from "vite-plus/test";
import { resetOutOfCredits } from "../src/core/fallback.ts";

beforeEach(() => {
  vi.stubEnv("OPENAI_CODEX_AUTH_SOURCE", "none");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetOutOfCredits();
});
