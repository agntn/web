# CORE SOURCE SCOPE

Library, CLI, MCP, and shared presentation source for `@agntn/web`.

## Conventions

- Keep provider responses behind normalized core interfaces.
- Keep CLI and MCP adapters thin; reusable behavior belongs in core modules.
- `tui.ts` may depend on Node primitives but not on Pi or OMP runtimes.
- MCP must never write presentation output to stdout outside its JSON-RPC transport.
- Changes require typecheck, build, lint, and the relevant unit and adapter tests.
