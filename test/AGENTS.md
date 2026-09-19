# TEST SCOPE

Tests exercise public behavior and real integration seams with Vitest.

## Conventions

- Prefer observable behavior over implementation details and call-count assertions.
- Keep network access mocked by filesystem/provider fixtures; tests must not require external services.
- Register cleanup immediately for temporary files, globals, environment changes, and open handles.
- Run the CLI usage paths under `test/fixtures/record-loads.mjs`; `--help`, `-h`, `mcp --help` and no arguments must not load the server, a provider or the HTTP client. `providers` and `mcp` load the manifest and no adapter; a data command loads the adapters it names.
- `test/unit/lazy-loading.test.ts` mocks every provider module to count evaluations, so a new provider gets a `vi.mock` line there, and `test/unit/providers-manifest.test.ts` loads each manifest entry against the class it names.
- Run the focused test first, then the full suite when shared process or module state is involved.
