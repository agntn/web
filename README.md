# @agntn/web

[![npm version](https://img.shields.io/npm/v/%40agntn%2Fweb?style=flat&colorA=130f40&colorB=474787)](https://npmjs.com/package/@agntn/web)
[![npm downloads](https://img.shields.io/npm/dm/%40agntn%2Fweb?style=flat&colorA=130f40&colorB=474787)](https://npm.chart.dev/@agntn/web)
[![license](https://img.shields.io/github/license/agntn/web?style=flat&colorA=130f40&colorB=474787)](https://github.com/agntn/web/blob/main/LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/web)

One API for Brave, Context.dev, Exa, Firecrawl, Jina, Mojeek, Tavily, TinyFish, SerpAPI, SerpBase, and SearXNG. Write your search logic once, swap the provider string, done.

If you're building an AI agent or a CLI tool that needs web search, you don't want to hardcode a single provider's API. They all return roughly the same thing, a list of URLs with titles and snippets, but the auth, endpoints, and response shapes are all different. Exa uses POST with `x-api-key`, Brave uses GET with `X-Subscription-Token`, Jina uses Bearer auth, Tavily puts the key in the request body. And so on.

`@agntn/web` normalizes all of that behind a single interface. It also ships [AI SDK](https://ai-sdk.dev/) tools and a CLI. Text search is query-to-results, reverse image search is image URL-to-matches, and read is URL-to-content.

## Pi and OMP extensions

`@agntn/web` ships the same four tools for [pi](https://pi.dev) and OMP. Pi also gets two slash commands. Install the package straight from GitHub:

```bash
pi install git:github.com/agntn/web
```

Provided tools:

- `web_search` - search one query or a batch of queries with a single provider, or use `provider="all"` for provider fan-out
- `web_search_image` - find pages containing or resembling an image available by public URL
- `web_read` - read one URL or a batch of URLs and report the effective reader after fallback
- `web_providers` - show the running build and process start, then list configuration, reachability, and search filter support

Provided slash commands:

- `/web [query]` - quick search from the TUI; results are shown as a selector and the chosen URL is pasted into the editor
- `/web-providers` - show provider configuration and reachability status

Both extensions reuse the same env vars as the library (`EXA_API_KEY`, `BRAVE_API_KEY`, `CONTEXT_DEV_API_KEY`, `FIRECRAWL_API_KEY`, `JINA_API_KEY`, `MOJEEK_API_KEY`, `TAVILY_API_KEY`, `TINYFISH_API_KEY`, `SERPAPI_API_KEY`, `SERPBASE_API_KEY`, or a self-hosted SearXNG). Their native TUI rows show progress, provider choice, result counts, fallback attempts, and bounded expanded previews without rendering a whole page into the terminal. Pi and OMP provide their own coding-agent and TUI runtimes, so no extra runtime install is needed.

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
const mojeek = create("mojeek"); // reads MOJEEK_API_KEY
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

`searchAll` uses `Promise.allSettled` internally, so if one provider fails, the others still return. Results are deduplicated by URL (normalized, UTM params stripped), then `maxResults` caps the final list. It defaults to 10. When duplicates exist, the result with the higher score wins.

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

### Reverse image search

SerpAPI Google Lens can find public pages containing or resembling an image available by URL. This is separate from text search, so providers without image lookup support are rejected instead of receiving a fake text query:

```typescript
import { searchByImage } from "@agntn/web";

const matches = await searchByImage("https://example.com/image.jpg", {
  provider: "serpapi",
  maxResults: 5,
});

for (const match of matches) {
  console.log(match.pageUrl, match.imageUrl, match.imageWidth, match.imageHeight);
}
```

The built-in reverse image provider is `serpapi`. The image URL is sent to that provider, so use a publicly accessible URL without embedded credentials or private query tokens. Results include the page URL, matched image URL, dimensions when available, provider, source, position, and exact-match metadata.

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

Jina read uses `r.jina.ai` and does not require an API key for basic reads; when `JINA_API_KEY` is present, it is sent as Bearer auth. Context.dev, Firecrawl, and TinyFish also support reads; TinyFish uses its Fetch API and `TINYFISH_API_KEY`. Without an explicit provider, `readUrl` starts with Jina and tries configured readers if Jina returns HTTP 402 or 409. Explicit provider selection stays strict.

Use `readUrlDetailed` when provider identity matters. `requestedProvider` records explicit selection or `auto`, `provider` is the reader that returned the page, and `attempts` keeps the ordered fallback path:

```typescript
import { readUrlDetailed } from "@agntn/web";

const { result, requestedProvider, provider, attempts } = await readUrlDetailed(
  "https://example.com/article",
);
console.log(requestedProvider, provider, attempts, result.content);
```

### Batch operations

`searchBatch` and `readBatch` run up to 10 independent operations in parallel. Input order is preserved, and one failure does not discard the other outcomes. `readBatchDetailed` adds the effective `provider` and `attempts` to each successful read. Without an explicit search provider, each query tries the remaining configured providers after HTTP 402:

```typescript
import { readBatch, searchBatch } from "@agntn/web";

const searches = await searchBatch(["TypeScript 7", "Node.js releases"], {
  provider: "exa",
});
const pages = await readBatch(["https://example.com/one", "https://example.com/two"]);
```

Each successful search outcome is `{ query, provider, results, filterReports }`; failures are `{ query, error }`. Each read outcome is `{ url, result }` or `{ url, error }`.

### AI SDK tool

The `@agntn/web/ai` subpath exports ready-made tools compatible with [Vercel AI SDK](https://ai-sdk.dev/docs/foundations/tools):

```typescript
import { generateText } from "ai";
import { readTool, searchImageTool, searchTool } from "@agntn/web/ai";

const { text } = await generateText({
  model: yourModel,
  tools: {
    web_search: searchTool,
    web_search_image: searchImageTool,
    web_read: readTool,
  },
  prompt: "Find the latest TypeScript release notes",
});
```

`searchTool` accepts one query or an array of queries. Explicit and automatic scalar searches return `{ provider, results, ignoredFilters, undeclaredFilters }`; `provider="all"` returns `{ results, errors, filterReports }`. `searchImageTool` accepts one public image URL. A scalar `readTool` call returns `{ result, requestedProvider, provider, attempts }`; successful batch items keep the same reader provenance beside `url`, while failures stay `{ url, error }`:

```typescript
// The AI can choose: a specific provider, or "all" for parallel search
tools: { web_search: searchTool, web_search_image: searchImageTool, web_read: readTool }
/** searchTool input: { query: string | string[], provider?: "brave" | "exa" | ... | "all", maxResults?: number, highlights?: boolean } */
// searchImageTool input: { url: string, provider?: "serpapi", maxResults?: number }
// readTool input: { url: string | string[], provider?: "jina" | "context" | "firecrawl" | "tinyfish", format?: "markdown" | "text" | "html" }
```

Without an explicit provider, `searchTool` starts with the first reachable provider from the environment and tries the remaining configured providers after HTTP 402. `readTool` starts with Jina Reader and tries other configured readers after HTTP 402 or 409.

## CLI

```bash
web "your query"
web --provider brave "your query" --max-results 5
web search "your query" --json
web search "your query" --provider firecrawl --no-highlights
web search-image https://example.com/image.jpg --max-results 5 --json
web read https://example.com --format markdown --json
web read https://example.com/one https://example.com/two --json
web providers
```

| Command                  | Description                                   |
| ------------------------ | --------------------------------------------- |
| `web <query>`            | Search the web using the default provider     |
| `web search <query>`     | Search the web using a provider               |
| `web search-image <url>` | Find matching pages from a public image URL   |
| `web read <url...>`      | Read one or more URLs into normalized content |
| `web providers`          | List built-in providers                       |
| `web mcp`                | Run the MCP server over stdio                 |

Read commands use automatic selection unless `--provider` is set. Scalar JSON is `{ result, requestedProvider, provider, attempts }`; batch successes add `url` to that shape. Any failed batch item makes the command exit 1 without discarding successes.

### MCP server

`web mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio exposing the same capabilities as the agent tools. MCP clients keep control of their own TUI; the server supplies the same tool symbols and titles as the native extensions without writing decorations into the JSON-RPC stream:

- `web_search` - search one query or a batch, or use `provider="all"` for provider fan-out
- `web_search_image` - find matching pages and images from a public image URL
- `web_read` - read one URL or a batch and return effective provider provenance
- `web_providers` - show the running build and process start, then list configuration and search filter support

Register it with any MCP client:

```bash
claude mcp add web --scope user -- web mcp
```

The programmatic surface is also importable from the `@agntn/web/mcp` subpath (`createMcpServer()`) when your host provides its own transport.

| Flag                              | Description                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `--provider <name>`               | Provider to use (text: first configured; image: SerpAPI; read: auto starting with Jina) |
| `--max-results <n>`               | Maximum text or image search results to return (default: `10`)                          |
| `--no-highlights`                 | Disable passages selected for the query when supported                                  |
| `--format <markdown\|text\|html>` | Preferred read format                                                                   |
| `--max-tokens <n>`                | Maximum read tokens when supported                                                      |
| `--json`                          | Output as JSON                                                                          |

## Providers

| Provider    | Env var               | Auth               | Free tier                              |
| ----------- | --------------------- | ------------------ | -------------------------------------- |
| Brave       | `BRAVE_API_KEY`       | Header             | 2k queries/mo                          |
| Context.dev | `CONTEXT_DEV_API_KEY` | Bearer header      | Credit-based free tier                 |
| Exa         | `EXA_API_KEY`         | Header             | 1k queries/mo                          |
| Firecrawl   | `FIRECRAWL_API_KEY`   | Bearer header      | Credit-based free tier                 |
| Jina        | `JINA_API_KEY`        | Bearer header      | Required for search; optional for read |
| Mojeek      | `MOJEEK_API_KEY`      | Query param        | Limited free trial                     |
| SearXNG     | -                     | None               | Self-hosted                            |
| SerpAPI     | `SERPAPI_API_KEY`     | Query param        | 100 queries/mo; Google Lens supported  |
| SerpBase    | `SERPBASE_API_KEY`    | `X-API-Key` header | 100 searches to start                  |
| Tavily      | `TAVILY_API_KEY`      | Body               | 1k queries/mo                          |
| TinyFish    | `TINYFISH_API_KEY`    | `X-API-Key` header | Free at $0; Search access required     |

### Result shape

All search providers always return `{ url, title, snippet }`. Optional fields depend on what each provider's native API exposes; `@agntn/web` passes them through without flattening:

| Provider    | Optional fields populated                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context.dev | `metadata.{relevance, markdownCode}`                                                                                                                    |
| Exa         | `text` (full page), `highlights[]`, `summary` (AI), `score`, `publishedDate`, `author`, `image`, `favicon`                                              |
| Firecrawl   | `text` (markdown from the scraped page)                                                                                                                 |
| Jina        | `text` (`content`/`text`), `publishedDate`, `image`, `metadata`                                                                                         |
| Mojeek      | `score`, `publishedDate`, `image`, `metadata.{confidence, documentSize, lastModifiedDate, crawledDate, moreResultsFromDomain, imageWidth, imageHeight}` |
| Tavily      | `text` (raw_content, full HTML/markdown), `score`, `publishedDate`                                                                                      |
| TinyFish    | `publishedDate`, `author`, `metadata.{position, siteName, publisher, authors, venue, year, citedByCount, pdfUrl}`                                       |
| Brave       | `text` (joined `extra_snippets`), `favicon`                                                                                                             |
| SerpAPI     | `image` (thumbnail), `publishedDate`, `favicon`, `metadata.{position, source, displayedLink}`                                                           |
| SerpBase    | `image` (SERP thumbnail/image), `publishedDate`, `favicon`, `metadata.{position, rank, searchType, requestId, elapsedMs, creditsCharged}`               |
| SearXNG     | `image`, `score`, `publishedDate`, `metadata.{engine, engines, category}`                                                                               |

Pick the provider that fits the shape you want. Firecrawl returns page passages relevant to the query in `snippet` by default, including Markdown when the source passage contains it. Exa exposes separate summaries, `highlights[]`, and full text. TinyFish carries useful news and research metadata. Jina and Tavily are strong when page content matters. Brave, Mojeek, SerpAPI, SerpBase, and SearXNG return classic SERP metadata.

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

Optional fields depend on what the provider returns. Firecrawl uses page passages relevant to the query for `snippet` by default. Exa provides `score`, `text`, and `highlights`. TinyFish provides publisher and research metadata. Jina provides result `text` and metadata when available. Mojeek provides ranking, date, image, and crawl metadata. Brave provides `favicon`. Not all providers populate all fields.

Reverse image results keep page and image identity separate:

```typescript
interface ImageSearchResult {
  pageUrl: string;
  imageUrl: string;
  title: string;
  provider: string;
  source?: string;
  thumbnailUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  position?: number;
  exactMatch?: boolean;
}
```

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
  highlights?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  sources?: string[];
  categories?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  category?: string;
}
```

`maxResults` defaults to 10 and caps the final result list, including `searchAll` output after URL deduplication. Each provider also receives it as the requested result count. `highlights` defaults to `true`; Firecrawl and Exa honor `false`, while providers that already return plain descriptions need no special handling. The remaining filters are specific to each provider:

| Provider    | Domain filters   | Source values           | Category values                              | Date bounds |
| ----------- | ---------------- | ----------------------- | -------------------------------------------- | ----------- |
| Brave       | none             | none                    | none                                         | none        |
| Context.dev | include, exclude | none                    | none                                         | none        |
| Exa         | include, exclude | none                    | forwarded as given                           | start, end  |
| Firecrawl   | include, exclude | `web`, `news`, `images` | `research`, `pdf`, `developer`               | none        |
| Jina        | include          | none                    | `web`, `images`, `news`                      | none        |
| Mojeek      | include, exclude | none                    | none                                         | start, end  |
| SearXNG     | none             | none                    | forwarded as given                           | none        |
| SerpAPI     | none             | none                    | none                                         | none        |
| SerpBase    | none             | none                    | `image`, `images`, `news`, `video`, `videos` | none        |
| Tavily      | include, exclude | none                    | none                                         | none        |
| TinyFish    | include, exclude | none                    | `news`, `research_paper`                     | start, end  |

Firecrawl uses the plural array filters from its API: `sources` selects result groups, while `categories` narrows web results. Its singular `category` option is not forwarded.

`searchProviderDetailed()` and `searchWithFallback()` return the effective provider plus `ignoredFilters` and `undeclaredFilters`. `searchAllDetailed()` keeps the same diagnostics in `filterReports` and lists every fulfilled provider in `successfulProviders`, including providers with no retained result after deduplication. Custom providers without capability metadata report requested filters as undeclared instead of guessing. `web_providers` exposes the matrix as `searchFilters` and optional `searchCategories`.

Read options you can pass to `readUrl` or `readUrlDetailed`:

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

The built-in read providers are `jina`, `context`, `firecrawl`, and `tinyfish`. Custom registered provider names also work at runtime. Firecrawl supports `targetSelector` and `removeSelector` as CSS filters but rejects `maxTokens` instead of silently ignoring it.

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
