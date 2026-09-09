import { AsyncLocalStorage } from "node:async_hooks";
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AuthError } from "./errors.ts";
import type { CodexAuthSource, CodexCredentials, CodexCredentialProvider } from "./types.ts";

const hostCredentials = new AsyncLocalStorage<CodexCredentialProvider>();
const SOURCE_NAMES = ["auto", "codex", "pi", "omp", "opencode", "none"] as const;
const MAX_AUTH_FILE_BYTES = 1024 * 1024;

type NativeSource = Exclude<CodexAuthSource, "auto" | "none">;
type LoginStore = { readonly source: NativeSource; readonly path: string; readonly sqlite?: true };

/** A validated bearer and its account identity, ready for request headers. */
export interface ResolvedCodexCredentials {
  readonly accessToken: string;
  readonly accountId: string;
}

/** Minimal native Pi/OMP auth interface; refresh tokens never cross it. */
export interface CodexHostAuth {
  readonly hasOAuth?: (provider: string) => boolean;
  readonly get?: (provider: string) => unknown;
  readonly reload?: () => void;
  readonly getApiKey?: (provider: string) => Promise<string | undefined>;
  readonly getOAuthAccess?: (
    provider: string,
    sessionId?: string,
    options?: { readonly forceRefresh?: boolean; readonly signal?: Readonly<AbortSignal> },
  ) => Promise<CodexCredentials | undefined>;
}

/**
 * Reuse the invoking Pi/OMP login for this operation without global credential registration.
 * @param host - Native auth storage from the extension context.
 * @param run - Search or discovery operation.
 * @param sessionId - OMP account affinity for this session.
 * @returns {T} The operation's result, with scoped host auth.
 */
export function withCodexHostAuth<T>(
  host: CodexHostAuth | undefined,
  run: () => T,
  sessionId?: string,
): T {
  if (!host || !hasHostOAuth(host)) return run();
  return hostCredentials.run(async ({ refresh, signal }) => {
    signal.throwIfAborted();
    if (host.getOAuthAccess) {
      const credentials = await host.getOAuthAccess("openai-codex", sessionId, {
        forceRefresh: refresh,
        signal,
      });
      if (!credentials) throw missingLogin();
      return credentials;
    }
    host.reload?.();
    const accessToken = await host.getApiKey?.("openai-codex");
    const credential = record(host.get?.("openai-codex"));
    if (!accessToken) throw missingLogin();
    return { accessToken, accountId: stringValue(credential?.accountId) };
  }, run);
}

function hasHostOAuth(host: CodexHostAuth): boolean {
  if (host.hasOAuth) return host.hasOAuth("openai-codex");
  return record(host.get?.("openai-codex"))?.type === "oauth";
}

/**
 * Resolve an explicit source or the environment's source selector.
 * @param source - Optional instance override.
 * @returns {CodexAuthSource} Validated login selection.
 */
export function codexAuthSource(source?: CodexAuthSource): CodexAuthSource {
  const selected = source ?? (process.env.OPENAI_CODEX_AUTH_SOURCE || "auto");
  const known = SOURCE_NAMES.find((name) => name === selected);
  if (!known)
    throw new AuthError(
      "Invalid OPENAI_CODEX_AUTH_SOURCE; use auto, codex, pi, omp, opencode, or none",
      "openai-codex",
    );
  return known;
}

/**
 * Inspect native logins without refreshing credentials, creating files, or opening a database for write.
 * @param source - Login selection.
 * @returns {boolean} Whether a usable login or a host refresh authority exists.
 */
export function hasCodexLogin(source: CodexAuthSource): boolean {
  if (source === "none") return false;
  if (source === "auto" && hostCredentials.getStore()) return true;
  return findLogin(source) !== undefined;
}

/**
 * Pin the selected native store; subsequent calls reread it without changing accounts on failure.
 * @param source - Login selection.
 * @returns {CodexCredentialProvider} A native host callback or a read-only saved-login resolver.
 */
export function nativeCodexCredentials(source: CodexAuthSource): CodexCredentialProvider {
  if (source === "auto") {
    const host = hostCredentials.getStore();
    if (host) return host;
  }
  const login = findLogin(source);
  if (!login) throw missingLogin();
  return ({ signal }) => {
    signal.throwIfAborted();
    const current = readStore(login.store).find(
      (credentials) => credentials.accountId === login.credentials.accountId,
    );
    if (!current) throw missingLogin();
    return current;
  };
}

/**
 * Resolve account identity from an explicit value or the JWT claim, never from an API key.
 * @param credentials - Caller, environment, or native credentials.
 * @returns {ResolvedCodexCredentials} Header-safe bearer and account identity.
 */
export function resolveCodexCredentials(credentials: CodexCredentials): ResolvedCodexCredentials {
  const claims = tokenClaims(credentials.accessToken);
  const auth = record(claims?.["https://api.openai.com/auth"]);
  const accountId = credentials.accountId ?? stringValue(auth?.chatgpt_account_id);
  if (!validHeaderValue(credentials.accessToken) || !validHeaderValue(accountId))
    throw missingLogin();
  return { accessToken: credentials.accessToken, accountId };
}

