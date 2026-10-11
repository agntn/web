# OMP EXTENSION SCOPE

OMP-facing adapters for `@agntn/web`. The library under `src/` owns provider behavior; this directory owns OMP registration through `registerOmpTools`, rendering adapters, and runtime loading.

## Conventions

- Keep both tool loader imports literal (`src/tools.ts` in a checkout, `@agntn/web/tools` in the package); OMP resolves bare imports only in a specifier it can see.
- Return host-neutral width-aware components; do not import OMP TUI modules directly.
- Every web tool is `effect: "read"` in `src/tools.ts`, which the adapter turns into `approval: "read"`.
- Execution and schemas are the shared definitions in `src/tools.ts`; this file only registers them and draws them.
- Local extensions import library types from `../../../src/index.ts`, never through the self package name.
- Every changed path needs extension typecheck, tests, build, and an OMP plugin smoke.
