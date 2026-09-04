/**
 * One row per built-in provider, shared by the landing grid, the sidebar icons, the explorer
 * and the `::provider-facts` strip. Capability columns mirror `listProviders()` on the library;
 * regenerate the matrix with `node -e 'import("@agntn/web").then(m => console.log(JSON.stringify(m.listProviders())))'`.
 */
export interface ProviderInfo {
  /** Registry key, the value passed to `create()` and reported as `provider`. */
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  /** Environment variable read by `create()`; null when registration is enough. */
  readonly envVar: string | null;
  /** Where the key travels. */
  readonly auth: string;
  /** Default API host passed to the constructor. */
  readonly host: string;
  readonly freeTier: string;
  readonly search: boolean;
  readonly searchImage: boolean;
  readonly read: boolean;
  readonly filters: readonly string[];
  readonly categories: readonly string[];
  readonly contentOptions: readonly string[];
  readonly pagination: boolean;
  readonly resultLimit: string;
  readonly resultFields: readonly string[];
  readonly readFormats: readonly string[];
  readonly readOptions: readonly string[];
  readonly to: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    key: "brave",
    label: "Brave",
    icon: "i-simple-icons-brave",
    envVar: "BRAVE_API_KEY",
    auth: "X-Subscription-Token header",
    host: "api.search.brave.com",
    freeTier: "2k queries a month",
    search: true,
    searchImage: false,
    read: false,
    filters: [],
    categories: [],
    contentOptions: [],
    pagination: true,
    resultLimit: "10, up to 20",
    resultFields: ["favicon", "text"],
    readFormats: [],
    readOptions: [],
    to: "/providers/brave",
  },
  {
    key: "context",
    label: "Context.dev",
    icon: "i-lucide-book-text",
    envVar: "CONTEXT_DEV_API_KEY",
    auth: "Bearer header",
    host: "api.context.dev",
    freeTier: "credit based",
    search: true,
    searchImage: false,
    read: true,
    filters: ["includeDomains", "excludeDomains"],
    categories: [],
    contentOptions: [],
    pagination: false,
    resultLimit: "10, up to 100",
    resultFields: ["text", "metadata"],
    readFormats: ["markdown", "html"],
    readOptions: ["format", "targetSelector", "removeSelector", "timeout", "noCache"],
    to: "/providers/context",
  },
  {
    key: "exa",
    label: "Exa",
    icon: "i-lucide-sparkles",
    envVar: "EXA_API_KEY",
    auth: "x-api-key header",
    host: "api.exa.ai",
    freeTier: "1k queries a month",
    search: true,
    searchImage: false,
    read: false,
    filters: ["includeDomains", "excludeDomains", "category", "startPublishedDate", "endPublishedDate"],
    categories: [],
    contentOptions: ["highlights", "summary", "fullText"],
    pagination: false,
    resultLimit: "10, up to 100",
    resultFields: ["score", "publishedDate", "author", "image", "favicon", "text", "highlights", "summary"],
    readFormats: [],
    readOptions: [],
    to: "/providers/exa",
  },
  {
    key: "firecrawl",
    label: "Firecrawl",
    icon: "i-lucide-flame",
    envVar: "FIRECRAWL_API_KEY",
    auth: "Bearer header",
    host: "api.firecrawl.dev",
    freeTier: "credit based",
    search: true,
    searchImage: false,
    read: true,
    filters: ["includeDomains", "excludeDomains", "sources", "categories"],
    categories: [],
    contentOptions: ["highlights"],
    pagination: false,
    resultLimit: "10, up to 100",
    resultFields: ["image", "text", "metadata"],
    readFormats: ["markdown", "html"],
    readOptions: ["format", "targetSelector", "removeSelector", "timeout", "noCache"],
    to: "/providers/firecrawl",
  },
  {
    key: "jina",
    label: "Jina",
    icon: "i-lucide-file-text",
    envVar: "JINA_API_KEY",
    auth: "Bearer header, optional for read",
    host: "s.jina.ai, r.jina.ai",
    freeTier: "key required for search, optional for read",
    search: true,
    searchImage: false,
    read: true,
    filters: ["includeDomains", "category"],
    categories: ["web", "images", "news"],
    contentOptions: [],
    pagination: false,
    resultLimit: "10, up to 20",
    resultFields: ["publishedDate", "image", "text", "metadata"],
    readFormats: ["markdown", "text", "html"],
    readOptions: ["format", "maxTokens", "targetSelector", "removeSelector", "timeout", "noCache"],
    to: "/providers/jina",
  },
  {
    key: "mojeek",
    label: "Mojeek",
    icon: "i-simple-icons-mojeek",
    envVar: "MOJEEK_API_KEY",
    auth: "query parameter",
    host: "api.mojeek.com",
    freeTier: "limited trial",
    search: true,
    searchImage: false,
    read: false,
    filters: ["includeDomains", "excludeDomains", "startPublishedDate", "endPublishedDate"],
    categories: [],
    contentOptions: [],
    pagination: true,
    resultLimit: "10",
    resultFields: ["score", "publishedDate", "image", "metadata"],
    readFormats: [],
    readOptions: [],
    to: "/providers/mojeek",
  },
  {
    key: "searxng",
    label: "SearXNG",
    icon: "i-simple-icons-searxng",
    envVar: null,
    auth: "none, self-hosted",
    host: "localhost:8080 by default",
    freeTier: "your own instance",
    search: true,
    searchImage: false,
    read: false,
    filters: ["category"],
    categories: [],
    contentOptions: [],
    pagination: true,
    resultLimit: "what the instance returns",
    resultFields: ["score", "publishedDate", "image", "metadata"],
    readFormats: [],
    readOptions: [],
    to: "/providers/searxng",
  },
  {
    key: "serpapi",
    label: "SerpAPI",
    icon: "i-lucide-scan-search",
    envVar: "SERPAPI_API_KEY",
    auth: "query parameter",
    host: "serpapi.com",
    freeTier: "100 queries a month",
    search: true,
    searchImage: true,
    read: false,
    filters: [],
    categories: [],
    contentOptions: [],
    pagination: true,
    resultLimit: "10",
    resultFields: ["publishedDate", "image", "favicon", "metadata"],
    readFormats: [],
    readOptions: [],
    to: "/providers/serpapi",
  },
  {
    key: "serpbase",
    label: "SerpBase",
    icon: "i-lucide-layers",
    envVar: "SERPBASE_API_KEY",
    auth: "X-API-Key header",
    host: "api.serpbase.dev",
    freeTier: "100 searches to start",
    search: true,
    searchImage: false,
    read: false,
    filters: ["category"],
    categories: ["images", "image", "news", "videos", "video"],
    contentOptions: [],
    pagination: true,
    resultLimit: "10, up to 20",
    resultFields: ["publishedDate", "image", "favicon", "metadata"],
    readFormats: [],
    readOptions: [],
    to: "/providers/serpbase",
  },
  {
    key: "tavily",
    label: "Tavily",
    icon: "i-lucide-compass",
    envVar: "TAVILY_API_KEY",
    auth: "request body",
    host: "api.tavily.com",
    freeTier: "1k queries a month",
    search: true,
    searchImage: false,
    read: false,
    filters: ["includeDomains", "excludeDomains"],
    categories: [],
    contentOptions: ["summary", "fullText"],
    pagination: false,
    resultLimit: "10, up to 20",
    resultFields: ["score", "publishedDate", "text"],
    readFormats: [],
    readOptions: [],
    to: "/providers/tavily",
  },
  {
    key: "tinyfish",
    label: "TinyFish",
    icon: "i-lucide-fish",
    envVar: "TINYFISH_API_KEY",
    auth: "X-API-Key header",
    host: "api.search.tinyfish.ai",
    freeTier: "free at $0, Search access required",
    search: true,
    searchImage: false,
    read: true,
    filters: ["includeDomains", "excludeDomains", "category", "startPublishedDate", "endPublishedDate"],
    categories: ["news", "research_paper"],
    contentOptions: [],
    pagination: true,
    resultLimit: "10",
    resultFields: ["publishedDate", "author", "metadata"],
    readFormats: ["markdown", "html"],
    readOptions: ["format", "targetSelector", "removeSelector", "timeout", "noCache"],
    to: "/providers/tinyfish",
  },
];

const BY_KEY = new Map(PROVIDERS.map((provider) => [provider.key, provider]));

export function providerInfo(key: string): ProviderInfo | undefined {
  return BY_KEY.get(key);
}

export function providerLabel(key: string): string {
  return providerInfo(key)?.label ?? key;
}

export function providerIcon(key: string): string {
  return providerInfo(key)?.icon ?? "i-lucide-globe";
}

export const SEARCH_PROVIDERS = PROVIDERS.filter((provider) => provider.search);
export const READ_PROVIDERS = PROVIDERS.filter((provider) => provider.read);
export const IMAGE_PROVIDERS = PROVIDERS.filter((provider) => provider.searchImage);
