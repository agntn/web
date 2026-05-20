import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"
import { Type, type Static } from "typebox"
import type {
  ProviderError,
  ProviderStatus,
  ReadOptions,
  ReadProviderName,
  ReadResult,
  SearchAllResult,
  SearchOptions,
  SearchResult,
  WebSearchProviderName,
} from "askweb"

type SearchSingleDetails = {
  mode: "single"
  query: string
  provider: WebSearchProviderName
  options: SearchOptions
  count: number
  results: SearchResult[]
}

type SearchAllDetails = {
  mode: "all"
  query: string
  options: SearchOptions
  count: number
  results: SearchAllResult[]
  errors: { provider: string; error: string }[]
}

type SearchDetails = SearchSingleDetails | SearchAllDetails

type ReadDetails = {
  mode: "read"
  url: string
  provider: ReadProviderName
  options: ReadOptions
  result: ReadResult
}

type AskwebModule = typeof import("askweb")

let askwebModulePromise: Promise<AskwebModule> | undefined

function loadAskweb(): Promise<AskwebModule> {
  if (!askwebModulePromise) {
    askwebModulePromise = import("askweb").catch(() => import("../../../src/index.ts"))
  }
  return askwebModulePromise
}

const PROVIDERS = ["auto", "all", "brave", "exa", "jina", "searxng", "serpapi", "tavily"] as const
const PROVIDER_HINT = `Provider to use. One of: ${PROVIDERS.join(", ")}. "auto" (or omit) picks the first available provider from env. Use "all" to query every configured provider in parallel.`
const READ_PROVIDER_HINT = "Read provider to use. Defaults to Jina and is validated against askweb.readProviderNames at execution time."

const MAX_RESULTS_HARD_CAP = 20
const DEFAULT_MAX_RESULTS = 10

const searchParameters = Type.Object({
  query: Type.String({ description: "Search query." }),
  provider: Type.Optional(Type.String({ description: PROVIDER_HINT })),
  maxResults: Type.Optional(
    Type.Number({
      description: `Maximum results to return. Defaults to ${DEFAULT_MAX_RESULTS}.`,
      minimum: 1,
      maximum: MAX_RESULTS_HARD_CAP,
    }),
  ),
  includeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Only return results from these domains (e.g. ["github.com", "stackoverflow.com"]).',
    }),
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude results from these domains.",
    }),
  ),
  category: Type.Optional(
    Type.String({
      description: 'Search category (e.g. "news", "general"). Provider support varies.',
    }),
  ),
  startPublishedDate: Type.Optional(
    Type.String({
      description: 'ISO date filter: only results published after this date (e.g. "2024-01-01").',
    }),
  ),
  endPublishedDate: Type.Optional(
    Type.String({
      description: "ISO date filter: only results published before this date.",
    }),
  ),
})

