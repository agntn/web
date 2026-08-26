import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveWebModuleUrl } from "../../packages/pi/extensions/web.ts";

describe("Pi extension", () => {
  it("loads current source instead of a potentially stale ignored build", () => {
    expect(fileURLToPath(resolveWebModuleUrl())).toBe(
      fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
    );
  });
});
