# Contributing

## What belongs here

Four capabilities, each behind its own interface: `search` (query → results), image search (image URL → matching pages), `read` (URL → content) and `reveal` (URL → what the page hides). APIs and docs list them in that order. A provider implements only the ones it supports.

Image search stays here while it's a URL in and web matches out. Uploads, hosting, OCR, embeddings and perceptual hashes belong in a separate image package. Same for browser rendering, crawling or a read dependency that stops being light: that's a new package, not a new import here.

## Adding a provider

Skip a step and it doesn't always fail loudly. Sometimes the provider just isn't there.

1. `src/providers/<name>.ts` exports the class. Nothing runs at module scope.
2. `src/providers/index.ts` gets a manifest entry with the capabilities the class implements and a literal `import()` as `load`. A cap or category list the adapter clamps to lives in `src/core/providers.ts`, so the two can't drift.
3. `src/core/providers.ts`: `builtinProviders`, `providerApiKeyEnvVars` (`null` for a self-hosted one like SearXNG), `providerDetectionOrder` when automatic selection may pick it, and `readProviderNames` or `imageSearchProviderNames` for those capabilities.
4. `src/tools.ts` names it in the `web_search` or `web_read` description.
5. `test/unit/<name>.test.ts`, the expected list in `test/index.test.ts` and a `vi.mock` line in `test/unit/lazy-loading.test.ts`. `providers-manifest.test.ts` and `docs-counts.test.ts` then point at whatever still disagrees, the provider counts in README and docs included.

`build.config.ts` needs nothing, it bundles every file in `src/providers/`.

The provider's response shape stays inside the adapter. The public API speaks normalized models, and URL → content never hides behind `search()`.

## Tools and CLI

One definition in `src/tools.ts` reaches MCP, Pi, OMP, the AI SDK and the CLI, so a fix never lands in one surface only. The CLI stays thin: no network code, human output and `--json` both, and formatting kept out of the core models. Provider name lists come from one export in `src/core/providers.ts`, never a copy per surface.

Static tool descriptions list the built in names, while execution checks the live registry. A host reads descriptions once per session, so a new built in provider shows up there only after a restart.

Blank optional text inputs count as unset on every surface, through `src/core/options.ts`. Required ones still reject an empty value.

## Tests

Test what a caller sees, not how many times something got called. No external services: a test that needs the internet is a demo. Register cleanup right away for temp files, globals, env changes and open handles. obuild picks the chunk names in `dist/_chunks/`, so never look one up by name.

## Dependencies

Fewer is better. A browser, a crawler or a heavy runtime is the cue for a separate package, see the top. The package is ESM only, with no CJS shims, `as any` or `@ts-ignore`.
