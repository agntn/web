import { defineCommand } from "citty";
import { consola } from "consola";
import { sanitizeTerminalText } from "../tui.ts";
import { imageSearchProviderNames, searchByImage } from "../core/image.ts";
import { providerApiKeyEnvVar } from "../core/providers.ts";
import {
  AuthError,
  EmptyImageUrlError,
  ImageSearchNotSupportedError,
  InvalidImageUrlError,
  UnknownProviderError,
} from "../core/errors.ts";
import type { ImageSearchResult } from "../core/types.ts";

export default defineCommand({
  meta: {
    name: "search-image",
    description: "Find public pages from an image URL",
  },
  args: {
    url: {
      type: "positional",
      description: "Public image URL",
      required: true,
    },
    provider: {
      type: "string",
      description: "Reverse image search provider",
    },
    "max-results": {
      type: "string",
      description: "Maximum number of results",
      default: "10",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  async run({ args }) {
    const maxResults = parseMaxResults(args["max-results"]);
    try {
      const results = await searchByImage(args.url, {
        provider: args.provider?.trim() || undefined,
        maxResults,
      });
      writeImageSearchResults(results, args.json);
    } catch (error) {
      handleImageSearchError(error);
    }
  },
});

function parseMaxResults(input: string): number {
  if (!/^\d+$/.test(input))
    return exitWithError("Invalid --max-results value. Expected a positive integer.");
  const value = Number.parseInt(input, 10);
  if (value < 1) return exitWithError("Invalid --max-results value. Expected a positive integer.");
  return value;
}

function writeImageSearchResults(
  results: readonly Readonly<ImageSearchResult>[],
  json: boolean,
): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }
  if (results.length === 0) {
    consola.info("No image matches found.");
    return;
  }
  for (const result of results) {
    consola.log(
      `\x1B[1m\x1B[36m${sanitizeTerminalText(result.title || "(no title)", 2048)}\x1B[0m`,
    );
    consola.log(`  ${sanitizeTerminalText(result.pageUrl, 2048)}`);
    consola.log(`  \x1B[90m${sanitizeTerminalText(result.imageUrl, 2048)}\x1B[0m`);
    consola.log("");
  }
}

function handleImageSearchError(error: unknown): never {
  if (error instanceof EmptyImageUrlError || error instanceof InvalidImageUrlError) {
    return exitWithError(error.message);
  }
  if (error instanceof AuthError) {
    const envVar = providerApiKeyEnvVar(error.provider);
    if (envVar !== null) consola.info(`Set the ${envVar} environment variable.`);
    return exitWithError(`Authentication failed for provider "${error.provider}".`);
  }
  if (error instanceof UnknownProviderError) {
    consola.info(`Reverse image search providers: ${imageSearchProviderNames.join(", ")}`);
    return exitWithError(`Unknown provider: ${error.provider}`);
  }
  if (error instanceof ImageSearchNotSupportedError) return exitWithError(error.message);
  throw error;
}

function exitWithError(message: string): never {
  consola.error(message);
  process.exit(1);
}
