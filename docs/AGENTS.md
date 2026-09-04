# docs/

Docus site for `@agntn/web`. Markdown lives in `content/`. The explorer is a Vue page in the Nuxt app backed by Nitro routes over the library, not a script.

## Layout

```
docs/
├── nuxt.config.ts                 # extends: ['docus'], cloudflare_module preset (Workers)
├── app/app.config.ts              # title, github, theme
├── app/app.css                    # theme tokens (light + .dark), shared `web-*` classes
├── app/components/                # Docus overrides: AppHeaderLogo, AppHeaderCTA (nav), AppFooterLeft, DocsAsideLeftBody
├── app/components/content/        # MDC components (`::landing-home`, `::provider-facts`, `::web-explorer`)
├── app/components/OgImage/        # Docs.takumi and Landing.takumi override the Docus OG templates
├── app/assets/fonts.css           # @font-face for the TTFs served from public/fonts (site and OG images)
├── app/composables/               # useLandingSearch (one clock for every live panel), useSubNavigation
├── app/utils/                     # providers table, formatting, recorded landing samples
├── app/pages/explorer.vue         # explorer, own route outside the docs layout
├── server/api/                    # search, all, read, providers over the library
├── server/utils/query.ts          # parameter caps, cache, rate limit, error mapping
├── content/index.md               # landing
├── content/1.guide/               # getting started, search, fanout, read, image, cli, agents, custom, explorer
└── content/2.providers/           # one page per provider
```

## Commands

```bash
pnpm install          # from docs/, after pnpm build in the repo root
pnpm dev              # http://localhost:3000
pnpm build            # Cloudflare Workers output in .output/, content routes prerendered
pnpm deploy           # build, then wrangler deploy to web.agntn.dev
pnpm generate         # static output only; the /api routes need the worker
```

Deployment: Nitro preset `cloudflare_module`. Nuxt Content needs a D1 binding named `DB` and the response cache a KV binding named `CACHE`; `wrangler.jsonc` carries both and the `NUXT_SITE_URL` var, Nitro merges it into the generated `.output/server/wrangler.json`. Create them once with `wrangler d1 create agntn-web` and `wrangler kv namespace create CACHE` and put the ids in `wrangler.jsonc`; the ids there are placeholders until then.

Provider keys are Worker secrets, never vars: `wrangler secret put BRAVE_API_KEY` and so on for every provider the explorer should answer for. With `nodejs_compat` and the compatibility date in `wrangler.jsonc`, the runtime exposes them on `process.env`, which is where the library reads them. A provider without a secret is reported as `configured: false` by `/api/providers` and answers `503` on `/api/search`. SearXNG is left out of fan-out on the worker because it would point at `localhost:8080`.

The site imports `@agntn/web` from `file:..`. Build the parent package first.

Resolution traps, both caused by the repo root being a pnpm workspace:

- `pnpm-workspace.yaml` sets `shamefullyHoist: true`. Without it `docs/node_modules` holds only direct dependencies, Node walks up to the root `node_modules`, and the server bundle can get a second copy of Vue.
- `nuxt.config.ts` pins `workspaceDir` to `docs/` and disables devtools and telemetry, which would otherwise be resolved from the root.

## Live data

- `server/api/search.get.ts` calls `searchProviderDetailed` for a named provider and `searchWithFallback` for `auto`; `all.get.ts` calls `searchAllDetailed` over every configured provider except SearXNG; `read.get.ts` calls `readUrlDetailed` with `format: "markdown"`; `providers.get.ts` returns `listProviders()` and `packageCapabilities`. Every route passes one `deadline` of 25 s and `concurrency: 3` from `budget()`.
- Every route goes through `cachedAnswer` in `server/utils/query.ts`: exact parameters as the key, fifteen minutes for a search or fan-out, an hour for a read, five minutes for an answer that carries a provider failure, nothing for a thrown one. Do not bypass it: the engines behind it are metered. A cache miss also counts against `RATE_LIMIT` (20 new queries a minute per address, 429 past it); cache hits are free.
- Parameters are capped in `server/utils/query.ts` (query 256 chars, `maxResults` 10, `maxChars` 8 000). Raise them there, not per route. Continuation tokens are never returned to the browser.
- Results and failures are cut to size by `slimResult` and `failureText` before they leave the worker; `failureText` keeps the part of a message before the first `:` or `{`, so a provider's response body with account details never reaches the page.
- Library errors are mapped in `toHttpError`: validation errors 400, `NoProviderConfiguredError` and `AuthError` 503, `RateLimitError` 429, `ProviderFallbackError` and `HTTPError` 502.
- `app/utils/landing-fixtures.ts` holds answers recorded through the library so the landing paints before the worker answers. Regenerate it with a script over `dist/index.mjs` (`searchProviderDetailed`, `searchAllDetailed` and `readUrlDetailed` for the four queries, provider fields trimmed as in `slimResult`); never edit the recorded text by hand.
- In production the cache lives in the KV binding `CACHE` (`$production.nitro.storage.cache`); locally it is in memory.
- The explorer applies its deep link through a `watch(route.query)` that fires once: a prerendered page hydrates with an empty query and Nuxt restores the address after mount.

## OG images

- `app/components/OgImage/Docs.takumi.vue` and `Landing.takumi.vue` override the Docus templates of the same name and are rendered by Takumi at build time. Takumi has no CSS variables, so the theme colours from `app.css` are repeated there as literals.
- nuxt-og-image does not see the faces `@nuxt/fonts` generates on this Nuxt version, but it parses `@font-face` rules from the files in `css`. That is why `app/assets/fonts.css` declares the five TTFs in `public/fonts` and `fonts.families` uses the `local` provider: the site and the OG images share the same files.
- The landing OG file is named from the SEO description. Nitro refuses to write a prerender path containing `..`, so a description ending in a period is silently skipped and the landing ships with a dead `og:image`. Keep the description in `content/index.md` free of a trailing period.

## Constraints

- Titles, snippets, highlights and page content are untrusted data. Render them as text through `plainText` or a `<pre>`; never `v-html`, never evaluate.
- Provider names, icons, env vars, hosts and capability columns live once in `app/utils/providers.ts`. The sidebar, the landing grid, the explorer and `::provider-facts` read from it; the capability columns mirror `listProviders()` on the library.
- Keep the docs API shapes (`SearchAnswer` and friends) in the route files; the explorer mirrors them as local interfaces.
