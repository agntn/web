# Changelog

## v0.4.0

[compare changes](https://github.com/agntn/web/compare/v0.3.1...v0.4.0)

### 🚀 Enhancements

- **read:** Report effective fallback provider ([#80](https://github.com/agntn/web/pull/80))
- Identify the running web build ([#81](https://github.com/agntn/web/pull/81))
- **search:** ⚠️ Reveal dropped filters ([#82](https://github.com/agntn/web/pull/82))
- Add reverse image search by URL ([#83](https://github.com/agntn/web/pull/83))
- **search:** Support Mojeek ([#84](https://github.com/agntn/web/pull/84))

### 🩹 Fixes

- **pi:** Leave omitted read provider unset ([#67](https://github.com/agntn/web/pull/67))
- **search:** Fall through providers after 402 ([#68](https://github.com/agntn/web/pull/68))
- **build:** Stop broken source map warnings ([#69](https://github.com/agntn/web/pull/69))
- **cli:** Keep searching after the first 402 ([#75](https://github.com/agntn/web/pull/75))
- **firecrawl:** Honor noCache for reads ([#76](https://github.com/agntn/web/pull/76))
- **typecheck:** Check build configuration ([#77](https://github.com/agntn/web/pull/77))
- **read:** Retry readers after Jina 409 ([#78](https://github.com/agntn/web/pull/78))
- **firecrawl:** Stop ignoring maxTokens ([#79](https://github.com/agntn/web/pull/79))

### 🏡 Chore

- Replace copied ox policy with @agntn/ox ([#66](https://github.com/agntn/web/pull/66))

#### ⚠️ Breaking Changes

- **search:** ⚠️ Reveal dropped filters ([#82](https://github.com/agntn/web/pull/82))

### ❤️ Contributors

- Ori ([@oritwoen](https://github.com/oritwoen))
- Aeitwoen <aeitwoen@gmail.com>

## v0.3.1

[compare changes](https://github.com/agntn/web/compare/v0.3.0...v0.3.1)

## v0.3.0

[compare changes](https://github.com/agntn/web/compare/v0.2.0...v0.3.0)

### 🚀 Enhancements

- Add Firecrawl provider ([#35](https://github.com/agntn/web/pull/35))
- Serve web tools over MCP ([#39](https://github.com/agntn/web/pull/39))
- **firecrawl:** Keep search diagnostics ([#46](https://github.com/agntn/web/pull/46))
- Add batching to web agent tools ([#48](https://github.com/agntn/web/pull/48))
- **cli:** Read several URLs per command ([#52](https://github.com/agntn/web/pull/52))
- **tinyfish:** Wire search and read ([#56](https://github.com/agntn/web/pull/56))
- Add Context.dev provider ([#57](https://github.com/agntn/web/pull/57))

### 🩹 Fixes

- **mcp:** Skip unreachable default providers ([#44](https://github.com/agntn/web/pull/44))
- **read:** Fall back on Jina 402 ([#45](https://github.com/agntn/web/pull/45))
- **pi:** Load web tools from live source ([#49](https://github.com/agntn/web/pull/49))
- **pi:** Stop rejecting live providers ([#62](https://github.com/agntn/web/pull/62))
- **read:** Try configured readers after Jina 402 ([#63](https://github.com/agntn/web/pull/63))

### 💅 Refactors

- ⚠️ Use abstract provider classes ([#36](https://github.com/agntn/web/pull/36))
- ⚠️ Rename package to @agntn/web ([#38](https://github.com/agntn/web/pull/38))

### 🏡 Chore

- Enforce shared lint rules ([#47](https://github.com/agntn/web/pull/47))

### ✅ Tests

- **tinyfish:** Pin Fetch client routing ([#61](https://github.com/agntn/web/pull/61))

### 🤖 CI

- Publish npm package through OIDC ([#51](https://github.com/agntn/web/pull/51))

#### ⚠️ Breaking Changes

- ⚠️ Use abstract provider classes ([#36](https://github.com/agntn/web/pull/36))
- ⚠️ Rename package to @agntn/web ([#38](https://github.com/agntn/web/pull/38))

### ❤️ Contributors

- Ori ([@oritwoen](https://github.com/oritwoen))
- Aeitwoen <aeitwoen@gmail.com>

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
