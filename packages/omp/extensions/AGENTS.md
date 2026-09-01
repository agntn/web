# OMP EXTENSION SCOPE

OMP-facing adapters for `@agntn/web`. The library under `src/` owns provider behavior; this directory owns OMP registration, host TypeBox schemas, rendering adapters, and runtime loading.

## Conventions

- Build schemas with `pi.typebox`; OMP validates against its own TypeBox facade.
- Return host-neutral width-aware components; do not import OMP TUI modules directly.
- Mark every web tool with `approval: "read"`.
- Keep execution behavior aligned with Pi and MCP, and guard schema drift in tests.
- Every changed path needs extension typecheck, tests, build, and an OMP plugin smoke.
