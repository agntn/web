# GitHub Actions workflows

## Scope

CI and npm package publishing workflows for this repository.

## Conventions

- Pin actions to full, verified commit SHAs and retain the exact release tag in a comment.
- Install dependencies with `pnpm` according to `packageManager` in the root `package.json`.
- npm OIDC publishing requires a runner hosted by GitHub, `contents: read`, `id-token: write`, and no `NPM_TOKEN` or `NODE_AUTH_TOKEN`.
- Only `publish.yml` publishes the root package for `v*` tags; do not add another workflow with the same trigger.
- Preserve the typecheck, build, lint, and test order in `test.yml`.

## Key files

- `publish.yml` - OIDC trusted publishing for `@agntn/web`.
- `test.yml` - CI gate for pushes to `main` and pull requests.

## Constraints

Do not put registry secrets in the OIDC workflow. The npm Trusted Publisher configuration must reference the exact workflow filename.
