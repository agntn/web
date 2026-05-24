export const builtinProviders = [
  'brave',
  'exa',
  'firecrawl',
  'jina',
  'searxng',
  'serpapi',
  'serpbase',
  'tavily',
] as const

export type WebSearchProviderName = typeof builtinProviders[number]
