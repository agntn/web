import { createHash } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { fingerprint } from "../../src/core/continuation.ts";

describe("fingerprint", () => {
  /* OpenSSL judges: another digest would void every token already in flight. */
  it.each(["", "abc", "zażółć gęślą jaźń", "🦀", "\uD800", "a".repeat(64)])(
    "matches the node:crypto digest for %j",
    (value) => {
      const expected = createHash("sha256")
        .update(value)
        .digest()
        .subarray(0, 16)
        .toString("base64url");
      expect(fingerprint(value)).toBe(expected);
    },
  );
});
