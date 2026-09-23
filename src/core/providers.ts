export const builtinProviders = [
  "brave",
  "context",
  "exa",
  "firecrawl",
  "jina",
  "marginalia",
  "mojeek",
  "openai-codex",
  "searxng",
  "serpapi",
  "serpbase",
  "tavily",
  "tinyfish",
] as const;

export type WebSearchProviderName = (typeof builtinProviders)[number];

const providerApiKeyEnvVars = {
  brave: "BRAVE_API_KEY",
  context: "CONTEXT_DEV_API_KEY",
  exa: "EXA_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
  jina: "JINA_API_KEY",
  marginalia: "MARGINALIA_API_KEY",
  mojeek: "MOJEEK_API_KEY",
  "openai-codex": "OPENAI_CODEX_ACCESS_TOKEN",
  searxng: null,
  serpapi: "SERPAPI_API_KEY",
  serpbase: "SERPBASE_API_KEY",
  tavily: "TAVILY_API_KEY",
  tinyfish: "TINYFISH_API_KEY",
} as const satisfies Record<WebSearchProviderName, string | null>;

export const providerDetectionOrder = [
  "exa",
  "brave",
  "context",
  "firecrawl",
  "jina",
  "tavily",
  "tinyfish",
  "serpapi",
  "serpbase",
  "mojeek",
  "marginalia",
  "openai-codex",
] as const satisfies readonly WebSearchProviderName[];

export function providerApiKeyEnvVar(name: string): string | null {
  if (isBuiltinProviderName(name)) return providerApiKeyEnvVars[name];
  return `${name.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "_")}_API_KEY`;
}

function isBuiltinProviderName(name: string): name is WebSearchProviderName {
  return Object.hasOwn(providerApiKeyEnvVars, name);
}

/*
 * Result caps and category lists a built-in adapter clamps to. The manifest advertises the same
 * values, and both read them here so neither side has a copy to drift.
 */
export const FIRECRAWL_MAX_RESULTS = 100;
export const JINA_MAX_RESULTS = 20;
export const JINA_SEARCH_CATEGORIES = ["web", "images", "news"] as const;
export const MARGINALIA_MAX_RESULTS = 100;
export const OPENAI_CODEX_MAX_RESULTS = 100;
export const SERPBASE_MAX_RESULTS = 20;
export const SERPBASE_SEARCH_CATEGORIES = ["images", "image", "news", "videos", "video"] as const;
export const TAVILY_SEARCH_TOPICS = ["general", "news", "finance"] as const;
export const TINYFISH_SEARCH_CATEGORIES = ["news", "research_paper"] as const;
