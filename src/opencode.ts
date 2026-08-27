import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { encode } from "@toon-format/toon";
import { builtinProviders } from "./core/providers.ts";
import { createSearchProvider } from "./core/registry.ts";
import { searchAll } from "./core/all.ts";
import { readProviderNames, readUrl } from "./core/read.ts";
import { MAX_BATCH_ITEMS, readBatch, searchBatch } from "./core/batch.ts";
import { resolveDefaultProvider, listProviders } from "./core/resolve.ts";
import "./providers/index.ts";

const z = tool.schema;
const providerNames = [...builtinProviders, "all"] as const;

const WebPlugin: Plugin = async () => ({
  tool: {
    web_search: tool({
      description:
        'Search the web using multiple search engines (Brave, Context.dev, Exa, Firecrawl, Jina, Tavily, TinyFish, SerpAPI, SerpBase, SearXNG). Pass one query or a batch of queries; each batch item returns its own results or error. Use provider "all" to query all available providers in parallel and get deduplicated results.',
      args: {
        query: z
          .union([z.string(), z.array(z.string()).min(1).max(MAX_BATCH_ITEMS)])
          .describe("Search query, or a batch of search queries"),
        provider: z
          .enum(providerNames)
          .optional()
          .describe(
            'Provider to use. Defaults to first available from env. Use "all" for parallel search.',
          ),
        maxResults: z.number().min(1).max(20).optional().describe("Max results (default: 10)"),
      },
      async execute(args) {
        const { query, provider: providerName, maxResults } = args;

        if (Array.isArray(query)) {
          return encode(await searchBatch(query, { provider: providerName, maxResults }));
        }
        if (providerName === "all") {
          return encode(await searchAll(query, { maxResults }));
        }

        const name = providerName ?? resolveDefaultProvider();
        return encode(await createSearchProvider(name).search(query, { maxResults }));
      },
    }),
    web_read: tool({
      description:
        "Read one URL or a batch of URLs into normalized content using Jina, Context.dev, Firecrawl, or TinyFish. Each batch item returns its own result or error. Defaults to Jina Reader (r.jina.ai).",
      args: {
        url: z
          .union([z.string(), z.array(z.string()).min(1).max(MAX_BATCH_ITEMS)])
          .describe("URL to read, or a batch of URLs"),
        provider: z
          .enum(readProviderNames)
          .optional()
          .describe("Read provider to use. Defaults to Jina."),
        format: z
          .enum(["markdown", "text", "html"])
          .optional()
          .describe("Preferred content format."),
        maxTokens: z
          .number()
          .min(1)
          .optional()
          .describe("Maximum tokens to return when supported by the provider."),
      },
      async execute(args) {
        const { url, provider, format, maxTokens } = args;
        const readOptions = { provider, format, maxTokens };
        return encode(
          Array.isArray(url) ? await readBatch(url, readOptions) : await readUrl(url, readOptions),
        );
      },
    }),
    web_providers: tool({
      description: "List available web search providers and their configuration status.",
      args: {},
      async execute() {
        return encode(listProviders());
      },
    }),
  },
});

export { WebPlugin };
export default WebPlugin;
