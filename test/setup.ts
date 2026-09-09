import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubEnv("OPENAI_CODEX_AUTH_SOURCE", "none");
});

afterEach(() => {
  vi.unstubAllEnvs();
});