const readParameters = Type.Object({
  url: Type.String({ description: "URL to read." }),
  provider: Type.Optional(Type.String({ description: READ_PROVIDER_HINT })),
  format: Type.Optional(
    Type.String({ description: 'Preferred content format: "markdown", "text", or "html".' }),
  ),
  maxTokens: Type.Optional(
    Type.Number({ description: "Maximum tokens to return when supported.", minimum: 1 }),
  ),
  targetSelector: Type.Optional(
    Type.String({ description: "CSS selector to target when supported." }),
  ),
  removeSelector: Type.Optional(
    Type.String({ description: "CSS selector to remove when supported." }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Provider timeout in seconds when supported.", minimum: 1 }),
  ),
  noCache: Type.Optional(
    Type.Boolean({ description: "Bypass provider cache when supported." }),
  ),
})

const emptyParameters = Type.Object({})

type SearchParams = Static<typeof searchParameters>
type ReadParams = Static<typeof readParameters>
type EmptyParams = Static<typeof emptyParameters>
type ProviderInput = (typeof PROVIDERS)[number]
type ReadProviderInput = ReadProviderName

export default function askwebExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "askweb",
    label: "Askweb Search",
    description:
      "Read-only/open-world network search: query one configured provider (Brave, Exa, Jina, Tavily, SerpAPI, SearXNG) or fan out to every available provider with provider=all. Always returns {url, title, snippet}; optional fields vary by provider: Exa adds summary/highlights/full text + score/author/image, Jina adds content/text + published date/image/metadata, Tavily adds full raw_content + score, Brave adds extra_snippets, SerpAPI adds thumbnail + position metadata, SearXNG adds engine metadata. Pick provider for the shape you need.",
    promptSnippet:
      "Search the web with askweb. Use provider=all to query every configured provider in parallel.",
    promptGuidelines: [
      "Use askweb when the user explicitly asks for fresh web information, news, references, or links.",
      "Prefer a single provider when the user names one; use provider=all when freshness or coverage matters and at least two providers are configured.",
      "For AI-style summaries/highlights/full page text prefer Exa; for Jina Search Foundation results use Jina; for raw full page content prefer Tavily; for classic SERP metadata Brave/SerpAPI/SearXNG are fine.",
      "Pass maxResults conservatively (5-10) unless the user asks for more.",
      "Forward includeDomains/excludeDomains/startPublishedDate/endPublishedDate when the user gives concrete filters.",
    ],
    parameters: searchParameters,
    renderCall(args, theme) {
      return new Text(renderSearchCall(args, theme), 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<SearchDetails>> {
      const query = params.query.trim()
      if (!query) {
        throw new Error("Query cannot be empty")
      }

      const rawProvider = (params.provider ?? "").trim() || undefined
      let providerName: "all" | WebSearchProviderName | undefined
      if (rawProvider === undefined) {
        providerName = undefined
      } else {
        if (!isKnownProvider(rawProvider)) {
          throw new Error(
            `Unknown provider "${rawProvider}". Available: ${PROVIDERS.join(", ")}.`,
          )
        }
        providerName = normalizeProvider(rawProvider)
      }

      const searchOptions: SearchOptions = stripUndefined({
        maxResults: params.maxResults,
        includeDomains: params.includeDomains,
        excludeDomains: params.excludeDomains,
        category: params.category,
        startPublishedDate: params.startPublishedDate,
        endPublishedDate: params.endPublishedDate,
      })

      const askweb = await loadAskweb()

      if (providerName === "all") {
        const response = await askweb.searchAllDetailed(query, searchOptions)
        const results = response.results
        const okProviders = Array.from(new Set(results.map((r) => r.provider))).sort()
        const header = buildHeader({
          mode: "all",
          query,
          count: results.length,
          okProviders,
          errCount: response.errors.length,
        })
        const result: AgentToolResult<SearchDetails> = {
          content: [{ type: "text", text: withHeader(header, formatAllResults(results, response.errors)) }],
          details: {
            mode: "all",
            query,
            options: searchOptions,
            count: results.length,
            results,
            errors: response.errors.map((e) => ({
              provider: e.provider,
              error: e.error.message,
            })),
          },
        }
        return result
      }

      const resolvedProvider =
        providerName ?? (await askweb.resolveDefaultProviderAsync())
      const provider = askweb.create(resolvedProvider)
      const results = await provider.search(query, searchOptions)
      const header = buildHeader({
        mode: "single",
        provider: resolvedProvider,
        query,
        count: results.length,
        autoSelected: providerName === undefined,
      })
      const result: AgentToolResult<SearchDetails> = {
        content: [{ type: "text", text: withHeader(header, formatResults(results)) }],
        details: {
          mode: "single",
          query,
          provider: resolvedProvider,
          options: searchOptions,
          count: results.length,
          results,
        },
      }
      return result
    },
  })

  pi.registerTool({
    name: "askweb_read",
    label: "Askweb Read",
    description:
      "Read-only/open-world network fetch: read a URL into normalized content using a read-capable provider. Defaults to Jina Reader (r.jina.ai). Returns URL, title/description when available, canonical content, and optional text/html/images/metadata.",
    promptSnippet: "Read a URL with askweb_read when page content is needed, not just search results.",
    promptGuidelines: [
      "Use askweb_read after search when the user needs the contents of a specific URL.",
      "Use askweb for query-to-URL search; use askweb_read for URL-to-content reading.",
    ],
    parameters: readParameters,
    renderCall(args, theme) {
      return new Text(renderReadCall(args, theme), 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<ReadDetails>> {
      const url = params.url.trim()
      if (!url) {
        throw new Error("URL cannot be empty")
      }

      const askweb = await loadAskweb()
      const defaultReadProvider: ReadProviderName = askweb.readProviderNames[0] ?? "jina"
      const rawProvider = (params.provider ?? defaultReadProvider).trim() || defaultReadProvider
      if (!isKnownReadProvider(rawProvider, askweb)) {
        throw new Error(
          `Unknown read provider "${rawProvider}". Available: ${askweb.readProviderNames.join(", ")}.`,
        )
      }

      const format = normalizeReadFormat(params.format)
      const readOptions: ReadOptions = stripUndefinedRead({
        format,
        maxTokens: params.maxTokens,
        targetSelector: params.targetSelector,
        removeSelector: params.removeSelector,
        timeout: params.timeout,
        noCache: params.noCache,
      })

      const result = await askweb.readUrl(url, { provider: rawProvider, ...readOptions })
      const header = `[provider=${rawProvider}] read ${result.url}`
      return {
        content: [{ type: "text", text: withHeader(header, formatReadResult(result)) }],
        details: {
          mode: "read",
          url,
          provider: rawProvider,
          options: readOptions,
          result,
        },
      }
    },
  })

  pi.registerTool({
    name: "askweb_providers",
    label: "Askweb Providers",
    description:
      "Read-only/idempotent local/env status: list built-in web search providers and which ones are currently configured via environment variables.",
    promptSnippet: "List configured askweb providers.",
    promptGuidelines: [
      "Use askweb_providers before askweb if it is unclear which providers are available.",
    ],
    parameters: emptyParameters,
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("askweb_providers")), 0, 0)
    },
    async execute(_toolCallId: string, _params: EmptyParams): Promise<AgentToolResult<{ providers: ProviderStatus[] }>> {
      const askweb = await loadAskweb()
      const statuses = await askweb.listProvidersAsync()
      const lines = statuses.map((s) => formatProviderStatus(s))
      return {
        content: [
          {
            type: "text",
            text: lines.length > 0 ? lines.join("\n") : "No providers registered.",
          },
        ],
        details: { providers: statuses },
      }
    },
  })

  pi.registerCommand("web", {
    description: "Search the web with askweb: /web [query]",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        return
      }

      const initial = args.trim()
      const query =
        initial || (await ctx.ui.input("Search the web", "Enter a search query"))
      if (!query?.trim()) {
        return
      }

      const trimmed = query.trim()
      const askweb = await loadAskweb()

      let providerName: WebSearchProviderName
      try {
        providerName = await askweb.resolveDefaultProviderAsync()
      } catch (err) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `No reachable askweb providers. ${errorMessage(err)}`,
            "warning",
          )
        }
        return
      }

      let results: SearchResult[]
      try {
        results = await askweb
          .create(providerName)
          .search(trimmed, { maxResults: DEFAULT_MAX_RESULTS })
      } catch (err) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `askweb ${providerName} failed: ${errorMessage(err)}`,
            "error",
          )
        }
        return
      }

      if (results.length === 0) {
        if (ctx.hasUI) {
          ctx.ui.notify(`No results for "${trimmed}" via ${providerName}.`, "warning")
        }
        return
      }

      if (!ctx.hasUI) {
        return
      }

      const labels = results.map(formatResult)
      const selected = await ctx.ui.select(
        `askweb (${providerName}) — ${trimmed}`,
        labels,
      )
      if (!selected) {
        return
      }
      const index = labels.indexOf(selected)
      const picked = results[index]
      if (!picked) {
        return
      }
      ctx.ui.pasteToEditor(picked.url)
      ctx.ui.notify(`Pasted ${picked.url}`, "info")
    },
  })

  pi.registerCommand("web-providers", {
    description: "List configured askweb providers",
    handler: async (_args, ctx) => {
      const askweb = await loadAskweb()
      const statuses = await askweb.listProvidersAsync()
      if (!ctx.hasUI) return
      ctx.ui.notify(statuses.map(formatProviderStatus).join("\n"), "info")
    },
  })
}