function findLogin(
  source: CodexAuthSource,
): { store: LoginStore; credentials: ResolvedCodexCredentials } | undefined {
  if (source === "none") return undefined;
  for (const store of loginStores()) {
    if (source !== "auto" && store.source !== source) continue;
    const credentials = readStore(store)[0];
    if (credentials) return { store, credentials };
  }
  return undefined;
}

function loginStores(): readonly LoginStore[] {
  const home = homedir();
  const agentOverride = absoluteEnv("PI_CODING_AGENT_DIR");
  const piDir = agentOverride ?? join(home, ".pi", "agent");
  const ompDir = ompAgentDir(home, agentOverride);
  return [
    { source: "codex", path: join(absoluteEnv("CODEX_HOME") ?? join(home, ".codex"), "auth.json") },
    { source: "pi", path: join(piDir, "auth.json") },
    ...ompStores(ompDir),
    {
      source: "opencode",
      path: join(
        absoluteEnv("XDG_DATA_HOME") ?? join(home, ".local", "share"),
        "opencode",
        "auth.json",
      ),
    },
  ];
}

function ompAgentDir(home: string, override?: string): string | undefined {
  const profile = (process.env.OMP_PROFILE ?? process.env.PI_PROFILE)?.trim();
  if (!profile || profile === "default") return override ?? join(home, ".omp", "agent");
  if (!validOmpProfile(profile)) return undefined;
  return join(home, ".omp", "profiles", profile, "agent");
}

function validOmpProfile(profile: string): boolean {
  return (
    /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(profile) &&
    !profile.endsWith(".") &&
    !/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/iu.test(profile)
  );
}

function ompStores(dir?: string): readonly LoginStore[] {
  return dir
    ? [
        { source: "omp", path: join(dir, "agent.db"), sqlite: true },
        { source: "omp", path: join(dir, "auth.json") },
      ]
    : [];
}

function absoluteEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  if (value === "~") return homedir();
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(value);
}

function readStore(store: LoginStore): ResolvedCodexCredentials[] {
  try {
    const candidates = store.sqlite ? readOmpDatabase(store.path) : readJsonLogin(store);
    return candidates.flatMap((candidate) => {
      const credentials = savedCredentials(candidate, store.source);
      return credentials ? [credentials] : [];
    });
  } catch {
    return [];
  }
}

function readJsonLogin(store: LoginStore): readonly unknown[] {
  const fd = openSync(store.path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_AUTH_FILE_BYTES) return [];
    const root = record(JSON.parse(readFileSync(fd, "utf8")));
    const key =
      store.source === "codex" ? "tokens" : store.source === "opencode" ? "openai" : "openai-codex";
    const credential: unknown = root?.[key];
    return Array.isArray(credential) ? credential : [credential];
  } finally {
    closeSync(fd);
  }
}

function readOmpDatabase(path: string): readonly unknown[] {
  const sqlite = process.getBuiltinModule?.("node:sqlite");
  if (!sqlite) return [];
  const db = new sqlite.DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    const rows = db
      .prepare(
        "SELECT data FROM auth_credentials WHERE provider = ? AND credential_type = 'oauth' AND disabled_cause IS NULL ORDER BY id LIMIT 64",
      )
      .all("openai-codex");
    return rows.flatMap((row) => {
      if (typeof row.data !== "string" || row.data.length > MAX_AUTH_FILE_BYTES) return [];
      try {
        const value: unknown = JSON.parse(row.data);
        return [value];
      } catch {
        return [];
      }
    });
  } finally {
    db.close();
  }
}

function savedCredentials(
  value: unknown,
  source: NativeSource,
): ResolvedCodexCredentials | undefined {
  const data = record(value);
  if (!data) return undefined;
  if (source !== "codex" && data.type !== undefined && data.type !== "oauth") return undefined;
  const fields =
    source === "codex"
      ? { access: "access_token", account: "account_id" }
      : { access: "access", account: "accountId" };
  const accessToken = stringValue(data[fields.access]);
  if (!accessToken || expired(data, accessToken)) return undefined;
  try {
    return resolveCodexCredentials({
      accessToken,
      accountId: stringValue(data[fields.account]),
    });
  } catch {
    return undefined;
  }
}

function expired(data: Readonly<Record<string, unknown>>, accessToken: string): boolean {
  if (typeof data.expires === "number" && data.expires <= Date.now()) return true;
  const exp = tokenClaims(accessToken)?.exp;
  return typeof exp === "number" && exp * 1000 <= Date.now();
}

function tokenClaims(token: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    return record(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return undefined;
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function validHeaderValue(value: unknown): value is string {
  return typeof value === "string" && /^[!-~]+$/u.test(value);
}
function missingLogin(): AuthError {
  return new AuthError(
    "No usable Codex login. Sign in with Pi, OMP, Codex, or OpenCode; let that client refresh an expired login. Explicit overrides: OPENAI_CODEX_ACCESS_TOKEN and OPENAI_CODEX_ACCOUNT_ID, or codex.credentials",
    "openai-codex",
  );
}
