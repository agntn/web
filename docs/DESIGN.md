# Design system

The shared rules (direction, color roles, type, the `console-*` grammar, hero, docs chrome, density, motion, checks) live in the one agntn design system document, kept with the agntn skills until it ships in the shared package. This file records only what web owns and where it departs from the shared rules. It does not repeat them.

The instruments web owns:

| Instrument | Where | Object |
| --- | --- | --- |
| [LandingHero.vue](app/components/content/LandingHero.vue) | landing, first screen | hero zone, circuit `ask` into the explorer form |
| [ExplorerForm.vue](app/components/ExplorerForm.vue) | under the hero on the landing and `/explorer` | one run: the operation as tabs, its inputs in a readout, examples as chips |
| [LandingResults.vue](app/components/content/LandingResults.vue) | "Query in, results out" | one `search()` answer, four result rows, walked across the samples |
| [LandingFanout.vue](app/components/content/LandingFanout.vue) | "Ask them all, keep the evidence" | one `searchAllDetailed` answer as provider cells |
| [ProviderCells.vue](app/components/ProviderCells.vue) | fan-out on the landing and `/explorer` | every search provider as a cell, the node says answered, failed or not asked |
| [LandingRead.vue](app/components/content/LandingRead.vue) | "URL in, page out" | one `readUrl` answer: the page, five lines of it, the whole of it in a dialog |
| [ProviderRoster.vue](app/components/content/ProviderRoster.vue) | landing | roster of the providers on `UTable`, sortable |
| [LandingToolCall.vue](app/components/content/LandingToolCall.vue) | "Four tools, every host" | `web_search` arguments, answer and the recorded JSON |
| [LandingRotatingCode.vue](app/components/content/LandingRotatingCode.vue) | "Same calls, every adapter" | the same ten lines for every sample, as a file |
| [LandingStart.vue](app/components/content/LandingStart.vue) | closing section | install, notes, first search as a file |
| [ProviderFacts.vue](app/components/content/ProviderFacts.vue) | every provider page | provider dossier: ID bar with position, reticle, identifiers, capabilities, options |
| [ExplorerAnswer.vue](app/components/ExplorerAnswer.vue) | `/explorer` | one run: the subject band, the fallback chain, results, cells, the page or the provider table |
| [Landing.takumi.vue](app/components/OgImage/Landing.takumi.vue), [Docs.takumi.vue](app/components/OgImage/Docs.takumi.vue) | OG images | the hero zone in 1200 by 600; a docs page as one instrument with the section tag, ruler and the four tools |

Provider names, icons, env vars, hosts, capabilities and the roster sentence come from [providers.ts](app/utils/providers.ts). The operations, example queries and the answer shapes the explorer mirrors come from [explorer.ts](app/utils/explorer.ts). The landing samples come from [landing-fixtures.ts](app/utils/landing-fixtures.ts), recorded through the library.

## Nuxt UI variants

Controls are Nuxt UI components; `app.config.ts` gives each variant its family look with classes from `app.css`, the same mapping as registries.

| Component and variant | Look | Used for |
| --- | --- | --- |
| `UButton` primary solid | amber action segment, glyph in its own cell | get started, run, read the guide |
| `UButton` neutral outline | quiet action segment | GitHub, open the explorer |
| `UButton` neutral subtle | boxed control, `square` for a step | copy, previous and next |
| `UButton` variant `chip`, neutral or primary | chip, the picked one on the accent edge | example queries and pages |
| `UBadge` neutral subtle, neutral outline | boxed mono word: bright, quiet | whether the worker holds a key (`ready`, `no key`) |
| `UTabs` link | mono capitals on a rule, accent segment under the open tab | the four operations in the form |
| `UInput` none, `USelectMenu` none | the readout row is the frame, the value mono | query, URL, provider, reader, bound |
| `UAlert` error outline | red edge, message in mono | a failed run |

## Anatomy

- **Explorer form.** Bar `Call <function>(<argument>)` in its short form, meta the provider count. `UTabs` for search, fan-out, read and providers under the ruler. The reticle carries the glyph of the provider the run names, or the operation's glyph for `auto`. Readout rows change with the operation: query and provider for a search, query and what fan-out asks, URL, reader and bound for a read, where the matrix comes from for providers. The landing sends a run to `/explorer`; the explorer runs it in place and keeps the ruler cursor looping while it waits.
- **Explorer answer.** Bar tagged with the operation and the library call, meta the fetch time. Subject band: reticle, `Query / <provider>` or `Page / <reader>`, the query or the page title, one sentence, readout of the numbers that matter. Under it the fallback chain as leads when more than one provider was tried, provider cells for a fan-out, results as rows, the page text for a read, `listProviders()` on `UTable` for providers. The worker's whole JSON is the `03 Full answer` dialog; the footer carries the same run as a CLI line with copy.
- **Provider cells.** One cell per search provider in catalog order: glyph, name, node. Answered is the bright name and a filled node, failed a red node, not asked a hollow one. The failure message is in the cell's `UTooltip`, never a row. Below 27rem of container the glyph goes and three columns stay.
- **Provider dossier.** ID bar with the key and `01 / 13`, meta the API host. Subject band: reticle with the provider glyph, `create("<key>")` and the env var as boxed identifiers. Readout: auth, results with paging, free tier. Bands `Capabilities [ search · image · read ]` with one cell per capability, a supported one links into the explorer, and `Options` with leads `Filters`, `Fields`, `Category`, `Read`.
- **Roster.** `listProviders()` in the bar, catalog order until a header is clicked. Columns: provider, key, what it talks to, and what it can do at the end of a dotted leader.
- **Landing instruments.** Every one keeps one height across the samples at every width: rows and values end in an ellipsis with the whole value in a `UTooltip`, the results list keeps four slots, the page excerpt five lines.

## Motion

| Change | Motion |
| --- | --- |
| landing sample advances (4.2 s, paused on hover and focus) | ruler cursor once, scan and reticle arcs, rows slide in, file name rolls |
| run in flight | ruler cursor loops (`console-cursor-busy`) on the form and the answer |
| reduced motion | no walk; previous and next still work |

## Differences

Departures from the shared rules, recorded for the shared package:

- The landing instruments walk recorded samples and swap in the worker's live answer when it lands; the bar meta says `recorded` or `live`, as on registries and explorers.
- The landing's hero instrument is a working form, so it stays on a phone (`hero-instrument-keep`).
- The explorer page has no metrics row in its hero zone: its limits live in `server/utils/query.ts`, which the page cannot read.
- The landing tool call has no `content[0].text` of its own: the recorded samples keep neither the continuation token nor `undeclaredFilters`, so its dialog shows the recorded answer in that shape and says so.
- `/providers` keeps its markdown matrix as the index, drawn as a roster by `ProseTable`, because it carries filters and paging a roster row has no room for. The old card group is gone.
- Provider glyphs mix `simple-icons` (Brave, Mojeek, SearXNG) with Lucide glyphs for providers that have no monochrome mark of their own.
- Below 360px the landing's header and footer take the 16px docs gutter: the logo and three icon cells do not fit in 320px with 32px on each side.
- The version comes from the root `package.json`; no data version exists, so ID strips and footers carry none.
- The OG images ship local Figtree and Fira Code TTFs, the keys mechanism.

## Checks

Beyond the shared checks: the landing at 1440, 1024, 390 and 320 px with the heights of the five walked instruments through all four samples and each against its text column, `/explorer` for each of the four operations, `/providers` and one provider page.
