# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-06
**Commit:** pending
**Branch:** main

## OVERVIEW

`@agntn/web` is a unified web-access provider for agents and CLI. It currently exposes two explicit capabilities: `search` (query → result URLs/snippets) and `read` (URL → normalized page content). Providers are integrations that may implement one or both capabilities; do not force URL readers into `search()`.

Scope preference from the 2026-05-20 Jina/read session: keep `read` here while it is lightweight, but if read grows into browser rendering, crawling, many read-only providers, or heavy dependencies, split into three packages: search, read, and the `@agntn/web` umbrella using both.

## STRUCTURE

```
src/
├── core/                 # Registry, shared types/errors, searchAll, readUrl
├── providers/            # Provider adapters; integrations may support search and/or read
├── commands/             # citty CLI subcommands (`search`, `read`, `providers`, `mcp`)
├── index.ts              # Public API barrel
├── ai.ts                 # Vercel AI SDK tools
├── opencode.ts           # OpenCode plugin tools
├── mcp.ts                # MCP server surface (createMcpServer, executors)
└── cli.ts                # CLI entry point
packages/pi/extensions/
└── web.ts                # Pi tool/command surface
test/unit/                # Public behavior and provider contract tests
.github/workflows/
├── test.yml              # CI: typecheck -> build -> test
└── publish.yml           # npm OIDC publish on v* tags
```

## WHERE TO LOOK

| Task                 | Location                                                                      | Notes                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add public exports   | `src/index.ts`                                                                | Keep the public surface small and explicit                                                                                                                                           |
| Add/extend providers | `src/providers/`                                                              | Keep provider-shaped responses inside the adapter                                                                                                                                    |
| Add search behavior  | `src/core/all.ts` + provider adapter                                          | Preserve query → results semantics                                                                                                                                                   |
| Add read behavior    | `src/core/read.ts` + provider adapter + `src/commands/read.ts`                | Preserve URL → content semantics                                                                                                                                                     |
| Extend CLI           | `src/commands/` + `src/cli.ts`                                                | Add subcommands with `citty`; keep text and JSON output stable                                                                                                                       |
| Extend agent tools   | `src/ai.ts`, `src/opencode.ts`, `packages/pi/extensions/web.ts`, `src/mcp.ts` | Keep names capability-specific (`searchTool`, `readTool`, `web_search`, `web_read`); MCP mirrors the provider enums from `core/providers.ts` and `core/read.ts`, never a frozen copy |
| Extend MCP server    | `src/mcp.ts` + `src/commands/mcp.ts`                                          | Low-level SDK `Server` with TypeBox schemas; every error branch goes through `errorResult`; executor guards re-check boundaries for hosts that skip validation                       |
| Add tests            | `test/`                                                                       | Mirror public behavior, not implementation details                                                                                                                                   |
| Change build outputs | `build.config.ts` + `package.json`                                            | Keep `entries` and `exports` aligned                                                                                                                                                 |
| Change CI flow       | `.github/workflows/test.yml`                                                  | Order stays `typecheck -> build -> test`                                                                                                                                             |
| Change release flow  | `.github/workflows/publish.yml`                                               | Publish through npm OIDC only from `v*` tags                                                                                                                                         |

## CONVENTIONS

- ESM-only package, no CommonJS output
- `obuild` owns build artifacts; `tsc` is typecheck-only
- Public API stays export-barrel-driven from `src/index.ts`
- CLI should be thin and call reusable functions from `src/index.ts`
- Prefer normalized models over provider-shaped raw objects
- Keep capability names explicit: `search*` for query → results, `read*`/`readUrl` for URL → content
- CLI must support both human-readable and machine-readable JSON output
- Keep provider names and capability flags as literal unions where possible
- Keep capability provider lists single-source: `src/core/read.ts` exports read-capable names; AI/OpenCode/Pi surfaces import that list instead of mirroring `['jina']`
- Default to minimal dependencies; browser rendering/crawling belongs in a future read package unless explicitly decided otherwise

## ADDING A NEW PROVIDER

Seven files must be updated. Missing any causes a bug (test failure, missing from CLI/Pi, or silent no-op). Checklist:

1. `src/providers/<name>.ts` — implement provider, call `register()` at module level; support search, read, or both
2. `src/providers/index.ts` — add `import './<name>.ts'`
3. `src/core/providers.ts` — add to `builtinProviders` array
4. `src/core/resolve.ts` — add env var to `envKeys` map (unless self-hosted like searxng)
5. `src/core/read.ts` — add to `readProviderNames` if provider supports read/scrape
6. `packages/pi/extensions/web.ts` - update the `PROVIDERS` description tuple and tool descriptions; search execution validates against live `builtinProviders`
7. `test/unit/<name>.ts` + `test/index.test.ts` — add provider tests + update hardcoded expected list

After: `pnpm typecheck && pnpm test:run && pnpm build`

Note: Pi tool descriptions (`PROVIDERS` array, description strings) are frozen at session start. Search execution accepts names from live `builtinProviders`, but a new Pi session is required before the schema description advertises a newly added provider.

## ANTI-PATTERNS

- Do not leak provider-specific response formats into public API
- Do not hide URL → content behind `SearchProvider.search()`
- Do not duplicate provider-name arrays across CLI/tool surfaces; update one core export and reuse it
- Do not couple CLI formatting with core data models
- Do not add `as any`, `@ts-ignore`, or placeholder unsafe types
- Do not introduce CJS compatibility shims
- Do not add browser/runtime-heavy dependencies to the core package without revisiting the read/search split
- Do not add network code directly in the CLI
- Do not make tests depend on external services

## COMMANDS

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test:run
pnpm release
```