function isKnownProvider(name: string): name is ProviderInput {
  return PROVIDERS.some((provider) => provider === name)
}

function isKnownReadProvider(name: string, askweb: AskwebModule): name is ReadProviderInput {
  return askweb.readProviderNames.some((provider) => provider === name)
}

function normalizeReadFormat(format: string | undefined): ReadOptions["format"] {
  if (format === undefined || format === "") return undefined
  if (format === "markdown" || format === "text" || format === "html") return format
  throw new Error('Invalid read format. Expected "markdown", "text", or "html".')
}

function normalizeProvider(provider: ProviderInput | undefined): "all" | WebSearchProviderName | undefined {
  if (provider === "auto") {
    return undefined
  }
  return provider
}

function stripUndefined(input: SearchOptions): SearchOptions {
  const out: SearchOptions = {}
  if (input.maxResults !== undefined) out.maxResults = input.maxResults
  if (input.includeDomains !== undefined) out.includeDomains = input.includeDomains
  if (input.excludeDomains !== undefined) out.excludeDomains = input.excludeDomains
  if (input.startPublishedDate !== undefined) out.startPublishedDate = input.startPublishedDate
  if (input.endPublishedDate !== undefined) out.endPublishedDate = input.endPublishedDate
  if (input.category !== undefined) out.category = input.category
  return out
}

