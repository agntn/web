import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createSearchProvider,
  isProviderConfigured,
  searchProviderDetailed,
  withCodexHostAuth,
  type CodexHostAuth,
} from "../../src/index.ts";
import { completedEvents, sse } from "../fixtures/codex.ts";

let home: string;
const fetchMock = vi.fn<typeof fetch>();

function token(accountId = "native-account", expired = false): string {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600),
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  };
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function writeAuth(path: string, data: unknown): string {
  mkdirSync(dirname(path), { recursive: true });
  const text = JSON.stringify(data);
  writeFileSync(path, text, { mode: 0o600 });
  return text;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "web-codex-auth-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  for (const key of [
    "OPENAI_CODEX_ACCESS_TOKEN",
    "OPENAI_CODEX_ACCOUNT_ID",
    "CODEX_HOME",
    "PI_CODING_AGENT_DIR",
    "OMP_PROFILE",
    "PI_PROFILE",
    "XDG_DATA_HOME",
  ])
    vi.stubEnv(key, "");
  vi.stubEnv("OPENAI_CODEX_AUTH_SOURCE", "auto");
  fetchMock.mockReset().mockImplementation(async () => sse(completedEvents()));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("native Codex login discovery", () => {
  it.each([
    ["codex", ".codex/auth.json", "tokens"],
    ["pi", ".pi/agent/auth.json", "openai-codex"],
    ["omp", ".omp/agent/auth.json", "openai-codex"],
    ["opencode", ".local/share/opencode/auth.json", "openai"],
  ])(
    "uses an existing %s login without environment tokens or file writes",
    async (source, relative, key) => {
      const access = token();
      const data =
        source === "codex"
          ? { access_token: access, refresh_token: "unused-refresh" }
          : { type: "oauth", access, refresh: "unused-refresh", expires: Date.now() + 60_000 };
      const path = join(home, relative);
      const original = writeAuth(path, { [key]: data, unrelated: { key: "preserved" } });
      expect(isProviderConfigured("openai-codex")).toBe(true);
      const result = await searchProviderDetailed("openai-codex", "query");
      expect(result.results).toHaveLength(2);
      const request = new Request(...fetchMock.mock.calls[0]);
      expect(request.headers.get("authorization")).toBe(`Bearer ${access}`);
      expect(request.headers.get("chatgpt-account-id")).toBe("native-account");
      expect(readFileSync(path, "utf8")).toBe(original);
    },
  );

  it("reads active OAuth entries from OMP SQLite without reviving disabled accounts", async () => {
    const path = join(home, ".omp/agent/agent.db");
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    try {
      db.exec(
        "CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT)",
      );
      const insert = db.prepare(
        "INSERT INTO auth_credentials VALUES (?, 'openai-codex', 'oauth', ?, ?)",
      );
      insert.run(0, "corrupt JSON", null);
      insert.run(1, JSON.stringify({ access: token("disabled") }), "disabled");
      insert.run(2, JSON.stringify({ access: token("expired", true) }), null);
      insert.run(
        3,
        JSON.stringify({ access: token("active"), expires: Date.now() + 60_000 }),
        null,
      );
    } finally {
      db.close();
    }
    const original = readFileSync(path);
    expect(isProviderConfigured("openai-codex")).toBe(true);
    const active = await createSearchProvider("openai-codex");
    expect(await active.search("query")).toHaveLength(2);
    expect(new Request(...fetchMock.mock.calls[0]).headers.get("chatgpt-account-id")).toBe(
      "active",
    );
    expect(readFileSync(path)).toEqual(original);
  });

  it("honors alternate locations, native source selection, and explicit credentials", async () => {
    const dir = join(home, "custom-codex");
    vi.stubEnv("CODEX_HOME", dir);
    writeAuth(join(dir, "auth.json"), { tokens: { access_token: token("codex") } });
    writeAuth(join(home, ".pi/agent/auth.json"), {
      "openai-codex": { type: "oauth", access: token("pi") },
    });
    const named = await createSearchProvider("openai-codex", { codex: { authSource: "pi" } });
    await named.search("query");
    expect(new Request(...fetchMock.mock.calls[0]).headers.get("chatgpt-account-id")).toBe("pi");
    vi.stubEnv("OPENAI_CODEX_ACCESS_TOKEN", token("environment"));
    await searchProviderDetailed("openai-codex", "query");
    expect(new Request(...fetchMock.mock.calls[1]).headers.get("chatgpt-account-id")).toBe(
      "environment",
    );
    const explicit = await createSearchProvider("openai-codex", {
      codex: { credentials: { accessToken: token("explicit") } },
    });
    await explicit.search("query");
    expect(new Request(...fetchMock.mock.calls[2]).headers.get("chatgpt-account-id")).toBe(
      "explicit",
    );
  });

  it("honors OMP profiles without falling back from an invalid profile", () => {
    const entry = { "openai-codex": { type: "oauth", access: token("profile") } };
    writeAuth(join(home, ".omp/profiles/work.one/agent/auth.json"), entry);
    writeAuth(join(home, ".omp/agent/auth.json"), entry);
    vi.stubEnv("OPENAI_CODEX_AUTH_SOURCE", "omp");
    vi.stubEnv("OMP_PROFILE", "work.one");
    expect(isProviderConfigured("openai-codex")).toBe(true);
    vi.stubEnv("OMP_PROFILE", "default");
    expect(isProviderConfigured("openai-codex")).toBe(true);
    vi.stubEnv("OMP_PROFILE", "../../outside");
    expect(isProviderConfigured("openai-codex")).toBe(false);
  });

  it.each([
    ["pi", "PI_CODING_AGENT_DIR", "auth.json", "openai-codex"],
    ["opencode", "XDG_DATA_HOME", "opencode/auth.json", "openai"],
  ])("honors the %s data directory override", (source, variable, relative, key) => {
    const directory = join(home, "override");
    vi.stubEnv(variable, directory);
    vi.stubEnv("OPENAI_CODEX_AUTH_SOURCE", source);
    writeAuth(join(directory, relative), { [key]: { type: "oauth", access: token() } });
    expect(isProviderConfigured("openai-codex")).toBe(true);
  });

  it("does not use another login after explicit environment credentials are incomplete", async () => {
    writeAuth(join(home, ".codex/auth.json"), { tokens: { access_token: token() } });
    vi.stubEnv("OPENAI_CODEX_ACCOUNT_ID", "partial-override");
    expect(isProviderConfigured("openai-codex")).toBe(false);
    await expect(createSearchProvider("openai-codex")).rejects.toThrow("No usable Codex login");
  });

  it("skips expired or malformed stores and supports disabling automatic discovery", async () => {
    writeAuth(join(home, ".codex/auth.json"), { tokens: { access_token: token("expired", true) } });
    writeAuth(join(home, ".pi/agent/auth.json"), "not a credential object");
    expect(isProviderConfigured("openai-codex")).toBe(false);
    writeAuth(join(home, ".pi/agent/auth.json"), {
      "openai-codex": { type: "oauth", access: token() },
    });
    vi.stubEnv("OPENAI_CODEX_AUTH_SOURCE", "none");
    expect(isProviderConfigured("openai-codex")).toBe(false);
    await expect(createSearchProvider("openai-codex")).rejects.toThrow("No usable Codex login");
  });

  it("rereads rotated credentials but pins the original account", async () => {
    const path = join(home, ".codex/auth.json");
    writeAuth(path, { tokens: { access_token: token("selected") } });
    const provider = await createSearchProvider("openai-codex");
    writeAuth(path, { tokens: { access_token: token("different-account") } });
    await expect(provider.search("query")).rejects.toThrow("credential provider failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("native host auth scope", () => {
  it.each(["accepted", "revoked"])(
    "handles a %s bearer from the real Pi ModelRegistry",
    async (state) => {
      const { ModelRegistry, ModelRuntime } = await import("@earendil-works/pi-coding-agent");
      const authPath = join(home, "auth.json");
      const original = writeAuth(authPath, {
        "openai-codex": {
          type: "oauth",
          access: token("pi-sdk"),
          refresh: "unused-refresh",
          expires: Date.now() + 3_600_000,
        },
      });
      const runtime = await ModelRuntime.create({
        authPath,
        modelsPath: null,
        modelsStorePath: join(home, "models-store.json"),
        allowModelNetwork: false,
      });
      const registry = new ModelRegistry(runtime);
      expect(registry.getProviderAuthStatus("openai-codex").configured).toBe(true);
      expect("authStorage" in registry).toBe(false);
      fetchMock.mockClear();
      if (state === "revoked")
        fetchMock.mockImplementation(async () => new Response("revoked", { status: 401 }));
      const search = withCodexHostAuth(registry, async () => {
        expect(isProviderConfigured("openai-codex")).toBe(true);
        return searchProviderDetailed("openai-codex", "query");
      });
      if (state === "revoked")
        await expect(search).rejects.toThrow("Sign in again with the owning client");
      else await expect(search).resolves.toHaveProperty("results.length", 2);
      expect(fetchMock.mock.calls).toHaveLength(1);
      expect(new Request(...fetchMock.mock.calls[0]).headers.get("chatgpt-account-id")).toBe(
        "pi-sdk",
      );
      expect(readFileSync(authPath, "utf8")).toBe(original);
    },
  );

  it("lets OMP own refresh and passes the calling session to its broker", async () => {
    const refreshes: boolean[] = [];
    const sessions: Array<string | undefined> = [];
    const host: CodexHostAuth = {
      hasOAuth: () => true,
      getOAuthAccess: async (_provider, session, options) => {
        refreshes.push(options?.forceRefresh === true);
        sessions.push(session);
        return { accessToken: `${token("omp-host")}${options?.forceRefresh ? "-rotated" : ""}` };
      },
    };
    fetchMock.mockResolvedValueOnce(new Response("expired", { status: 401 }));
    await withCodexHostAuth(
      host,
      async () => {
        expect(isProviderConfigured("openai-codex")).toBe(true);
        expect((await searchProviderDetailed("openai-codex", "query")).results).toHaveLength(2);
      },
      "session-test",
    );
    expect(refreshes).toEqual([false, true]);
    expect(sessions).toEqual(["session-test", "session-test"]);
    expect(isProviderConfigured("openai-codex")).toBe(false);
  });

  it("uses Pi's existing auth resolver without copying or persisting refresh tokens", async () => {
    let resolutions = 0;
    const host: CodexHostAuth = {
      get: () => ({ type: "oauth", accountId: "pi-host" }),
      getApiKey: async () => {
        resolutions += 1;
        return token("pi-host");
      },
    };
    await withCodexHostAuth(host, () => searchProviderDetailed("openai-codex", "query"));
    expect(resolutions).toBe(1);
    expect(new Request(...fetchMock.mock.calls[0]).headers.get("chatgpt-account-id")).toBe(
      "pi-host",
    );
  });

  it("resolves current Pi auth lazily and again after a rejected bearer", async () => {
    const initialToken = token("pi-runtime");
    const rotatedToken = `${initialToken}-rotated`;
    const getProviderAuth = vi
      .fn()
      .mockResolvedValueOnce({ auth: { apiKey: initialToken } })
      .mockResolvedValueOnce({ auth: { apiKey: rotatedToken } });
    const host: CodexHostAuth = {
      getProviderAuthStatus: (provider) => ({ configured: provider === "openai-codex" }),
      getProviderAuth,
    };
    fetchMock.mockResolvedValueOnce(new Response("expired", { status: 401 }));
    await withCodexHostAuth(host, async () => {
      expect(isProviderConfigured("openai-codex")).toBe(true);
      expect(getProviderAuth).not.toHaveBeenCalled();
      await searchProviderDetailed("openai-codex", "query");
    });
    const requests = fetchMock.mock.calls.map((args) => new Request(...args));
    expect(requests.map((request) => request.headers.get("authorization"))).toEqual([
      `Bearer ${initialToken}`,
      `Bearer ${rotatedToken}`,
    ]);
    expect(requests.map((request) => request.headers.get("chatgpt-account-id"))).toEqual([
      "pi-runtime",
      "pi-runtime",
    ]);
    expect(isProviderConfigured("openai-codex")).toBe(false);
  });

  it("does not resolve unconfigured Pi auth during discovery", () => {
    const getProviderAuth = vi.fn();
    withCodexHostAuth(
      { getProviderAuthStatus: () => ({ configured: false }), getProviderAuth },
      () => {
        expect(isProviderConfigured("openai-codex")).toBe(false);
      },
    );
    expect(getProviderAuth).not.toHaveBeenCalled();
  });

  it.each([undefined, { auth: {} }, { auth: { apiKey: "not-a-codex-token" } }])(
    "rejects missing or unusable resolved Pi auth: %j",
    async (resolved) => {
      await expect(
        withCodexHostAuth(
          {
            getProviderAuthStatus: () => ({ configured: true }),
            getProviderAuth: async () => resolved,
          },
          () => searchProviderDetailed("openai-codex", "query"),
        ),
      ).rejects.toThrow("Codex credential provider failed; check your login or refresh handler");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("stops before HTTP when cancelled during Pi auth resolution", async () => {
    const controller = new AbortController();
    await expect(
      withCodexHostAuth(
        {
          getProviderAuthStatus: () => ({ configured: true }),
          getProviderAuth: async () => {
            controller.abort();
            return { auth: { apiKey: token("cancelled") } };
          },
        },
        () => searchProviderDetailed("openai-codex", "query", { signal: controller.signal }),
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps concurrent hosts isolated", async () => {
    await Promise.all(
      ["first", "second"].map((account) =>
        withCodexHostAuth(
          {
            hasOAuth: () => true,
            getOAuthAccess: async () => ({ accessToken: token(account) }),
          },
          async () => {
            await Promise.resolve();
            return searchProviderDetailed("openai-codex", "query");
          },
        ),
      ),
    );
    const accounts = fetchMock.mock.calls.map((args) =>
      new Request(...args).headers.get("chatgpt-account-id"),
    );
    expect(accounts.sort((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual(["first", "second"]);
  });
});
