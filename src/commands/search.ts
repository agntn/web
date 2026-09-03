import { defineCommand } from "citty";
import { consola } from "consola";
import { sanitizeTerminalText } from "../tui.ts";
import { providerApiKeyEnvVar } from "../core/providers.ts";
import {
  AuthError,
  NoProviderConfiguredError,
  SearchNotSupportedError,
  UnknownProviderError,
} from "../core/errors.ts";
import type {
  SearchAllResult,
  SearchProviderMetadata,
  SearchProviderPagination,
  SearchProviderResult,
} from "../core/all.ts";
import type { SearchFilterReport } from "../core/search-filters.ts";
import { MAX_SEARCH_CONTINUATION_LENGTH } from "../core/search-continuation.ts";
import type {
  ReadonlySearchResult,
  SearchPageOptions,
  SearchPagination,
  SearchResult,
} from "../core/types.ts";

export default defineCommand({
  meta: {
    name: "search",
    description: "Search the web using one or more providers",
  },
  args: {
    query: {
      type: "positional",
      description: "Search query; pass more than one quoted query for a batch",
      required: true,
    },
    provider: {
      type: "string",
      description: 'Search provider to use, or "all" for parallel search',
    },
    "max-results": {
      type: "string",
      description: "Maximum number of results",
      default: "10",
    },
    continuation: {
      type: "string",
      description: "Opaque token returned by a previous search through one provider",
    },
    highlights: {
      type: "boolean",
      description: "Return passages relevant to the query when supported",
      negativeDescription: "Disable passages relevant to the query when supported",
      default: true,
    },
    summary: {
      type: "boolean",
      description: "Request generated summaries or answers when supported",
      default: false,
    },
    "full-text": {
      type: "boolean",
      description: "Request full page text when supported",
      default: false,
    },
    "include-domains": {
      type: "string",
      description: "Domains to include, separated by commas",
    },
    "exclude-domains": {
      type: "string",
      description: "Domains to exclude, separated by commas",
    },
    sources: {
      type: "string",
      description: "Source types separated by commas when supported",
    },
    categories: {
      type: "string",
      description: "Categories separated by commas when supported",
    },
    category: {
      type: "string",
      description: "Single provider category when supported",
    },
    "start-published-date": {
      type: "string",
      description: "Only return results published after this ISO date",
    },
    "end-published-date": {
      type: "string",
      description: "Only return results published before this ISO date",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  async run({ args }) {
    const registry = await import("../core/registry.ts");
    const parsed = parseSearchArguments(args);
    const providerName = parsed.provider;
    try {
      await import("../providers/index.ts");
      const output = await runSearch(parsed);
      writeSearchOutput(output, parsed.json);
    } catch (error) {
      await handleSearchError(error, providerName, registry);
    }
  },
});

type SearchCommandArgs = {
  readonly _: readonly string[];
  readonly query: string;
  readonly provider?: string;
  readonly "max-results": string;
  readonly continuation?: string;
  readonly highlights: boolean;
  readonly summary: boolean;
  readonly "full-text": boolean;
  readonly "include-domains"?: string;
  readonly "exclude-domains"?: string;
  readonly sources?: string;
  readonly categories?: string;
  readonly category?: string;
  readonly "start-published-date"?: string;
  readonly "end-published-date"?: string;
  readonly json: boolean;
};

type ParsedSearchArguments = {
  readonly query: string | readonly string[];
  readonly provider?: string;
  readonly options: SearchPageOptions;
  readonly json: boolean;
};

type ReadonlySearchProviderResult = Readonly<Omit<SearchProviderResult, "results">> & {
  readonly results: readonly ReadonlySearchResult[];
};

type ReadonlySearchAllEvidence = ReadonlySearchResult & {
  readonly provider: SearchAllResult["provider"];
};

type ReadonlySearchAllResult = ReadonlySearchAllEvidence & {
  readonly providers: readonly string[];
  readonly evidence: readonly ReadonlySearchAllEvidence[];
};

type ReadonlySearchAllResponse = {
  readonly results: readonly ReadonlySearchAllResult[];
  readonly successfulProviders: readonly string[];
  readonly errors: readonly {
    readonly provider: string;
    readonly error: Readonly<Error>;
  }[];
  readonly filterReports: readonly Readonly<SearchFilterReport>[];
  readonly providerPagination: readonly Readonly<SearchProviderPagination>[];
  readonly providerMetadata?: readonly Readonly<SearchProviderMetadata>[];
};

type SerializableSearchAllResponse = Omit<ReadonlySearchAllResponse, "errors"> & {
  readonly errors: readonly { readonly provider: string; readonly error: string }[];
};

type ReadonlySearchBatchItem =
  | {
      readonly query: string;
      readonly provider: string;
      readonly results: readonly ReadonlySearchResult[];
      readonly filterReports: readonly Readonly<SearchFilterReport>[];
      readonly pagination?: SearchPagination;
      readonly providerPagination?: readonly Readonly<SearchProviderPagination>[];
      readonly providerMetadata?: readonly Readonly<SearchProviderMetadata>[];
    }
  | { readonly query: string; readonly error: string };

type SearchCommandOutput =
  | ReadonlySearchProviderResult
  | SerializableSearchAllResponse
  | readonly ReadonlySearchBatchItem[];

function parseSearchArguments(args: SearchCommandArgs): ParsedSearchArguments {
  const queries = args._.length > 1 ? args._ : [args.query];
  if (queries.some((query) => !query.trim())) {
    return exitWithError("Search query cannot be empty.");
  }
  const maxResults = parseMaxResults(args["max-results"]);
  if (!maxResults.ok) return exitWithError(maxResults.message);

  return {
    query: queries.length === 1 ? queries[0] : queries,
    provider: args.provider || undefined,
    options: parseSearchOptions(args, maxResults.value),
    json: args.json,
  };
}

function parseSearchOptions(args: SearchCommandArgs, maxResults: number): SearchPageOptions {
  const includeDomains = parseList(args["include-domains"]);
  const excludeDomains = parseList(args["exclude-domains"]);
  const sources = parseList(args.sources);
  const categories = parseList(args.categories);
  return {
    maxResults,
    ...(args.continuation === undefined ? {} : { continuation: args.continuation }),
    highlights: args.highlights,
    ...parseContentOptions(args),
    ...(includeDomains === undefined ? {} : { includeDomains }),
    ...(excludeDomains === undefined ? {} : { excludeDomains }),
    ...(sources === undefined ? {} : { sources }),
    ...(categories === undefined ? {} : { categories }),
    ...(args.category === undefined ? {} : { category: args.category }),
    ...(args["start-published-date"] === undefined
      ? {}
      : { startPublishedDate: args["start-published-date"] }),
    ...(args["end-published-date"] === undefined
      ? {}
      : { endPublishedDate: args["end-published-date"] }),
  };
}

function parseContentOptions(
  args: SearchCommandArgs,
): Pick<SearchPageOptions, "summary" | "fullText"> {
  return {
    ...(args.summary ? { summary: true } : {}),
    ...(args["full-text"] ? { fullText: true } : {}),
  };
}

async function runSearch(args: Readonly<ParsedSearchArguments>): Promise<SearchCommandOutput> {
  const { query, provider, options } = args;
  if (typeof query !== "string") {
    const { searchBatch } = await import("../core/batch.ts");
    return searchBatch(query, { provider, ...options });
  }

  const { searchAllDetailed, searchProviderDetailed, searchWithFallback } =
    await import("../core/all.ts");
  if (provider === "all") {
    return serializeSearchAllResponse(await searchAllDetailed(query, options));
  }
  if (provider !== undefined) {
    return searchProviderDetailed(provider, query, options);
  }
  return searchWithFallback(query, options);
}

function serializeSearchAllResponse(
  response: ReadonlySearchAllResponse,
): SerializableSearchAllResponse {
  return {
    ...response,
    errors: response.errors.map(({ provider, error }) => ({ provider, error: error.message })),
  };
}

function writeSearchOutput(output: SearchCommandOutput, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (isSearchBatchOutput(output)) {
    writeHumanSearchBatch(output);
    return;
  }
  writeHumanSearchResults(output.results);
  if ("errors" in output) reportProviderErrors(output.errors);
  if ("ignoredFilters" in output) {
    reportFilterWarning(output.provider, output.ignoredFilters, output.undeclaredFilters);
    reportPagination(output.provider, output.pagination);
  } else {
    for (const report of output.filterReports) {
      reportFilterWarning(report.provider, report.ignoredFilters, report.undeclaredFilters);
    }
    for (const page of output.providerPagination) {
      reportPagination(page.provider, page.pagination);
    }
  }
}

function isSearchBatchOutput(
  output: SearchCommandOutput,
): output is readonly ReadonlySearchBatchItem[] {
  return Array.isArray(output);
}

function writeHumanSearchBatch(outcomes: readonly ReadonlySearchBatchItem[]): void {
  for (const outcome of outcomes) {
    const query = sanitizeTerminalText(outcome.query, 2048);
    consola.log(`\x1B[1m${query}\x1B[0m`);
    if ("error" in outcome) {
      consola.error(sanitizeTerminalText(outcome.error, 2048));
      continue;
    }
    writeHumanSearchResults(outcome.results);
    for (const report of outcome.filterReports) {
      reportFilterWarning(report.provider, report.ignoredFilters, report.undeclaredFilters);
    }
    if (outcome.pagination !== undefined) {
      reportPagination(outcome.provider, outcome.pagination);
    }
    for (const page of outcome.providerPagination ?? []) {
      reportPagination(page.provider, page.pagination);
    }
  }
}

function writeHumanSearchResults(
  results: readonly Readonly<Pick<SearchResult, "title" | "url" | "snippet">>[],
): void {
  if (results.length === 0) {
    consola.info("No results found.");
    return;
  }
  for (const result of results) {
    const title = sanitizeTerminalText(result.title, 2048);
    const url = sanitizeTerminalText(result.url, 2048);
    consola.log(`\x1B[1m\x1B[36m${title}\x1B[0m`);
    consola.log(`  ${url}`);
    if (result.snippet) {
      const sanitizedSnippet = sanitizeTerminalText(result.snippet, 2048);
      const snippet =
        sanitizedSnippet.length > 120 ? `${sanitizedSnippet.slice(0, 120)}...` : sanitizedSnippet;
      consola.log(`  \x1B[90m${snippet}\x1B[0m`);
    }
    consola.log("");
  }
}

function reportPagination(providerName: string, pagination: SearchPagination): void {
  if (pagination.status !== "next" && pagination.status !== "unknown") return;
  const provider = sanitizeTerminalText(providerName, 200);
  const continuation = sanitizeTerminalText(
    pagination.continuation,
    MAX_SEARCH_CONTINUATION_LENGTH,
  );
  consola.info(`${provider} continuation (${pagination.status}): ${continuation}`);
}

function reportProviderErrors(
  errors: readonly { readonly provider: string; readonly error: string }[],
): void {
  for (const error of errors) {
    const provider = sanitizeTerminalText(error.provider, 200);
    const message = sanitizeTerminalText(error.error, 2048);
    consola.error(`${provider}: ${message}`);
  }
}

function reportFilterWarning(
  providerName: string,
  ignoredFilters: readonly string[],
  undeclaredFilters: readonly string[],
): void {
  const provider = sanitizeTerminalText(providerName, 200);
  if (ignoredFilters.length > 0) {
    consola.info(`${provider} ignored filters: ${ignoredFilters.join(", ")}`);
  }
  if (undeclaredFilters.length > 0) {
    consola.info(`${provider} has undeclared filters: ${undeclaredFilters.join(", ")}`);
  }
}

async function handleSearchError(
  error: unknown,
  providerName: string | undefined,
  registry: Readonly<Pick<typeof import("../core/registry.ts"), "providers">>,
): Promise<never> {
  if (error instanceof AuthError) {
    const provider = providerName || error.provider;
    const envVar = providerApiKeyEnvVar(provider);
    if (envVar !== null) consola.info(`Set the ${envVar} environment variable.`);
    return exitWithError(`Authentication failed for provider "${provider}".`);
  }
  if (error instanceof SearchNotSupportedError) {
    return exitWithError(`Provider "${error.provider}" does not support web search.`);
  }
  if (error instanceof UnknownProviderError) {
    reportAvailableProviders(registry.providers());
    return exitWithError(`Unknown provider: ${providerName}`);
  }
  if (error instanceof NoProviderConfiguredError) {
    await import("../providers/index.ts");
    reportConfiguredProviderHint(registry.providers());
    return exitWithError(error.message);
  }
  throw error;
}

function reportAvailableProviders(available: readonly string[]): void {
  consola.info(
    available.length > 0
      ? `Available providers: ${available.join(", ")}`
      : "No providers registered. Import a provider first.",
  );
}

function reportConfiguredProviderHint(available: readonly string[]): void {
  if (available.length === 0) return;
  consola.info(`Registered providers: ${available.join(", ")}`);
  consola.info("Set one provider API key env var or pass --provider explicitly.");
}

function exitWithError(message: string): never {
  consola.error(message);
  process.exit(1);
}

type ParsedMaxResults = { ok: true; value: number } | { ok: false; message: string };

function parseMaxResults(input: string): ParsedMaxResults {
  if (!/^\d+$/.test(input)) {
    return {
      ok: false,
      message: "Invalid --max-results value. Expected a positive integer.",
    };
  }

  const value = Number.parseInt(input, 10);
  if (value < 1) {
    return {
      ok: false,
      message: "Invalid --max-results value. Expected a positive integer.",
    };
  }

  return { ok: true, value };
}

function parseList(input: string | undefined): readonly string[] | undefined {
  if (input === undefined) return undefined;
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
