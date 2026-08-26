# TEST SCOPE

Tests exercise public behavior and real integration seams with Vitest.

## Conventions

- Prefer observable behavior over implementation details and call-count assertions.
- Keep network access mocked by filesystem/provider fixtures; tests must not require external services.
- Register cleanup immediately for temporary files, globals, environment changes, and open handles.
- Run the focused test first, then the full suite when shared process or module state is involved.