function stripUndefinedRead(input: ReadOptions): ReadOptions {
  const out: ReadOptions = {}
  if (input.format !== undefined) out.format = input.format
  if (input.maxTokens !== undefined) out.maxTokens = input.maxTokens
  if (input.targetSelector !== undefined) out.targetSelector = input.targetSelector
  if (input.removeSelector !== undefined) out.removeSelector = input.removeSelector
  if (input.timeout !== undefined) out.timeout = input.timeout
  if (input.noCache !== undefined) out.noCache = input.noCache
  return out
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type HeaderOpts =
  | { mode: "single"; provider: string; query: string; count: number; autoSelected: boolean }
  | { mode: "all"; query: string; count: number; okProviders: string[]; errCount: number }

function buildHeader(o: HeaderOpts): string {
  if (o.mode === "single") {
    const tag = o.autoSelected ? " (auto-selected default)" : ""
    return `[provider=${o.provider}] ${o.count} result(s) for "${o.query}"${tag}`
  }
  const list = o.okProviders.length > 0 ? ` [${o.okProviders.join(", ")}]` : ""
  const errs = o.errCount > 0 ? ` (+${o.errCount} provider error(s))` : ""
  return `[provider=all] ${o.count} result(s) for "${o.query}" via ${o.okProviders.length} provider(s)${list}${errs}`
}

function withHeader(header: string, body: string[]): string {
  const joined = body.join("\n")
  return joined ? `${header}\n\n${joined}` : `${header}\nNo results.`
}

function formatProviderStatus(s: ProviderStatus): string {
  // Symbol legend:
  //   ✓  configured AND reachable (or no probe = trust env)
  //   ⚠  configured BUT probe returned false (e.g. SearXNG endpoint down)
  //   ·  not configured (no env var / not registered)
  let symbol = "·"
  if (s.configured) {
    symbol = s.reachable === false ? "⚠" : "✓"
  }
  const envLabel = s.envVar ? ` (${s.envVar})` : ""
  const reachabilityNote =
    s.configured && s.reachable === false ? " — unreachable" : ""
  return `${symbol} ${s.name}${envLabel}${reachabilityNote}`
}

function formatResult(result: SearchResult, index?: number): string {
  const head = index === undefined ? "" : `${index + 1}. `
  const title = result.title || "(no title)"
  const snippet = result.snippet ? ` — ${truncateSingleLine(result.snippet, 120)}` : ""
  return `${head}${title}\n   ${result.url}${snippet}`
}

function formatResults(results: SearchResult[]): string[] {
  return results.map((r, i) => formatResult(r, i))
}

function formatAllResults(
  results: SearchAllResult[],
  errors: ProviderError[],
): string[] {
  const lines = results.map((r, i) => `${formatResult(r, i)}\n   [${r.provider}]`)
  if (errors.length > 0) {
    lines.push("", "Provider errors:")
    for (const e of errors) {
      lines.push(`  ${e.provider}: ${e.error.message}`)
    }
  }
  return lines
}

function formatReadResult(result: ReadResult): string[] {
  const lines = [result.title || "(no title)", `   ${result.url}`]
  if (result.description) lines.push(`   ${truncateSingleLine(result.description, 160)}`)
  if (result.content) lines.push("", result.content)
  return lines
}

function renderSearchCall(params: SearchParams, theme: RenderTheme): string {
  const parts = [theme.fg("toolTitle", theme.bold("askweb"))]
  parts.push(theme.fg("dim", `"${truncateSingleLine(params.query, 120)}"`))
  if (params.provider) parts.push(theme.fg("muted", `provider=${params.provider}`))
  if (params.maxResults !== undefined)
    parts.push(theme.fg("muted", `max=${params.maxResults}`))
  if (params.includeDomains?.length)
    parts.push(theme.fg("muted", `include=${params.includeDomains.join(",")}`))
  if (params.excludeDomains?.length)
    parts.push(theme.fg("muted", `exclude=${params.excludeDomains.join(",")}`))
  if (params.category) parts.push(theme.fg("muted", `cat=${params.category}`))
  if (params.startPublishedDate)
    parts.push(theme.fg("muted", `from=${params.startPublishedDate}`))
  if (params.endPublishedDate)
    parts.push(theme.fg("muted", `to=${params.endPublishedDate}`))
  return parts.join(" ")
}

function renderReadCall(params: ReadParams, theme: RenderTheme): string {
  const parts = [theme.fg("toolTitle", theme.bold("askweb_read"))]
  parts.push(theme.fg("dim", truncateSingleLine(params.url, 120)))
  if (params.provider) parts.push(theme.fg("muted", `provider=${params.provider}`))
  if (params.format) parts.push(theme.fg("muted", `format=${params.format}`))
  if (params.maxTokens !== undefined)
    parts.push(theme.fg("muted", `maxTokens=${params.maxTokens}`))
  return parts.join(" ")
}

function truncateSingleLine(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim()
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`
}

type RenderTheme = {
  bold(text: string): string
  fg(color: string, text: string): string
}

