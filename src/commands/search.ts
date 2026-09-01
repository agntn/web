import { defineCommand } from "citty";
import { consola } from "consola";
import { providerApiKeyEnvVar } from "../core/providers.ts";
import {
  AuthError,
  NoProviderConfiguredError,
  SearchNotSupportedError,
  UnknownProviderError,
} from "../core/errors.ts";

export default defineCommand({
  meta: {
    name: "search",
    description: "Search the web using a provider",
  },
  args: {
    query: {
      type: "positional",
      description: "Search query",
      required: true,
    },
    provider: {
      type: "string",
      description: "Search provider to use",
    },
    "max-results": {
      type: "string",
      description: "Maximum number of results",
      default: "10",
    },
    highlights: {
      type: "boolean",
      description: "Return query-relevant passages when supported",
      negativeDescription: "Disable query-relevant passages when supported",
      default: true,
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
      if (providerName) {
        const providerTypes = await import("../core/provider.ts");
        const provider = registry.createSearchProvider(providerName, {});
        await writeSearchResult(provider, providerTypes, parsed);
        return;
      }

      const { searchWithFallback } = await import("../core/all.ts");
      const response = await searchWithFallback(parsed.query, {
        maxResults: parsed.maxResults,
        highlights: parsed.highlights,
      });
      writeSearchResults(response.results, parsed.json);
    } catch (error) {
      await handleSearchError(error, providerName, registry);
    }
  },
});

type SearchCommandArgs = {
  readonly query: string;
  readonly provider?: string;
  readonly "max-results": string;
  readonly highlights: boolean;
  readonly json: boolean;
};

type ParsedSearchArguments = {
  readonly query: string;
  readonly provider?: string;
  readonly maxResults: number;
  readonly highlights: boolean;
  readonly json: boolean;
};

function parseSearchArguments(args: SearchCommandArgs): ParsedSearchArguments {
  if (!args.query.trim()) return exitWithError("Search query cannot be empty.");
  const maxResults = parseMaxResults(args["max-results"]);
  if (!maxResults.ok) return exitWithError(maxResults.message);
  return {
    query: args.query,
    provider: args.provider,
    maxResults: maxResults.value,
    highlights: args.highlights,
    json: args.json,
  };
}

async function writeSearchResult(
  provider: { readonly search: import("../core/provider.ts").SearchProvider["search"] },
  providerTypes: Readonly<Pick<typeof import("../core/provider.ts"), "isDetailedSearchProvider">>,
  args: Readonly<ParsedSearchArguments>,
): Promise<void> {
  if (args.json && providerTypes.isDetailedSearchProvider(provider)) {
    const response = await provider.searchDetailed(args.query, {
      maxResults: args.maxResults,
      highlights: args.highlights,
    });
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }
  const results = await provider.search(args.query, {
    maxResults: args.maxResults,
    highlights: args.highlights,
  });
  writeSearchResults(results, args.json);
}

function writeSearchResults(
  results: readonly Readonly<
    Pick<import("../core/types.ts").SearchResult, "title" | "url" | "snippet">
  >[],
  json: boolean,
): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }
  writeHumanSearchResults(results);
}

function writeHumanSearchResults(
  results: readonly Readonly<
    Pick<import("../core/types.ts").SearchResult, "title" | "url" | "snippet">
  >[],
): void {
  if (results.length === 0) {
    consola.info("No results found.");
    return;
  }
  for (const result of results) {
    consola.log(`\x1B[1m\x1B[36m${result.title}\x1B[0m`);
    consola.log(`  ${result.url}`);
    if (result.snippet) {
      const snippet =
        result.snippet.length > 120 ? `${result.snippet.slice(0, 120)}...` : result.snippet;
      consola.log(`  \x1B[90m${snippet}\x1B[0m`);
    }
    consola.log("");
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
