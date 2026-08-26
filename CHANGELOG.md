# Changelog

## v0.2.0

[compare changes](https://github.com/agntn/web/compare/v0.1.2...v0.2.0)

### 🚀 Enhancements

- **opencode:** Add plugin as subpath export ([#5](https://github.com/agntn/web/pull/5))
- **ai:** Expose search filters in AI tool ([#23](https://github.com/agntn/web/pull/23))
- **searchAll:** Add searchAllDetailed with per-provider error reporting ([#24](https://github.com/agntn/web/pull/24))
- **tavily:** Pass domain filters to Tavily API ([#27](https://github.com/agntn/web/pull/27))
- **packages:** Add `pi` ([#31](https://github.com/agntn/web/pull/31))
- Add Jina search and read support ([#32](https://github.com/agntn/web/pull/32))
- Support SerpBase search ([#34](https://github.com/agntn/web/pull/34))

### 🩹 Fixes

- Map HTTP 401 transport errors to AuthError ([#6](https://github.com/agntn/web/pull/6))
- **index:** Auto-register built-in providers ([#7](https://github.com/agntn/web/pull/7))
- **searchAll:** Fail fast on unknown explicit providers ([#8](https://github.com/agntn/web/pull/8))
- **cli:** Resolve default provider for search ([#9](https://github.com/agntn/web/pull/9))
- **searchAll:** Dedupe URLs with reordered query params ([#18](https://github.com/agntn/web/pull/18))
- **cli:** Validate --max-results before provider calls ([#17](https://github.com/agntn/web/pull/17))
- Redact mixed-case sensitive query keys ([#16](https://github.com/agntn/web/pull/16))
- Guard retryAfter against non-numeric Retry-After headers ([#19](https://github.com/agntn/web/pull/19))
- **searchAll:** Throw NoProviderConfiguredError on empty provider list ([#20](https://github.com/agntn/web/pull/20))
- **searchAll:** Reject empty and whitespace-only queries ([#25](https://github.com/agntn/web/pull/25))
- **dates:** Validate date filter strings before passing to providers ([#29](https://github.com/agntn/web/pull/29))

### 💅 Refactors

- **cli:** Reuse shared provider status in providers command ([#10](https://github.com/agntn/web/pull/10))
- **client:** Return errors from mapError instead of throwing ([#21](https://github.com/agntn/web/pull/21))

### 📖 Documentation

- Mark project experimental ([cb3f696](https://github.com/agntn/web/commit/cb3f696))
- Surface Pi extension earlier ([85f6b33](https://github.com/agntn/web/commit/85f6b33))

### 🏡 Chore

- **repo:** Remove redundant npmrc overrides ([28b8791](https://github.com/agntn/web/commit/28b8791))
- Rename opencode plugin package ([#15](https://github.com/agntn/web/pull/15))
- ⚠️ Rename to `askweb` ([#30](https://github.com/agntn/web/pull/30))

### ✅ Tests

- **resolve:** Add unit tests for provider detection and resolution ([#22](https://github.com/agntn/web/pull/22))

#### ⚠️ Breaking Changes

- ⚠️ Rename to `askweb` ([#30](https://github.com/agntn/web/pull/30))

### ❤️ Contributors

- Ori ([@oritwoen](https://github.com/oritwoen))
- Oritwoen ([@oritwoen](https://github.com/oritwoen))

## v0.1.2

[compare changes](https://github.com/agntn/web/compare/v0.1.1...v0.1.2)

### 🩹 Fixes

- **version:** Inline package version ([#2](https://github.com/agntn/web/pull/2))

### ❤️ Contributors

- Ori ([@oritwoen](https://github.com/oritwoen))

## v0.1.1
