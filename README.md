# @agntn/web

[![npm version](https://img.shields.io/npm/v/%40agntn%2Fweb?style=flat&colorA=130f40&colorB=474787)](https://npmjs.com/package/@agntn/web)
[![npm downloads](https://img.shields.io/npm/dm/%40agntn%2Fweb?style=flat&colorA=130f40&colorB=474787)](https://npm.chart.dev/@agntn/web)
[![license](https://img.shields.io/github/license/agntn/web?style=flat&colorA=130f40&colorB=474787)](https://github.com/agntn/web/blob/main/LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/web)

One API for Brave, Context.dev, Exa, Firecrawl, Jina, Tavily, TinyFish, SerpAPI, SerpBase, and SearXNG. Write your search logic once, swap the provider string, done.

If you're building an AI agent or a CLI tool that needs web search, you don't want to hardcode a single provider's API. They all return roughly the same thing, a list of URLs with titles and snippets, but the auth, endpoints, and response shapes are all different. Exa uses POST with `x-api-key`, Brave uses GET with `X-Subscription-Token`, Jina uses Bearer auth, Tavily puts the key in the request body. And so on.

`@agntn/web` normalizes all of that behind a single interface. It also ships an [AI SDK](https://ai-sdk.dev/) tool and a CLI. Search is query-to-results; read is URL-to-content.

## Pi extension

`@agntn/web` ships with a [pi](https://pi.dev) extension that registers three tools and two commands. Install the package straight from GitHub:

```bash
pi install git:github.com/agntn/web
```

Provided tools:

- `web_search` - search one query or a batch of queries with a single provider, or use `provider="all"` for provider fan-out
- `web_read` - read one URL or a batch of URLs with Jina Reader, Context.dev, Firecrawl, or TinyFish
- `web_providers` - list built-in providers, env-var configuration, and reachability status

Provided slash commands:

- `/web [query]` - quick search from the TUI; results are shown as a selector and the chosen URL is pasted into the editor
- `/web-providers` - show provider configuration and reachability status

The extension reuses the same env vars as the library (`EXA_API_KEY`, `BRAVE_API_KEY`, `CONTEXT_DEV_API_KEY`, `FIRECRAWL_API_KEY`, `JINA_API_KEY`, `TAVILY_API_KEY`, `TINYFISH_API_KEY`, `SERPAPI_API_KEY`, `SERPBASE_API_KEY`, or a self-hosted SearXNG). Pi bundles `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox`, so no extra installs are needed.

## Install

```bash
pnpm add @agntn/web
```

For the AI SDK tool (`@agntn/web/ai` subpath), you also need `ai` and `zod` as peer dependencies:

```bash
pnpm add ai zod
```

## Usage

Set your API key as an environment variable and create a provider:

```typescript
import { create } from "@agntn/web";

// Reads EXA_API_KEY from process.env
const exa = create("exa");

const results = await exa.search("typescript runtime benchmarks", { maxResults: 5 });

for (const result of results) {
  console.log(result.title, result.url);
}
```

Swap the provider string, same code:

```typescript
const brave = create("brave"); // reads BRAVE_API_KEY
const context = create("context"); // reads CONTEXT_DEV_API_KEY
const jina = create("jina"); // reads JINA_API_KEY
const tavily = create("tavily"); // reads TAVILY_API_KEY
const tinyfish = create("tinyfish");
```

You can also pass the key explicitly:

```typescript
const exa = create("exa", { apiKey: "your-key-here" });
```

### Search all providers

Query all available providers in parallel and get deduplicated results:

```typescript
import { searchAll } from "@agntn/web";

// Detects providers from env vars, queries them in parallel
const results = await searchAll("latest node.js release");

for (const result of results) {
  console.log(`[${result.provider}]`, result.title, result.url);
}
```

`searchAll` uses `Promise.allSettled` internally, so if one provider fails, the others still return. Results are deduplicated by URL (normalized, UTM params stripped). When duplicates exist, the result with the higher score wins.

You can also specify which providers to query:

```typescript
const results = await searchAll("query", {
  providers: ["exa", "brave"],
  maxResults: 5,
});
```

Firecrawl exposes response-level diagnostics through its detailed search capability. `search()` still returns the normalized result list:

```typescript
import { create, isDetailedSearchProvider } from "@agntn/web";

const firecrawl = create("firecrawl");
if (isDetailedSearchProvider(firecrawl)) {
  const { results, metadata } = await firecrawl.searchDetailed("query");
  console.log(results, metadata?.id, metadata?.warning, metadata?.creditsUsed);
}
```

`web search --provider firecrawl --json "query"` prints the same `{ results, metadata }` envelope.

### Read a URL

Use `readUrl` when you already have a URL and want normalized page content:

```typescript
import { readUrl } from "@agntn/web";

const page = await readUrl("https://example.com/article", {
  provider: "jina",
  format: "markdown",
  maxTokens: 4000,
});

console.log(page.title, page.content);
```

Jina read uses `r.jina.ai` and does not require an API key for basic reads; when `JINA_API_KEY` is present, it is sent as Bearer auth. Context.dev, Firecrawl, and TinyFish also support reads; TinyFish uses its Fetch API and `TINYFISH_API_KEY`.

### Batch operations

`searchBatch` and `readBatch` run up to 10 independent operations in parallel. Input order is preserved, and one failure does not discard the other outcomes. Without an explicit search provider, each query tries the remaining configured providers after HTTP 402:

```typescript
import { readBatch, searchBatch } from "@agntn/web";

const searches = await searchBatch(["TypeScript 7", "Node.js releases"], {
  provider: "exa",
});
const pages = await readBatch(["https://example.com/one", "https://example.com/two"]);
```

Each search outcome is `{ query, results }` or `{ query, error }`. Each read outcome is `{ url, result }` or `{ url, error }`.

### AI SDK tool

The `@agntn/web/ai` subpath exports ready-made tools compatible with [Vercel AI SDK](https://ai-sdk.dev/docs/foundations/tools):

```typescript
import { generateText } from "ai";
import { readTool, searchTool } from "@agntn/web/ai";

const { text } = await generateText({
  model: yourModel,
  tools: { web_search: searchTool, web_read: readTool },
  prompt: "Find the latest TypeScript release notes",
});
```

`searchTool` accepts one query or an array of queries. `readTool` accepts one URL or an array of URLs. Batch calls use the outcome shapes above, while scalar calls keep their original result shape:

```typescript
// The AI can choose: a specific provider, or "all" for parallel search
tools: { web_search: searchTool, web_read: readTool }
// searchTool input: { query: string | string[], provider?: "brave" | "exa" | ... | "all", maxResults?: number }
// readTool input: { url: string | string[], provider?: "jina" | "context" | "firecrawl" | "tinyfish", format?: "markdown" | "text" | "html" }
```

Without an explicit provider, `searchTool` starts with the first reachable provider from the environment and tries the remaining configured providers after HTTP 402. `readTool` defaults to Jina Reader.

## CLI

```bash
web "your query"
web --provider brave "your query" --max-results 5
web search "your query" --json
web read https://example.com --format markdown --json
web read https://example.com/one https://example.com/two --json
web providers
```

| Command              | Description                                   |
| -------------------- | --------------------------------------------- |
| `web <query>`        | Search the web using the default provider     |
| `web search <query>` | Search the web using a provider               |
| `web read <url...>`  | Read one or more URLs into normalized content |
| `web providers`      | List built-in providers                       |
| `web mcp`            | Run the MCP server over stdio                 |

Passing 2-10 URLs returns one ordered outcome per URL. Batch JSON is an array of `{ url, result }` or `{ url, error }`; any failed read makes the command exit 1 without discarding successes.

### MCP server

`web mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio exposing the same capabilities as the agent tools:

- `web_search` - search one query or a batch, or use `provider="all"` for provider fan-out
- `web_read` - read one URL or a batch (default: Jina Reader)
- `web_providers` - list providers and their configuration status

Register it with any MCP client:

```bash
claude mcp add web --scope user -- web mcp
```

The programmatic surface is also importable from the `@agntn/web/mcp` subpath (`createMcpServer()`) when your host provides its own transport.

| Flag                              | Description                                                              |
| --------------------------------- | ------------------------------------------------------------------------ |
| `--provider <name>`               | Provider to use (search default: first configured; read default: `jina`) |
| `--max-results <n>`               | Maximum search results to return (default: `10`)                         |
| `--format <markdown\|text\|html>` | Preferred read format                                                    |
| `--max-tokens <n>`                | Maximum read tokens when supported                                       |
| `--json`                          | Output as JSON                                                           |

## Providers

| Provider    | Env var               | Auth               | Free tier                              |
| ----------- | --------------------- | ------------------ | -------------------------------------- |
| Brave       | `BRAVE_API_KEY`       | Header             | 2k queries/mo                          |
| Context.dev | `CONTEXT_DEV_API_KEY` | Bearer header      | Credit-based free tier                 |
| Exa         | `EXA_API_KEY`         | Header             | 1k queries/mo                          |
| Firecrawl   | `FIRECRAWL_API_KEY`   | Bearer header      | Credit-based free tier                 |
| Jina        | `JINA_API_KEY`        | Bearer header      | Required for search; optional for read |
| SearXNG     | -                     | None               | Self-hosted                            |
| SerpAPI     | `SERPAPI_API_KEY`     | Query param        | 100 queries/mo                         |
| SerpBase    | `SERPBASE_API_KEY`    | `X-API-Key` header | 100 searches to start                  |
| Tavily      | `TAVILY_API_KEY`      | Body               | 1k queries/mo                          |
| TinyFish    | `TINYFISH_API_KEY`    | `X-API-Key` header | Free at $0; Search access required     |

### Result shape

All search providers always return `{ url, title, snippet }`. Optional fields depend on what each provider's native API exposes; `@agntn/web` passes them through without flattening:

| Provider    | Optional fields populated                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Context.dev | `metadata.{relevance, markdownCode}`                                                                                                      |
| Exa         | `text` (full page), `highlights[]`, `summary` (AI), `score`, `publishedDate`, `author`, `image`, `favicon`                                |
| Firecrawl   | `text` (markdown from the scraped page)                                                                                                   |
| Jina        | `text` (`content`/`text`), `publishedDate`, `image`, `metadata`                                                                           |
| Tavily      | `text` (raw_content, full HTML/markdown), `score`, `publishedDate`                                                                        |
| TinyFish    | `publishedDate`, `author`, `metadata.{position, siteName, publisher, authors, venue, year, citedByCount, pdfUrl}`                         |
| Brave       | `text` (joined `extra_snippets`), `favicon`                                                                                               |
| SerpAPI     | `image` (thumbnail), `publishedDate`, `favicon`, `metadata.{position, source, displayedLink}`                                             |
| SerpBase    | `image` (SERP thumbnail/image), `publishedDate`, `favicon`, `metadata.{position, rank, searchType, requestId, elapsedMs, creditsCharged}` |
| SearXNG     | `image`, `score`, `publishedDate`, `metadata.{engine, engines, category}`                                                                 |

Pick the provider that fits the shape you want. Exa is closest to "AI search" (summary + highlights + full text on request). TinyFish carries useful news and research metadata. Jina and Tavily are strong when page content matters. Brave, SerpAPI, SerpBase, and SearXNG return classic SERP metadata.

SerpBase uses Google SERP endpoints. `category: "images"`, `"news"`, or `"videos"` selects the matching SerpBase endpoint; `maxResults` is applied client-side to the returned page. TinyFish also applies `maxResults` client-side to one result page.

SearXNG requires no API key. It's a self-hosted metasearch engine. By default `@agntn/web` connects to `http://localhost:8080`. Override with `baseURL`:

```typescript
const searx = create("searxng", { baseURL: "https://searx.example.com" });
```

## Errors

All providers throw the same error types:

```typescript
import { AuthError, RateLimitError, HTTPError, UnknownProviderError } from "@agntn/web";

try {
  const results = await provider.search("query");
} catch (err) {
  if (err instanceof AuthError) {
    // Missing or invalid API key
  }
  if (err instanceof RateLimitError) {
    console.log(`Retry after ${err.retryAfter}s`);
  }
  if (err instanceof UnknownProviderError) {
    // Provider name not recognized
  }
}
```

A 401 from any provider becomes `AuthError`. A 429 from any provider becomes `RateLimitError` with a `retryAfter` value. Everything else is `HTTPError` or the base `WebError`.

For safety, `HTTPError.url` redacts sensitive query params and URL userinfo credentials before surfacing the URL in error messages.

## Data model

Every search provider returns the same normalized type:

```typescript
interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  score?: number;
  publishedDate?: string;
  author?: string;
  image?: string;
  favicon?: string;
  text?: string;
  highlights?: string[];
  summary?: string;
  metadata?: Record<string, unknown>;
}
```

Optional fields depend on what the provider returns. Exa provides `score`, `text`, and `highlights`. TinyFish provides publisher and research metadata. Jina provides result `text` and metadata when available. Brave provides `favicon`. Not all providers populate all fields.

Read results use the same naming for URL-to-content:

```typescript
interface ReadResult {
  url: string;
  title?: string;
  description?: string;
  content: string;
  text?: string;
  html?: string;
  publishedDate?: string;
  image?: string;
  links?: string[];
  images?: string[];
  metadata?: Record<string, unknown>;
}
```

Search options you can pass to `.search()` or `searchAll`:

```typescript
interface SearchOptions {
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  category?: string;
}
```

`maxResults` works with every search provider. TinyFish supports domain and date filters plus `news` and `research_paper` categories. Context.dev, Exa, and Tavily support domain filters, while Jina supports include filters through `site`. Other category support varies by provider.

Read options you can pass to `readUrl`:

```typescript
interface ReadUrlOptions {
  provider?: string;
  format?: "markdown" | "text" | "html";
  maxTokens?: number;
  targetSelector?: string;
  removeSelector?: string;
  timeout?: number;
  noCache?: boolean;
}
```

The built-in read providers are `jina`, `context`, `firecrawl`, and `tinyfish`. Custom registered provider names also work at runtime.

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
