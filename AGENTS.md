# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-06
**Commit:** pending
**Branch:** main

## OVERVIEW

`@agntn/web` is a unified web-access provider for agents and CLI. It exposes three explicit capabilities: `search` (query → result URLs/snippets), `image search` (image URL → matching pages/images), and `read` (URL → normalized page content). Providers implement only the capabilities they support; keep each capability behind its own interface.

Keep URL-based image search here while it returns web matches through lightweight provider adapters. Image uploads, hosting, OCR, embeddings, perceptual hashes, and local image analysis belong in a separate image or vision package. Likewise, split browser rendering, crawling, many read-only providers, or heavy read dependencies out of this package when they stop being lightweight.

## STRUCTURE

```
src/
├── core/                 # Registry, shared types/errors, searchAll, readUrl
├── providers/            # Provider adapters; integrations may support search and/or read
├── commands/             # citty CLI subcommands (`search`, `read`, `providers`, `mcp`)
├── index.ts              # Public API barrel
├── ai.ts                 # Vercel AI SDK tools
├── mcp.ts                # MCP server surface (createMcpServer, executors)
└── cli.ts                # CLI entry point
packages/
├── omp/extensions/web.ts # OMP tool surface
└── pi/extensions/web.ts  # Pi tool/command surface
src/tui.ts                # Shared terminal-safe presentation for Pi, OMP, and MCP
docs/                     # Docus site: guide, provider pages, live explorer on Workers (see docs/AGENTS.md)
test/unit/                # Public behavior and provider contract tests
.github/workflows/
├── test.yml              # CI: typecheck -> build -> test
└── publish.yml           # npm OIDC publish on v* tags
```

## WHERE TO LOOK

| Task                 | Location                                                                | Notes                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add public exports   | `src/index.ts`                                                          | Keep the public surface small and explicit                                                                                                                        |
| Add/extend providers | `src/providers/`                                                        | Keep provider response shapes inside the adapter                                                                                                                  |
| Add search behavior  | `src/core/all.ts` + provider adapter                                    | Preserve query → results semantics                                                                                                                                |
| Add image search     | `src/core/image.ts` + provider adapter + `src/commands/search-image.ts` | Preserve image URL → matching pages/images semantics; keep local image analysis out                                                                               |
| Add read behavior    | `src/core/read.ts` + provider adapter + `src/commands/read.ts`          | Preserve URL → content semantics                                                                                                                                  |
| Extend CLI           | `src/commands/` + `src/cli.ts`                                          | Add subcommands with `citty`; keep text and JSON output stable                                                                                                    |
| Extend agent tools   | `src/ai.ts`, `packages/{pi,omp}/extensions/web.ts`, `src/mcp.ts`        | Static descriptions advertise built in names; execution validates strings against the live registry capability functions                                          |
| Change TUI rendering | `src/tui.ts` + both extension adapters                                  | Keep collapsed rows compact, expanded previews bounded, and every interpolated value safe for terminals                                                           |
| Extend MCP server    | `src/mcp.ts` + `src/commands/mcp.ts`                                    | The low level SDK `Server` uses TypeBox schemas; every error branch goes through `errorResult`; executor guards check boundaries again when hosts skip validation |
| Add tests            | `test/`                                                                 | Mirror public behavior, not implementation details                                                                                                                |
| Change build outputs | `vite.config.ts` + `package.json`                                       | Keep `pack.entry` and `exports` aligned                                                                                                                           |
| Change CI flow       | `.github/workflows/test.yml`                                            | Order stays `check -> pack -> test`                                                                                                                               |
| Change release flow  | `.github/workflows/publish.yml`                                         | Publish through npm OIDC only from `v*` tags                                                                                                                      |

## CONVENTIONS

- ESM-only package, no CommonJS output
- Vite+ owns checks, tests and packaging; `vp pack` emits the library through its `pack` config
- Public API stays export-barrel-driven from `src/index.ts`
- CLI should be thin and call reusable functions from `src/index.ts`
- Prefer normalized models over provider-shaped raw objects
- Keep capability names explicit and topically aligned: `search*` for query → results, `searchImage*`/`searchByImage` for image URL → matches, and `read*`/`readUrl` for URL → content
- Keep capability order consistent across APIs and documentation: search, search image, read
- CLI must support both human-readable and machine-readable JSON output
- Keep provider names and capability flags as literal unions where possible
- Built in capability lists are the source for static descriptions; `searchProviders()`, `searchImageProviders()`, and `readProviders()` are the live execution contract
- Providers load on the first `create()` for their name, so `create()` and its capability variants return a `Promise<Provider>`: `src/providers/index.ts` is a manifest of metadata plus a literal `import()` per provider, the registry seeds its table from it on first use, and every listing or capability lookup answers from the manifest without loading a module. `package.json` says `sideEffects: false`, and `test/bundle.test.ts` proves a consumer bundle keeps the registry and drops the adapters it never asks for
- Command modules keep the registry, the providers and the MCP server behind `import()` inside `run()`; citty resolves every subcommand to print `web --help`, so a static import there loads on the usage path
- Default to minimal dependencies; browser rendering/crawling belongs in a future read package unless explicitly decided otherwise

## ADDING A NEW PROVIDER

Seven files must be updated. Missing any causes a bug (test failure, missing from CLI/Pi, or silent no-op). Checklist:

1. `src/providers/<name>.ts` - export the provider class; support search, read, or both. Nothing runs at module scope: no `register()`, no static capability metadata
2. `src/providers/index.ts` - add a manifest entry with the capabilities the class implements (`search`, `searchImage`, `read`, `pagination`, `availability`) and `load: () => import("./<name>.ts").then((m) => m.<Name>Provider)`; a cap or category list the adapter also clamps to lives in `src/core/providers.ts` so the two never drift
3. `src/core/providers.ts` - add to `builtinProviders` and `providerApiKeyEnvVars` (null when self-hosted like searxng), and to `providerDetectionOrder` when automatic selection may pick it
4. `src/core/read.ts` - add to `readProviderNames` if provider supports read/scrape; `src/core/image.ts` - `imageSearchProviderNames` for reverse image search
5. `vite.config.ts` - nothing: the `pack.entry` glob makes every file in `src/providers/` a bundle input, so `dist/providers/<name>.mjs` and the `./providers/*` export exist as soon as the file does
6. `packages/pi/extensions/web.ts` and `packages/omp/extensions/web.ts` - update provider descriptions and tool schemas; execution validates against live registries
7. `test/unit/<name>.ts` + `test/index.test.ts` - add provider tests + update hardcoded expected list; `test/unit/providers-manifest.test.ts` fails when the entry and the class disagree, and `test/unit/lazy-loading.test.ts` mocks every provider module, so add the new one there

After: `vp check && vp test && vp pack`

Note: tool descriptions are frozen at session start. Execution accepts custom names from the live capability registry; a new session is required before descriptions advertise a newly added built in provider.

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
vp install
vp check
vp pack
vp test
vp run release
vp run docs         # Docus site + explorer on :3000, bundles src/ itself
vp run docs:build   # Cloudflare Workers build of the docs
```
