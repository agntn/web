# PI EXTENSION SCOPE

Pi-facing adapters for `@agntn/web`. The library under `src/` owns provider and batch behavior; this directory owns registration, schemas, rendering, and runtime loading.

## Conventions

- Verify APIs against the installed `@earendil-works/pi-coding-agent` runtime.
- Keep tools thin and capability-specific: `web_search`, `web_read`, `web_providers`.
- Local package loading must tolerate unbuilt or stale ignored `dist/`; published packages may fall back to their built export.
- Every changed tool path needs a direct execute smoke plus package typecheck, tests, and build.
