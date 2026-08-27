export const builtinProviders = [
  "brave",
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
