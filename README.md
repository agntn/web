# askweb

[![npm version](https://img.shields.io/npm/v/askweb?style=flat&colorA=130f40&colorB=474787)](https://npmjs.com/package/askweb)
[![npm downloads](https://img.shields.io/npm/dm/askweb?style=flat&colorA=130f40&colorB=474787)](https://npm.chart.dev/askweb)
[![license](https://img.shields.io/github/license/oritwoen/askweb?style=flat&colorA=130f40&colorB=474787)](https://github.com/oritwoen/askweb/blob/main/LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/oritwoen/askweb)

One API for Brave, Exa, Jina, Tavily, SerpAPI, SerpBase, and SearXNG. Write your search logic once, swap the provider string, done.

If you're building an AI agent or a CLI tool that needs web search, you don't want to hardcode a single provider's API. They all return roughly the same thing, a list of URLs with titles and snippets, but the auth, endpoints, and response shapes are all different. Exa uses POST with `x-api-key`, Brave uses GET with `X-Subscription-Token`, Jina uses Bearer auth, Tavily puts the key in the request body. And so on.

`askweb` normalizes all of that behind a single interface. It also ships an [AI SDK](https://ai-sdk.dev/) tool and a CLI. Search is query-to-results; read is URL-to-content.

> [!WARNING]
> `askweb` is experimental. The package name, public API, provider model, CLI flags, and tool surfaces may change before the first stable release. Pin exact versions if you build on it now.

## Pi extension

`askweb` ships with a [pi](https://pi.dev) extension that registers three tools and two commands. Install the package straight from GitHub:

```bash
pi install git:github.com/oritwoen/askweb
```

Provided tools:

- `askweb` - search the web with a single provider, or `provider="all"` to fan out across every configured/reachable provider in parallel
- `askweb_read` - read a URL into normalized content with a read-capable provider (currently Jina Reader)
- `askweb_providers` - list built-in providers, env-var configuration, and reachability status

Provided slash commands:

- `/web [query]` - quick search from the TUI; results are shown as a selector and the chosen URL is pasted into the editor
- `/web-providers` - show provider configuration and reachability status

The extension reuses the same env vars as the library (`EXA_API_KEY`, `BRAVE_API_KEY`, `JINA_API_KEY`, `TAVILY_API_KEY`, `SERPAPI_API_KEY`, `SERPBASE_API_KEY`, or a self-hosted SearXNG). Pi bundles `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox`, so no extra installs are needed.

## Install

```bash
pnpm add askweb
```

For the AI SDK tool (`askweb/ai` subpath), you also need `ai` and `zod` as peer dependencies:

```bash
pnpm add ai zod
```

## Usage

Set your API key as an environment variable and create a provider:

```typescript
import { create } from 'askweb'

// Reads EXA_API_KEY from process.env
const exa = create('exa')

const results = await exa.search('typescript runtime benchmarks', { maxResults: 5 })

for (const result of results) {
  console.log(result.title, result.url)
}
```

Swap the provider string, same code:

```typescript
const brave = create('brave')   // reads BRAVE_API_KEY
const jina = create('jina')     // reads JINA_API_KEY
const tavily = create('tavily') // reads TAVILY_API_KEY
```

You can also pass the key explicitly:

```typescript
const exa = create('exa', { apiKey: 'your-key-here' })
```

### Search all providers

Query all available providers in parallel and get deduplicated results:

```typescript
import { searchAll } from 'askweb'

// Detects providers from env vars, queries them in parallel
const results = await searchAll('latest node.js release')

for (const result of results) {
  console.log(`[${result.provider}]`, result.title, result.url)
}
```

`searchAll` uses `Promise.allSettled` internally, so if one provider fails, the others still return. Results are deduplicated by URL (normalized, UTM params stripped). When duplicates exist, the result with the higher score wins.

You can also specify which providers to query:

```typescript
const results = await searchAll('query', {
  providers: ['exa', 'brave'],
  maxResults: 5,
})
```

### Read a URL

Use `readUrl` when you already have a URL and want normalized page content:

```typescript
import { readUrl } from 'askweb'

const page = await readUrl('https://example.com/article', {
  provider: 'jina',
  format: 'markdown',
  maxTokens: 4000,
})

console.log(page.title, page.content)
```

Jina read uses `r.jina.ai` and does not require an API key for basic reads; if `JINA_API_KEY` is present it is sent as Bearer auth.

### AI SDK tool

The `askweb/ai` subpath exports ready-made tools compatible with [Vercel AI SDK](https://ai-sdk.dev/docs/foundations/tools):

```typescript
import { generateText } from 'ai'
import { readTool, searchTool } from 'askweb/ai'

const { text } = await generateText({
  model: yourModel,
  tools: { webSearch: searchTool, webRead: readTool },
  prompt: 'Find the latest TypeScript release notes',
})
```

`searchTool` accepts an optional `provider` parameter. Set it to `"all"` to query all available providers in parallel. `readTool` accepts a URL and reads page content with a read-capable provider:

```typescript
// The AI can choose: a specific provider, or "all" for parallel search
tools: { webSearch: searchTool, webRead: readTool }
// searchTool input: { query: string, provider?: "brave" | "exa" | ... | "all", maxResults?: number }
// readTool input: { url: string, provider?: "jina", format?: "markdown" | "text" | "html" }
```

For `searchTool`, when no provider is specified, the tool auto-detects the first available one from environment variables. `readTool` defaults to Jina Reader.

## CLI

```bash
askweb "your query"
askweb --provider brave "your query" --max-results 5
askweb search "your query" --json
askweb read https://example.com --format markdown --json
askweb providers
```

| Command | Description |
|---------|-------------|
| `askweb <query>` | Search the web using the default provider |
| `askweb search <query>` | Search the web using a provider |
| `askweb read <url>` | Read a URL into normalized content |
| `askweb providers` | List built-in providers |

| Flag | Description |
|------|-------------|
| `--provider <name>` | Provider to use (search default: first configured; read default: `jina`) |
| `--max-results <n>` | Maximum search results to return (default: `10`) |
| `--format <markdown\|text\|html>` | Preferred read format |
| `--max-tokens <n>` | Maximum read tokens when supported |
| `--json` | Output as JSON |

## Providers

| Provider | Env var | Auth | Free tier |
|----------|---------|------|-----------|
| Brave | `BRAVE_API_KEY` | Header | 2k queries/mo |
| Exa | `EXA_API_KEY` | Header | 1k queries/mo |
| Jina | `JINA_API_KEY` | Bearer header | Required for search; optional for read |
| SearXNG | - | None | Self-hosted |
| SerpAPI | `SERPAPI_API_KEY` | Query param | 100 queries/mo |
| SerpBase | `SERPBASE_API_KEY` | `X-API-Key` header | 100 searches to start |
| Tavily | `TAVILY_API_KEY` | Body | 1k queries/mo |

### Result shape

All search providers always return `{ url, title, snippet }`. Optional fields depend on what each provider's native API exposes — `askweb` passes them through without flattening:

| Provider | Optional fields populated |
|----------|---------------------------|
| Exa     | `text` (full page), `highlights[]`, `summary` (AI), `score`, `publishedDate`, `author`, `image`, `favicon` |
| Jina    | `text` (`content`/`text`), `publishedDate`, `image`, `metadata` |
| Tavily  | `text` (raw_content, full HTML/markdown), `score`, `publishedDate` |
| Brave   | `text` (joined `extra_snippets`), `favicon` |
| SerpAPI | `image` (thumbnail), `publishedDate`, `favicon`, `metadata.{position, source, displayedLink}` |
| SerpBase | `image` (SERP thumbnail/image), `publishedDate`, `favicon`, `metadata.{position, rank, searchType, requestId, elapsedMs, creditsCharged}` |
| SearXNG | `image`, `score`, `publishedDate`, `metadata.{engine, engines, category}` |

Pick the provider that fits the shape you want. Exa is closest to "AI search" (summary + highlights + full text on request). Jina uses Jina Search Foundation and can return result content plus metadata. Tavily is best when you want the raw page content. Brave/SerpAPI/SerpBase/SearXNG are classic SERP-style metadata.

SerpBase uses Google SERP endpoints. `category: "images"`, `"news"`, or `"videos"` selects the matching SerpBase endpoint; `maxResults` is applied client-side to the returned page.

SearXNG requires no API key. It's a self-hosted metasearch engine. By default askweb connects to `http://localhost:8080`. Override with `baseURL`:

```typescript
const searx = create('searxng', { baseURL: 'https://searx.example.com' })
```

## Errors

All providers throw the same error types:

```typescript
import { AuthError, RateLimitError, HTTPError, UnknownProviderError } from 'askweb'

try {
  const results = await provider.search('query')
} catch (err) {
  if (err instanceof AuthError) {
    // Missing or invalid API key
  }
  if (err instanceof RateLimitError) {
    console.log(`Retry after ${err.retryAfter}s`)
  }
  if (err instanceof UnknownProviderError) {
    // Provider name not recognized
  }
}
```

A 401 from any provider becomes `AuthError`. A 429 from any provider becomes `RateLimitError` with a `retryAfter` value. Everything else is `HTTPError` or the base `AskwebError`.

For safety, `HTTPError.url` redacts sensitive query params and URL userinfo credentials before surfacing the URL in error messages.

## Data model

Every search provider returns the same normalized type:

```typescript
interface SearchResult {
  url: string
  title: string
  snippet: string
  score?: number
  publishedDate?: string
  author?: string
  image?: string
  favicon?: string
  text?: string
  highlights?: string[]
  summary?: string
  metadata?: Record<string, unknown>
}
```

Optional fields depend on what the provider returns. Exa provides `score`, `text`, and `highlights`. Jina provides result `text`/metadata when available. Brave provides `favicon`. Not all providers populate all fields.

Read results use the same naming for URL-to-content:

```typescript
interface ReadResult {
  url: string
  title?: string
  description?: string
  content: string
  text?: string
  html?: string
  publishedDate?: string
  image?: string
  links?: string[]
  images?: string[]
  metadata?: Record<string, unknown>
}
```

Search options you can pass to `.search()` or `searchAll`:

```typescript
interface SearchOptions {
  maxResults?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  startPublishedDate?: string
  endPublishedDate?: string
  category?: string
}
```

`maxResults` works with every search provider. Domain filtering is supported by Exa, Tavily, and Jina include filters (`site`). Date ranges are currently Exa-specific. `category` is supported by Exa, Jina (`web`, `images`, `news`), and SearXNG.

Read options you can pass to `readUrl`:

```typescript
interface ReadUrlOptions {
  provider?: 'jina' // custom registered provider names are also accepted at runtime
  format?: 'markdown' | 'text' | 'html'
  maxTokens?: number
  targetSelector?: string
  removeSelector?: string
  timeout?: number
  noCache?: boolean
}
```

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm build       # obuild
pnpm test        # vitest (watch mode)
pnpm test:run    # vitest --run
```

## License

[MIT](./LICENSE)
