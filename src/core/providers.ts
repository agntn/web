export const builtinProviders = [
  'brave',
  'exa',
  'jina',
  'searxng',
  'serpapi',
  'tavily',
] as const

export type WebSearchProviderName = typeof builtinProviders[number]
