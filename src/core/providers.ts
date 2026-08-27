export const builtinProviders = [
  "brave",
  "context",
  "exa",
  "firecrawl",
  "jina",
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
] as const satisfies readonly WebSearchProviderName[];

export function providerApiKeyEnvVar(name: string): string | null {
  if (isBuiltinProviderName(name)) return providerApiKeyEnvVars[name];
  return `${name.toUpperCase()}_API_KEY`;
}

function isBuiltinProviderName(name: string): name is WebSearchProviderName {
  return Object.hasOwn(providerApiKeyEnvVars, name);
}
