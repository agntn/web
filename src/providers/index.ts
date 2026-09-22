import type { ProviderEntry } from "../core/registry.ts";
import { hasCodexCredentials } from "../core/codex-auth.ts";
import {
  FIRECRAWL_MAX_RESULTS,
  JINA_MAX_RESULTS,
  JINA_SEARCH_CATEGORIES,
  OPENAI_CODEX_MAX_RESULTS,
  SERPBASE_MAX_RESULTS,
  SERPBASE_SEARCH_CATEGORIES,
  TAVILY_SEARCH_TOPICS,
  TINYFISH_SEARCH_CATEGORIES,
} from "../core/providers.ts";

/** A built-in search entry declares what its class static used to: filters, content options and result fields. */
type BuiltinSearch = NonNullable<ProviderEntry["search"]> &
  Required<
    Pick<NonNullable<ProviderEntry["search"]>, "filters" | "contentOptions" | "resultFields">
  >;

interface BuiltinEntry extends ProviderEntry {
  readonly search?: BuiltinSearch;
}

/**
 * Every provider shipped with the package, in `builtinProviders` order.
 *
 * The metadata here is what `listProviders()`, `getProviderCapabilities()` and the capability
 * lists answer from. The adapter module is imported on the first `create()` for its name, so
 * nothing runs when the package is imported and a bundler splits each adapter into its own
 * chunk. A provider missing from this list is invisible to `create()`.
 */
export const builtins: readonly ProviderEntry[] = [
  {
    name: "brave",
    search: {
      filters: ["startPublishedDate", "endPublishedDate"],
      contentOptions: [],
      resultLimit: { default: 10, maximum: 20 },
      resultFields: ["publishedDate", "favicon", "text"],
      pagination: true,
    },
    load: () => import("./brave.ts").then((m) => m.BraveProvider),
  },
  {
    name: "context",
    search: {
      filters: ["includeDomains", "excludeDomains"],
      contentOptions: [],
      resultLimit: { default: 10, maximum: 100 },
      resultFields: ["text", "metadata"],
    },
    read: {
      options: ["format", "targetSelector", "removeSelector", "timeout", "noCache"],
      formats: ["markdown", "html"],
    },
    load: () => import("./context.ts").then((m) => m.ContextProvider),
  },
  {
    name: "exa",
    search: {
      filters: [
        "includeDomains",
        "excludeDomains",
        "category",
        "startPublishedDate",
        "endPublishedDate",
      ],
      contentOptions: ["highlights", "summary", "fullText"],
      resultLimit: { default: 10, maximum: 100 },
      resultFields: [
        "score",
        "publishedDate",
        "author",
        "image",
        "favicon",
        "text",
        "highlights",
        "summary",
      ],
    },
    load: () => import("./exa.ts").then((m) => m.ExaProvider),
  },
  {
    name: "firecrawl",
    search: {
      filters: ["includeDomains", "excludeDomains", "sources", "categories"],
      contentOptions: ["highlights"],
      resultLimit: { default: 10, maximum: FIRECRAWL_MAX_RESULTS },
      resultFields: ["publishedDate", "image", "text", "metadata"],
    },
    read: {
      options: ["format", "targetSelector", "removeSelector", "timeout", "noCache"],
      formats: ["markdown", "html"],
    },
    load: () => import("./firecrawl.ts").then((m) => m.FirecrawlProvider),
  },
  {
    name: "jina",
    search: {
      filters: ["includeDomains", "category"],
      categories: JINA_SEARCH_CATEGORIES,
      contentOptions: [],
      resultLimit: { default: 10, maximum: JINA_MAX_RESULTS },
      resultFields: ["publishedDate", "image", "text", "metadata"],
    },
    read: {
      options: ["format", "maxTokens", "targetSelector", "removeSelector", "timeout", "noCache"],
      formats: ["markdown", "text", "html"],
    },
    load: () => import("./jina.ts").then((m) => m.JinaProvider),
  },
  {
    name: "mojeek",
    search: {
      filters: ["includeDomains", "excludeDomains", "startPublishedDate", "endPublishedDate"],
      contentOptions: [],
      resultLimit: { default: 10 },
      resultFields: ["score", "publishedDate", "image", "metadata"],
      pagination: true,
    },
    load: () => import("./mojeek.ts").then((m) => m.MojeekProvider),
  },
  {
    name: "openai-codex",
    isConfigured: hasCodexCredentials,
    search: {
      filters: [],
      contentOptions: ["summary"],
      resultLimit: { default: 10, maximum: OPENAI_CODEX_MAX_RESULTS },
      resultFields: [],
    },
    load: () => import("./openai-codex.ts").then((m) => m.OpenAICodexProvider),
  },
  {
    name: "searxng",
    availability: true,
    search: {
      filters: ["category"],
      contentOptions: [],
      resultFields: ["score", "publishedDate", "image", "metadata"],
      pagination: true,
    },
    load: () => import("./searxng.ts").then((m) => m.SearXNGProvider),
  },
  {
    name: "serpapi",
    search: {
      filters: ["startPublishedDate", "endPublishedDate"],
      contentOptions: [],
      resultLimit: { default: 10 },
      resultFields: ["publishedDate", "image", "favicon", "metadata"],
      pagination: true,
    },
    searchImage: {
      resultLimit: { default: 10 },
    },
    load: () => import("./serpapi.ts").then((m) => m.SerpApiProvider),
  },
  {
    name: "serpbase",
    search: {
      filters: ["category"],
      categories: SERPBASE_SEARCH_CATEGORIES,
      contentOptions: [],
      resultLimit: { default: 10, maximum: SERPBASE_MAX_RESULTS },
      resultFields: ["publishedDate", "image", "favicon", "metadata"],
      pagination: true,
    },
    load: () => import("./serpbase.ts").then((m) => m.SerpBaseProvider),
  },
  {
    name: "tavily",
    search: {
      filters: [
        "includeDomains",
        "excludeDomains",
        "category",
        "startPublishedDate",
        "endPublishedDate",
      ],
      categories: TAVILY_SEARCH_TOPICS,
      contentOptions: ["summary", "fullText"],
      resultLimit: { default: 10, maximum: 20 },
      resultFields: ["score", "publishedDate", "text"],
    },
    read: {
      options: ["format", "timeout"],
      formats: ["markdown", "text"],
    },
    load: () => import("./tavily.ts").then((m) => m.TavilyProvider),
  },
  {
    name: "tinyfish",
    search: {
      filters: [
        "includeDomains",
        "excludeDomains",
        "category",
        "startPublishedDate",
        "endPublishedDate",
      ],
      categories: TINYFISH_SEARCH_CATEGORIES,
      contentOptions: [],
      resultLimit: { default: 10 },
      resultFields: ["publishedDate", "author", "metadata"],
      pagination: true,
    },
    read: {
      options: ["format", "targetSelector", "removeSelector", "timeout", "noCache"],
      formats: ["markdown", "html"],
    },
    load: () => import("./tinyfish.ts").then((m) => m.TinyfishProvider),
  },
] satisfies readonly BuiltinEntry[];
