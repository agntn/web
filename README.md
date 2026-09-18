# @agntn/web

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/web)](https://npmx.dev/package/@agntn/web)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/web)](https://npmx.dev/package/@agntn/web)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/web)](https://npmx.dev/package/@agntn/web)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/web)

🔎 Twelve search APIs, one `{ url, title, snippet }`. You ask Exa, Brave or your own SearXNG the same way, you read the page behind a hit the same way, and nobody has to remember whose key goes in which header.

## Why?

Every search API sells the same thing, ten links with a title and a snippet, and every one of them takes the order differently. Exa wants a POST with `x-api-key`, Brave a GET with `X-Subscription-Token`, Tavily puts the key inside the JSON body, why not. Wire three of those into an agent and you have three clients, three response shapes and three ideas of what a date looks like. So this is one class shape in front of twelve of them, search, read and reverse image search, same objects out no matter who answered.

Docs and a live explorer: [web.agntn.dev](https://web.agntn.dev).

## ✨ Features

- 🧩 **Twelve backends, one contract.** Brave, Context.dev, Exa, Firecrawl, Jina, Mojeek, OpenAI Codex, SearXNG, SerpAPI, SerpBase, Tavily and TinyFish, and from your side the difference is a string.
- 🔎 **Search, read, reverse image.** Query to results, URL to Markdown, image URL to the pages it shows up on. Three calls, not three packages.
- 🌐 **`all` means all.** One query goes to every provider you have a key for, comes back deduplicated by URL with the UTM junk stripped, and each hit says which providers agreed on it.
- 🛟 **Fallback you don't write.** Out of credits on Firecrawl, rate limited on SerpAPI? The next configured provider gets the query and the answer names who actually replied.
- 📏 **Reads have a ceiling.** `maxChars` is exact, counted in code points, and a page that doesn't fit hands you a continuation token instead of 400 kB you didn't ask for.
- 📄 **Page two exists.** Brave, Mojeek, SearXNG, SerpAPI, SerpBase and TinyFish page through results with an opaque token that stays pinned to the query it came from.
- 🤖 **One package, six doors.** CLI, library, AI SDK tools, an MCP server, a Pi extension and an OMP extension, and the JSON coming out is the same behind every one.
- 🔐 **Keys stay out of your logs.** The key is scrubbed from the URL before an error ever gets to say it out loud.
- 🧠 **Codex search on a login you already have.** Signed into Codex, Pi, OMP or OpenCode? OpenAI web search runs on that, no API key.

## 📦 Install

```bash
pnpm add @agntn/web
```

Node.js 22 or newer. The AI SDK tools on `@agntn/web/ai` want `ai` and `zod` next to them, the main entry never touches either:

```bash
pnpm add ai zod
```

## 🚀 First call

```bash
npx @agntn/web "how many r in strawberry"
```

```
How many 'r's are in strawberry? And do LLMs know how to spell? - DEV Community
  https://dev.to/savannah_norem/how-many-rs-are-in-strawberry-and-do-llms-know-how-to-spell-2513
  Well the short answers are three and kind of… but not really. ... Any which way you cut it, there are three ‘r’s in stra...

Language Log » "The cosmic jam from whence it came"
  https://languagelog.ldc.upenn.edu/nll/?p=66206
  Elle Cordova offers an update from ChatGPT on the number of Rs in "strawberry": ... As of this morning, ChatGPT 4o gives...

How many r are in strawberry? | AI Roundtable by Opper
  https://opper.ai/ai-roundtable/questions/how-many-r-are-in-strawberry-fc2d3d2d
  Answer: There are exactly three "r"s in the word "strawberry". (All 4 models agreed) ... Answer: There are 3 “r” letters...
```

Three. All four models agreed, good for them ;)

No subcommand, no flags. Anything that isn't `search`, `read`, `search-image`, `providers` or `mcp` is a query. Which provider answered? The first one with a key in your env, checked in this order: Exa, Brave, Context.dev, Firecrawl, Jina, Tavily, TinyFish, SerpAPI, SerpBase, Mojeek, then a saved Codex login, then a SearXNG on `localhost:8080`. No key anywhere means search has nobody to call and says so. `--provider brave` if you'd rather pick.

Reading is different, that one works with nothing in your env:

```bash
web read https://example.com
```

```
[provider=jina requested=auto] read https://example.com/
Example Domain
  https://example.com/

This domain is for use in documentation examples without needing permission. Avoid use in operations.

[Learn more](https://iana.org/domains/example)
```

Reads start at Jina's `r.jina.ai`, which doesn't need a key, and move on to Context.dev, Firecrawl, TinyFish or Tavily when Jina is out of credit, rate limited, down or answers with its 409. The first line tells you who ended up doing the work.

A handful more, keys permitting:

```bash
web search "typescript 7" "node.js 26" --provider all --json
web search "rust 2027 edition" --provider brave --max-results 3
web search "typescript 7" --provider exa --summary --full-text
web search "typescript 7" --include-domains github.com --start-published-date 2026-01-01
web read https://example.com --format markdown --max-chars 20000 --json
web search-image https://example.com/image.jpg --max-results 5
web providers
```

### Commands

| Command                  | What it does                                  | Example                                          |
| ------------------------ | --------------------------------------------- | ------------------------------------------------ |
| `web <query>`            | Search with the first configured provider     | `web "typescript 7"`                             |
| `web search <query...>`  | One query or a batch, one provider or `all`   | `web search "a" "b" --provider all --json`       |
| `web search-image <url>` | Pages that contain or resemble a public image | `web search-image https://.../logo.png`          |
| `web read <url...>`      | One URL or a batch into normalized content    | `web read https://example.com --max-chars 20000` |
| `web providers`          | Who is configured and what each one can do    | `web providers`                                  |
| `web mcp`                | The MCP server on stdio                       | `web mcp`                                        |

`--provider` and `--max-results` work on every search. Domain, source, category and date filters go to the providers that understand them and get reported as ignored on the ones that don't. `--json` gives you the same envelope the library and the agent tools return. The full flag list is in the [CLI guide](https://web.agntn.dev/guide/cli).

## 🧠 Library

```typescript
import { create, readUrl, searchAll } from "@agntn/web";

const exa = create("exa"); // reads EXA_API_KEY
const results = await exa.search("typescript runtime benchmarks", { maxResults: 5 });

for (const result of results) {
  console.log(result.title, result.url);
}

const everything = await searchAll("typescript runtime benchmarks"); // every configured provider, deduplicated
console.log(everything.map((result) => [result.url, result.providers]));

const page = await readUrl("https://example.com", { format: "markdown", maxChars: 20_000 });
console.log(page.title, page.truncated, page.continuation);
```

That's most of it, really. `create("brave")` instead of `create("exa")` and nothing else in your code changes. `searchWithFallback()` picks the provider the CLI would and tells you in `attempts` who dropped out along the way. `searchProviderDetailed()` is the same search with `pagination` attached, pass its `continuation` back and you get page two. Errors are one family: a 401 is `AuthError`, spent credits are `PaymentError` whatever status they hide behind, a 429 is `RateLimitError` with `retryAfter`, and no response at all is `HTTPError` with status 0 and the real cause underneath. The details and the gotchas: [Searching](https://web.agntn.dev/guide/search), [Fan-out](https://web.agntn.dev/guide/fanout), [Reading](https://web.agntn.dev/guide/read), [Reverse image search](https://web.agntn.dev/guide/image).

## 🗺️ Providers

| Provider         | Auth                                                 | Does                | Filters                      | Pages |
| ---------------- | ---------------------------------------------------- | ------------------- | ---------------------------- | ----- |
| **brave**        | `BRAVE_API_KEY`                                      | search              | none                         | yes   |
| **context**      | `CONTEXT_DEV_API_KEY`                                | search, read        | domains                      |       |
| **exa**          | `EXA_API_KEY`                                        | search              | domains, category, dates     |       |
| **firecrawl**    | `FIRECRAWL_API_KEY`                                  | search, read        | domains, sources, categories |       |
| **jina**         | `JINA_API_KEY`, optional for read                    | search, read        | include domains, category    |       |
| **mojeek**       | `MOJEEK_API_KEY`                                     | search              | domains, dates               | yes   |
| **openai-codex** | Existing login, optional `OPENAI_CODEX_ACCESS_TOKEN` | search              | none                         |       |
| **searxng**      | None, your own instance                              | search              | category                     | yes   |
| **serpapi**      | `SERPAPI_API_KEY`                                    | search, searchImage | none                         | yes   |
| **serpbase**     | `SERPBASE_API_KEY`                                   | search              | category                     | yes   |
| **tavily**       | `TAVILY_API_KEY`                                     | search, read        | domains, category, dates     |       |
| **tinyfish**     | `TINYFISH_API_KEY`                                   | search, read        | domains, category, dates     | yes   |

Codex is the odd one out: no key, it borrows the login you already have in Codex, Pi, OMP or OpenCode, and `snippet` comes back empty because the model's answer is not a page excerpt. What each one fills in, which filters it honours and where it bites: [Providers](https://web.agntn.dev/providers).

## 🤖 Agents

```bash
web mcp
pi install git:github.com/agntn/web
omp install @agntn/web
```

```json
{
  "mcpServers": {
    "web": { "command": "npx", "args": ["-y", "@agntn/web", "mcp"] }
  }
}
```

Four tools, `web_search`, `web_search_image`, `web_read` and `web_providers`, the same four on the AI SDK (`@agntn/web/ai`), MCP, Pi and OMP. Reads stop at 20 000 characters unless the model asks for more, and the page's link list stays out unless it asks for that too, so nobody stuffs a whole site into a context window by accident. Pi also gets `/web` and `/web-providers`. Schemas and envelopes for each host: [Agents guide](https://web.agntn.dev/guide/agents).

## 🚫 What this does not do

No browser. Nothing here renders JavaScript, crawls a site or takes a screenshot, and `search-image` sends a URL and gets pages back, there is no OCR or image analysis behind it. Yesterday's version of a page is [@agntn/archives](https://github.com/agntn/archives).

## 🧩 Adding a provider

Missing your favourite engine? Extend `Provider`, implement `search`, `read` or `searchByImage`, call `register()`, and the CLI, the tools and `all` see it without a name tuple to edit. A built in one also needs its line in `builtinProviders`, and `test/index.test.ts` will tell you if you forgot. Step by step, with the contract spelled out: [Custom providers](https://web.agntn.dev/guide/custom).

## 🛠️ Development

```bash
pnpm install
pnpm lint        # builds first, then oxlint and oxfmt --check
pnpm lint:fix
pnpm typecheck   # src, the build config and both extensions
pnpm test:run
pnpm build       # obuild
pnpm docs        # the Docus site, bundles src/ itself
```

## 💛 Thanks

This package exists thanks to two open source programs, [Claude for Open Source](https://claude.com/contact-sales/claude-for-oss) at Anthropic and [Codex for Open Source](https://developers.openai.com/community/codex-for-oss) at OpenAI.

## 📄 License

[MIT](./LICENSE)
