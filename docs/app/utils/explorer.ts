/**
 * The explorer's operations and the answers the docs worker sends for them. The answer shapes mirror
 * the route files in `server/api/`, which own them.
 */
export interface WireResult {
  url: string;
  title: string;
  snippet: string;
  score?: number;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
  summary?: string;
}

export interface WireFailure {
  provider: string;
  message: string;
}

/** Mirrors `SearchAnswer` in `server/api/search.get.ts`. */
export interface SearchAnswer {
  query: string;
  requestedProvider: string;
  provider: string;
  results: WireResult[];
  pagination: string;
  ignoredFilters: string[];
  undeclaredFilters: string[];
  attempts?: string[];
  failures?: WireFailure[];
  fetchedAt: string;
}

/** Mirrors `FanoutAnswer` in `server/api/all.get.ts`. */
export interface FanoutAnswer {
  query: string;
  results: (WireResult & { providers: string[] })[];
  providers: string[];
  successfulProviders: string[];
  errors: WireFailure[];
  providerPagination: { provider: string; status: string }[];
  fetchedAt: string;
}

/** Mirrors `ReadAnswer` in `server/api/read.get.ts`. */
export interface ReadAnswer {
  url: string;
  title: string;
  description: string;
  content: string;
  chars: number;
  truncated: boolean;
  requestedProvider: string;
  provider: string;
  attempts: string[];
  failures: WireFailure[];
  fetchedAt: string;
}

export interface ProviderRow {
  name: string;
  configured: boolean;
  envVar: string | null;
  capabilities: {
    search: {
      supported: boolean;
      filters?: string[];
      pagination?: boolean;
      resultLimit?: { default?: number; maximum?: number };
      resultFields?: string[];
    };
    searchImage: { supported: boolean };
    read: { supported: boolean; formats?: string[] };
  };
}

/** Mirrors `ProvidersAnswer` in `server/api/providers.get.ts`, the part the page reads. */
export interface ProvidersAnswer {
  version: string;
  providers: ProviderRow[];
}

export type Operation = "search" | "fanout" | "read" | "providers";

export interface OperationInfo {
  readonly key: Operation;
  readonly label: string;
  readonly icon: string;
  /** The worker route that answers it. */
  readonly route: string;
  /** The library function the worker calls. */
  readonly method: string;
}

export const OPERATIONS: readonly OperationInfo[] = [
  { key: "search", label: "Search", icon: "i-lucide-search", route: "/api/search", method: "searchProviderDetailed" },
  { key: "fanout", label: "Fan-out", icon: "i-lucide-git-fork", route: "/api/all", method: "searchAllDetailed" },
  { key: "read", label: "Read", icon: "i-lucide-file-text", route: "/api/read", method: "readUrlDetailed" },
  { key: "providers", label: "Providers", icon: "i-lucide-layers", route: "/api/providers", method: "listProviders" },
];

export const EXAMPLE_QUERIES = [
  "TypeScript 7 native compiler",
  "Model Context Protocol tool result schema",
  "Nitro cloudflare workers preset",
] as const;

export const EXAMPLE_URLS = [
  "https://nitro.build/deploy/providers/cloudflare",
  "https://modelcontextprotocol.io/specification/draft/server/tools",
] as const;

/** The bounds the read form offers, all within the worker's cap in `server/utils/query.ts`. */
export const READ_BOUNDS = [500, 2000, 8000] as const;

/** Everything a form holds; the explorer keeps it in the query, the landing hands it to the explorer. */
export interface ExplorerFields {
  operation: Operation;
  query: string;
  url: string;
  /** `auto` or a search provider's key. */
  provider: string;
  /** `auto` or a reader's key. */
  reader: string;
  maxChars: number;
}

export const DEFAULT_FIELDS: Readonly<ExplorerFields> = {
  operation: "search",
  query: EXAMPLE_QUERIES[0],
  url: EXAMPLE_URLS[0],
  provider: "auto",
  reader: "auto",
  maxChars: 2000,
};

/**
 * The address of one explorer state, the same the explorer writes after a run.
 *
 * @param {ExplorerFields} fields - What the form holds.
 * @returns {Record<string, string>} The query of `/explorer` for it.
 */
export function explorerQuery(fields: Readonly<ExplorerFields>): Record<string, string> {
  switch (fields.operation) {
    case "search":
      return { op: "search", q: fields.query.trim(), provider: fields.provider };
    case "fanout":
      return { op: "fanout", q: fields.query.trim() };
    case "read":
      return { op: "read", url: fields.url.trim(), provider: fields.reader, maxChars: String(fields.maxChars) };
    default:
      return { op: "providers" };
  }
}

/**
 * The CLI line that asks the same thing.
 *
 * @param {ExplorerFields} fields - What the form holds.
 * @returns {string} A `web` command with `--json`.
 */
export function cliLine(fields: Readonly<ExplorerFields>): string {
  switch (fields.operation) {
    case "search":
      return `web search "${fields.query}"${fields.provider === "auto" ? "" : ` --provider ${fields.provider}`} --json`;
    case "fanout":
      return `web search "${fields.query}" --provider all --json`;
    case "read":
      return `web read ${fields.url}${fields.reader === "auto" ? "" : ` --provider ${fields.reader}`} --max-chars ${fields.maxChars} --json`;
    default:
      return "web providers --json";
  }
}
