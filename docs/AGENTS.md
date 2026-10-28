# docs/

Cloudflare Workers Builds deploys this site to web.agntn.dev with `docs` as the root directory. Its `pnpm install` walks up to the root lockfile and installs the whole workspace. So a bare import in `../src` resolves from the root, same as on your machine.

Nothing builds `dist/` there, which is why the library comes from `../src` (see `nuxt.config.ts`).

Resources on the Cloudflare account, bound by id in `wrangler.jsonc`:

- D1 `agntn-web` as `DB`, for Nuxt Content
- KV as `CACHE`, the response cache
- Rate limiting binding `QUERY_LIMIT`, 20 new queries a minute per client

Provider keys are Worker secrets, never vars, one per provider the explorer should answer for (`BRAVE_API_KEY` and so on). A provider without one reports `configured: false` and answers 503. SearXNG never runs on the worker, since it would point at `localhost:8080`.
