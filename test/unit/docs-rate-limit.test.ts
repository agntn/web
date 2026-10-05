import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/** Stands in for `ohash`, which only `docs/` installs and CI never does. Tests compare keys only. */
vi.mock("ohash", () => ({ hash: (value: unknown) => `h:${String(value)}` }));

const { assertRateLimit } = await import("../../docs/server/utils/query.ts");

interface FakeEvent {
  readonly headers: Readonly<Record<string, string>>;
  readonly context: Readonly<{ cloudflare: Readonly<{ env: Readonly<Record<string, unknown>> }> }>;
}

/** Keys the fake `QUERY_LIMIT` binding was asked about, emptied by every `keyFor`. */
const keys: string[] = [];

/* A request through Cloudflare from `address`, with a rate limit binding that records its key. */
function fakeEvent(address: string): never {
  const binding = {
    limit: async ({ key }: Readonly<{ key: string }>) => {
      await Promise.resolve();
      keys.push(key);
      return { success: true };
    },
  };
  const event: FakeEvent = {
    headers: { "cf-connecting-ip": address },
    context: { cloudflare: { env: { QUERY_LIMIT: binding } } },
  };
  return event as never;
}

/* The key `assertRateLimit` hands the binding for one client address. */
async function keyFor(address: string): Promise<string | undefined> {
  keys.length = 0;
  await assertRateLimit(fakeEvent(address));
  return keys[0];
}

beforeEach(() => {
  vi.stubGlobal(
    "getRequestHeader",
    (event: Readonly<FakeEvent>, name: string) => event.headers[name.toLowerCase()],
  );
  vi.stubGlobal("getRequestIP", () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("docs rate limit key", () => {
  it("counts every address of one IPv6 /64 as one client", async () => {
    const subjects = new Set<string | undefined>();
    for (const address of [
      "2001:db8:1:2::1",
      "2001:db8:1:2:dead:beef:0:7",
      "2001:0DB8:0001:0002:ffff:ffff:ffff:ffff",
    ]) {
      subjects.add(await keyFor(address));
    }

    expect(subjects.size).toBe(1);
  });

  it("keeps neighbouring /64 prefixes apart", async () => {
    expect(await keyFor("2001:db8:1:2::1")).not.toBe(await keyFor("2001:db8:1:3::1"));
  });

  it("finds the /64 behind a compressed prefix", async () => {
    expect(await keyFor("2001:db8::7")).toBe(await keyFor("2001:db8:0:0:ffff::1"));
    expect(await keyFor("::1")).toBe(await keyFor("::2"));
  });

  it("keeps IPv4 clients by their full address, mapped or not", async () => {
    expect(await keyFor("203.0.113.7")).not.toBe(await keyFor("203.0.113.8"));
    expect(await keyFor("::ffff:203.0.113.7")).not.toBe(await keyFor("::ffff:203.0.113.8"));
  });

  it("falls back to the raw header when it is not an address", async () => {
    expect(await keyFor("fe80::1%eth0")).not.toBe(await keyFor("fe80::2%eth0"));
    expect(await keyFor("::1]@example.com/#a")).not.toBe(await keyFor("::1]@example.com/#b"));
  });
});
