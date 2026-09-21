import { afterEach, beforeEach, vi } from "vite-plus/test";

beforeEach(() => {
  vi.stubEnv("OPENAI_CODEX_AUTH_SOURCE", "none");
});

afterEach(() => {
  vi.unstubAllEnvs();
});
