import type { SearchProviderMetadata, SearchProviderPagination } from "./core/all.ts";
import type { ReadBatchDetailedItem } from "./core/batch.ts";
import type {
  SearchAgentResults,
  SearchAllAgentResult,
  SearchBatchAgentItem,
} from "./core/evidence.ts";
import type { ProviderFailure } from "./core/fallback.ts";
import { hiddenKinds, type HiddenKind } from "./core/hidden-kinds.ts";
import type { HiddenFinding } from "./core/hidden.ts";
import { MAX_AGENT_READ_CHARS, MAX_SEARCH_CONTINUATION_LENGTH } from "./core/limits.ts";
import type { ReadUrlDetailedResult } from "./core/read.ts";
import type { ProviderStatus } from "./core/resolve.ts";
import type { RevealResult } from "./core/reveal.ts";
import type { SearchFilterReport } from "./core/search-filters.ts";
import type {
  ImageSearchResult,
  ReadonlySearchResult,
  ReadResult,
  SearchFilterName,
  SearchPagination,
} from "./core/types.ts";
import type { RuntimeInfo } from "./version.ts";
import {
  formatProviderCapabilities,
  sanitizeTerminalContent,
  sanitizeTerminalText,
} from "./tui.ts";

const RESULT_MAX_CHARACTERS = 4_000;
const FIELD_MAX_CHARACTERS = 300;
const TEXT_MAX_CHARACTERS = 900;

/** One provider's answer, as an explicit or automatic search returns it. */
export interface SearchProviderAnswer {
  readonly provider: string;
  readonly results: SearchAgentResults;
  readonly ignoredFilters: readonly SearchFilterName[];
  readonly undeclaredFilters: readonly SearchFilterName[];
  readonly pagination: SearchPagination;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly attempts?: readonly string[];
  readonly failures?: readonly ProviderFailure[];
  readonly skipped?: readonly string[];
}

/** What an automatic call went through: the order tried, each failure, the passed over. */
interface FallbackTrail {
  readonly attempts?: readonly string[];
  readonly failures?: readonly ProviderFailure[];
  readonly skipped?: readonly string[];
}

/** A fan-out answer with each provider failure already reduced to its message. */
export interface SearchAllAnswer {
  readonly results: SearchAgentResults;
  readonly successfulProviders: readonly string[];
  readonly errors: readonly ProviderFailure[];
  readonly filterReports: readonly SearchFilterReport[];
  readonly providerPagination: readonly SearchProviderPagination[];
  readonly providerMetadata?: readonly SearchProviderMetadata[];
}

/** What `web_providers` answers with. */
export interface ProvidersAnswer {
  readonly runtime: RuntimeInfo;
  readonly packageCapabilities: {
    readonly search: { readonly continuation: { readonly option: string; readonly scope: string } };
    readonly read: {
      readonly outputLimit: {
        readonly option: string;
        readonly agentDefault: number;
        readonly agentMaximum: number;
      };
      readonly continuation: { readonly option: string };
    };
  };
  readonly providers: readonly Readonly<ProviderStatus>[];
}

/**
 * The model's view of one provider's search.
 * @param query - The query as searched.
 * @param answer - What the provider returned.
 * @param autoSelected - Whether automatic selection picked the provider.
 * @returns {string} Header line, then the results, continuation and provider metadata.
 */
export function searchProviderText(
  query: string,
  answer: Readonly<SearchProviderAnswer>,
  autoSelected: boolean,
): string {
  const tag = autoSelected ? " (auto-selected default)" : "";
  const ignored =
    answer.ignoredFilters.length === 0 ? "" : ` [ignored=${answer.ignoredFilters.join(",")}]`;
  const undeclared =
    answer.undeclaredFilters.length === 0
      ? ""
      : ` [filter support undeclared=${answer.undeclaredFilters.join(",")}]`;
  const header = `[provider=${line(answer.provider, 80)}] ${answer.results.length} result(s) for "${line(query, 500)}"${tag}${ignored}${undeclared}`;
  const body = answer.results.length === 0 ? ["No results."] : results(answer.results);
  return withHeader([header, ...fallbackLines(answer)].join("\n"), [
    ...body,
    ...paginationLines(answer.pagination),
    ...(answer.metadata === undefined
      ? []
      : ["", `Provider metadata: ${metadataText(answer.metadata)}`]),
  ]);
}

/**
 * The model's view of a fan-out to every configured provider.
 * @param query - The query as searched.
 * @param answer - Merged results and per-provider reports.
 * @returns {string} Header line, then the results and what each provider reported.
 */
export function searchAllText(query: string, answer: Readonly<SearchAllAnswer>): string {
  const providers = answer.successfulProviders.map((provider) => line(provider, 80));
  const list = providers.length > 0 ? ` [${providers.join(", ")}]` : "";
  const errors = answer.errors.length > 0 ? ` (+${answer.errors.length} provider error(s))` : "";
  const header = `[provider=all] ${answer.results.length} result(s) for "${line(query, 500)}" via ${providers.length} provider(s)${list}${errors}`;
  return withHeader(header, [
    ...(answer.results.length === 0 ? ["No results."] : fanoutResults(answer.results)),
    ...fanoutReports(answer),
    ...errorLines(answer.errors),
  ]);
}

/**
 * The model's view of a batch: one block per query, each with its own results or error.
 * @param outcomes - Outcomes in query order.
 * @returns {string} The blocks, separated by blank lines.
 */
export function searchBatchText(outcomes: readonly SearchBatchAgentItem[]): string {
  return outcomes
    .map((outcome, index) => {
      const header = `[${index + 1}] ${line(outcome.query, 500)}`;
      if ("error" in outcome) {
        return [header, `Error: ${line(outcome.error, 2_000)}`, ...fallbackLines(outcome)].join(
          "\n",
        );
      }
      const body =
        outcome.results.length === 0
          ? ["No results."]
          : outcome.provider === "all"
            ? fanoutResults(outcome.results)
            : results(outcome.results);
      const tagged = `${header} [provider=${line(outcome.provider, 80)}]`;
      return withHeader([tagged, ...fallbackLines(outcome)].join("\n"), [
        ...body,
        ...filterLines(outcome.filterReports),
        ...(outcome.pagination === undefined ? [] : paginationLines(outcome.pagination)),
        ...fanoutReports({ ...outcome, filterReports: [] }),
        ...errorLines(outcome.errors ?? []),
      ]);
    })
    .join("\n\n");
}

/**
 * The model's view of a reverse image search.
 * @param url - The image searched for.
 * @param provider - The provider that answered.
 * @param matches - Pages and images it found.
 * @returns {string} Header line, then one entry per match.
 */
export function imageSearchText(
  url: string,
  provider: string,
  matches: readonly Readonly<ImageSearchResult>[],
): string {
  const header = `[provider=${line(provider, 80)}] ${matches.length} image match(es) for ${line(url, 200)}`;
  return withHeader(
    header,
    matches.map((match, index) => {
      const dimensions =
        match.imageWidth === undefined || match.imageHeight === undefined
          ? ""
          : ` ${match.imageWidth}x${match.imageHeight}`;
      return `${index + 1}. ${line(match.title || "(no title)", 200)}\n   ${line(match.pageUrl, 500)}\n   ${line(match.imageUrl, 500)}${dimensions}`;
    }),
  );
}

/**
 * The model's view of one page read.
 * @param answer - The page with the reader that returned it.
 * @returns {string} Header line naming the reader, then the page.
 */
export function readText(answer: ReadAnswerView): string {
  const header = `[provider=${line(answer.provider, 80)} requested=${line(answer.requestedProvider, 80)}${ignoredLabel(answer.ignoredOptions)}] read ${line(answer.result.url, 200)}`;
  return withHeader([header, ...fallbackLines(answer)].join("\n"), pageLines(answer.result));
}

/**
 * The model's view of a batch read: one block per URL, each with its page or error.
 * @param outcomes - Outcomes in URL order.
 * @returns {string} The blocks, separated by blank lines.
 */
export function readBatchText(
  outcomes: readonly ((ReadAnswerView & { readonly url: string }) | ReadFailureView)[],
): string {
  return outcomes
    .map((outcome, index) => {
      const header = `[${index + 1}] ${line(outcome.url, 200)}`;
      if ("error" in outcome) {
        return [header, `Error: ${line(outcome.error, 2_000)}`, ...fallbackLines(outcome)].join(
          "\n",
        );
      }
      const tagged = `${header} [provider=${line(outcome.provider, 80)} requested=${line(outcome.requestedProvider, 80)}${ignoredLabel(outcome.ignoredOptions)}]`;
      return withHeader([tagged, ...fallbackLines(outcome)].join("\n"), pageLines(outcome.result));
    })
    .join("\n\n");
}

/**
 * The model's view of the running build and every registered provider.
 * @param answer - Runtime, package guarantees and provider statuses.
 * @returns {string} One line each for the build and the package, then one per provider.
 */
export function providersText(answer: Readonly<ProvidersAnswer>): string {
  const { runtime, packageCapabilities } = answer;
  const readLimit = packageCapabilities.read.outputLimit;
  const searchContinuation = packageCapabilities.search.continuation;
  return [
    `web ${runtime.version} build ${runtime.buildId}, started ${runtime.processStartedAt}`,
    `search continuation=${searchContinuation.option} (${searchContinuation.scope}); portable read content: ${readLimit.option} defaults to ${readLimit.agentDefault}, max ${readLimit.agentMaximum}; continuation=${packageCapabilities.read.continuation.option}`,
    ...(answer.providers.length > 0
      ? answer.providers.map(providerLine)
      : ["No providers registered."]),
  ].join("\n");
}

/** A reveal cut to what one answer shows, with how many of each kind the page holds. */
export interface RevealAnswer {
  readonly text: string;
  readonly result: RevealResult & {
    readonly counts: Readonly<Partial<Record<HiddenKind, number>>>;
    readonly truncated?: true;
    readonly omitted?: number;
  };
}

/** The heading each kind of finding is listed under. */
const REVEAL_HEADINGS: Readonly<Record<HiddenKind, string>> = {
  comment: "Comments",
  hidden: "Hidden elements",
  field: "Form fields",
  camouflage: "Text in its background's color",
  invisible: "Invisible characters",
  attribute: "Data and nonstandard attributes",
  meta: "Meta tags",
  link: "Links",
  script: "Scripts",
  style: "Styles",
};

/** Singular and plural for the count line. */
const REVEAL_NOUNS: Readonly<Record<HiddenKind, readonly [string, string]>> = {
  comment: ["comment", "comments"],
  hidden: ["hidden element", "hidden elements"],
  field: ["form field", "form fields"],
  camouflage: ["text in its background's color", "texts in their background's color"],
  invisible: ["run of invisible characters", "runs of invisible characters"],
  attribute: ["attribute", "attributes"],
  meta: ["meta tag", "meta tags"],
  link: ["link", "links"],
  script: ["script", "scripts"],
  style: ["style", "styles"],
};

/** Below this many characters left, a first finding too long to fit is left out, not cut. */
const SMALLEST_CUT = 200;

/** One line per finding, by kind. */
const FINDING_LINES: Readonly<Record<HiddenKind, (finding: HiddenFinding) => string>> = {
  comment: (finding) =>
    `line ${finding.line} in ${line(finding.element ?? "document", 80)}: ${commentText(finding.value)}`,
  hidden: (finding) => `line ${finding.line} ${elementText(finding)}${valueText(finding, ": ")}`,
  field: (finding) =>
    `line ${finding.line} ${line(finding.element ?? "field", 80)} ${line(finding.name ?? "(no name)", 200)}${valueText(finding, " = ")} (${line(finding.reason ?? "", 200)})`,
  camouflage: (finding) =>
    `line ${finding.line} ${elementText(finding)}${valueText(finding, ": ")}`,
  invisible: (finding) =>
    `line ${finding.line}${finding.element === undefined ? "" : ` in ${line(finding.element, 80)}`}: ${codePointsText(finding)} around "${line(finding.value ?? "", 300)}"`,
  attribute: (finding) =>
    `line ${finding.line} ${line(finding.element ?? "", 80)} ${line(finding.name ?? "", 200)}${valueText(finding, "=")}${finding.reason === undefined ? "" : ` (${line(finding.reason, 80)})`}${finding.count === undefined ? "" : ` on ${finding.count} elements`}`,
  meta: (finding) =>
    `line ${finding.line} ${line(finding.name ?? "meta", 200)}${valueText(finding, ": ")}`,
  link: (finding) =>
    `line ${finding.line} ${line(finding.name ?? "link", 80)}${valueText(finding, " ")}`,
  script: (finding) => codeText(finding),
  style: (finding) => codeText(finding),
};

/**
 * The model's view of a reveal: a header with counts, then findings by kind while they fit.
 * @param result - What `revealUrl` found.
 * @param maxChars - Most characters the answer may take.
 * @returns {RevealAnswer} The text, and the result cut to the findings the text shows.
 */
export function revealAnswer(result: Readonly<RevealResult>, maxChars: number): RevealAnswer {
  const counts = kindCounts(result.findings);
  const header = revealHeader(result, counts);
  const writer = new RevealWriter(maxChars - codePoints(header));
  for (const finding of result.findings) {
    if (!writer.add(finding)) break;
  }
  const omitted = result.findings.length - writer.shown.length;
  const body = writer.lines.length > 0 ? writer.lines : ["", "Nothing found."];
  const note =
    omitted > 0 ? ["", truncationNote(result.findings.slice(writer.shown.length), maxChars)] : [];
  return {
    text: [header, ...body, ...note].join("\n"),
    result: {
      ...result,
      counts,
      findings: writer.shown,
      ...(omitted > 0 ? { truncated: true as const, omitted } : {}),
    },
  };
}

/** Writes findings under their headings while the budget lasts. */
class RevealWriter {
  readonly lines: string[] = [];
  readonly shown: HiddenFinding[] = [];
  private kind: HiddenKind | undefined;
  private left: number;

  constructor(budget: number) {
    this.left = budget;
  }

  /**
   * @param finding - The next finding.
   * @returns {boolean} False once the budget is spent.
   */
  add(finding: HiddenFinding): boolean {
    const heading = finding.kind === this.kind ? [] : ["", REVEAL_HEADINGS[finding.kind]];
    const room = this.left - codePoints([...heading, ""].join("\n")) - 1;
    const shown = withinRoom(finding, room);
    const text = `  ${FINDING_LINES[finding.kind](shown)}`;
    const length = codePoints(text);
    if (shown === finding && length <= room) {
      return this.write(finding, heading, text, this.left - room + length);
    }
    if (this.shown.length > 0 || room < SMALLEST_CUT || shown.value === undefined) return false;
    const cut = cutFinding(finding, codePoints(shown.value) - (length - room));
    return this.write(cut, heading, clipText(text, room), this.left);
  }

  private write(
    finding: HiddenFinding,
    heading: readonly string[],
    text: string,
    cost: number,
  ): boolean {
    this.lines.push(...heading, text);
    this.shown.push(finding);
    this.kind = finding.kind;
    this.left -= cost;
    return true;
  }
}

function revealHeader(
  result: Readonly<RevealResult>,
  counts: Readonly<Partial<Record<HiddenKind, number>>>,
): string {
  const source =
    result.archive === "wayback"
      ? `Read ${line(result.source, 500)}, the Wayback capture as archived, without its toolbar`
      : result.source === result.url
        ? undefined
        : `Read ${line(result.source, 500)}`;
  const found = hiddenKinds.flatMap((kind) => {
    const count = counts[kind];
    return count === undefined ? [] : [`${count} ${REVEAL_NOUNS[kind][count === 1 ? 0 : 1]}`];
  });
  return [
    `[reveal] ${line(result.url, 500)}`,
    ...(source === undefined ? [] : [source]),
    sizeLine(result),
    ...(found.length === 0 ? [] : [`Found ${found.join(", ")}`]),
  ].join("\n");
}

/**
 * The type, the bytes read, and how many stylesheets the reveal applied.
 * @param result - What `revealUrl` found.
 * @returns {string} Such as `text/html · 832 bytes · 2 stylesheets applied`.
 */
function sizeLine(result: Readonly<RevealResult>): string {
  const size = `${result.bytes.toLocaleString("en")} bytes${result.partial === true ? ", the start of a longer page" : ""}`;
  const sheets = result.stylesheets?.length ?? 0;
  const applied = sheets === 0 ? [] : [`${sheets} stylesheet${sheets === 1 ? "" : "s"} applied`];
  return [line(result.contentType ?? "unknown type", 120), size, ...applied].join(" · ");
}

function kindCounts(findings: readonly HiddenFinding[]): Partial<Record<HiddenKind, number>> {
  const counts: Partial<Record<HiddenKind, number>> = {};
  for (const { kind } of findings) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

function truncationNote(left: readonly HiddenFinding[], maxChars: number): string {
  const counts = kindCounts(left);
  const kinds = hiddenKinds.flatMap((kind) => {
    const count = counts[kind];
    return count === undefined ? [] : [`${count} ${REVEAL_NOUNS[kind][count === 1 ? 0 : 1]}`];
  });
  const next =
    maxChars < MAX_AGENT_READ_CHARS
      ? `raise maxChars above ${maxChars} to list them`
      : "the page holds more than one answer shows";
  return `[truncated: left out ${kinds.join(", ")}; ${next}]`;
}

function elementText(finding: HiddenFinding): string {
  return `${line(finding.element ?? "element", 80)} (${line(finding.reason ?? "", 300)})`;
}

/**
 * A finding's value after a separator, or `(no text)` for a hidden element that has none.
 * @param finding - The finding.
 * @param separator - What goes between the label and the value.
 * @returns {string} The separator and the value with its full size when it was cut, or nothing.
 */
function valueText(finding: HiddenFinding, separator: string): string {
  if (finding.value === undefined) return finding.kind === "hidden" ? ": (no text)" : "";
  const size = finding.size === undefined ? "" : ` [cut from ${finding.size} characters]`;
  return `${separator}${line(finding.value, 1_200)}${size}`;
}

function commentText(value: string | undefined): string {
  return sanitizeTerminalContent(value ?? "").replaceAll("\n", "\n    ");
}

function codePointsText(finding: HiddenFinding): string {
  const points = (finding.codePoints ?? []).join(" ");
  const more = finding.size === undefined ? "" : ` and more, ${finding.size} in all`;
  const spelled = finding.reason === undefined ? "" : `, ${line(finding.reason, 600)}`;
  return `${points}${more}${spelled}`;
}

function codeText(finding: HiddenFinding): string {
  const reason = finding.reason === undefined ? "" : ` (${line(finding.reason, 120)})`;
  const size = finding.size === undefined ? "" : ` [${finding.size} characters]`;
  return `line ${finding.line} ${line(finding.value ?? "", 600)}${reason}${size}`;
}

/**
 * A finding whose value is no longer than the room left, so a huge one is never sanitized whole.
 * @param finding - The finding.
 * @param room - Characters left in the answer.
 * @returns {HiddenFinding} The finding itself when it fits, otherwise a copy with a shorter value.
 */
function withinRoom(finding: HiddenFinding, room: number): HiddenFinding {
  const value = finding.value;
  if (value === undefined) return finding;
  const head = firstCodePoints(value, Math.max(0, room) + 1);
  return head.length === value.length ? finding : { ...finding, value: head };
}

/**
 * The start of a text, stopping after `count` code points without walking the rest.
 * @param text - The text.
 * @param count - How many code points to keep.
 * @returns {string} The text itself when it is no longer.
 */
function firstCodePoints(text: string, count: number): string {
  let end = 0;
  let taken = 0;
  for (const character of text) {
    if (taken === count) break;
    end += character.length;
    taken += 1;
  }
  return text.slice(0, end);
}

/**
 * A finding whose value is cut to fit the space left.
 * @param finding - The finding.
 * @param length - How many characters of its value fit.
 * @returns {HiddenFinding} The finding with the value cut and its full size kept.
 */
function cutFinding(finding: HiddenFinding, length: number): HiddenFinding {
  const value = finding.value ?? "";
  return {
    ...finding,
    value: clipText(value, Math.max(1, length)),
    size: finding.size ?? codePoints(value),
  };
}

function clipText(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, Math.max(0, max - 1)).join("")}…`;
}

function codePoints(text: string): number {
  let count = 0;
  for (const _character of text) count += 1;
  return count;
}

/**
 * One provider: ✓ configured and reachable (or never probed), ⚠ the probe failed, · not configured.
 * @param status - The provider status.
 * @returns {string} The symbol, name, key variable and capabilities on one line.
 */
function providerLine(status: Readonly<ProviderStatus>): string {
  const symbol = !status.configured ? "·" : status.reachable === false ? "⚠" : "✓";
  const env = status.envVar ? ` (${status.envVar})` : "";
  const unreachable = status.configured && status.reachable === false ? " - unreachable" : "";
  return `${symbol} ${line(status.name, 80)}${env}${unreachable} ${formatProviderCapabilities(status)}`;
}

/**
 * The fallback an automatic call took, shown only when a provider failed or was passed over.
 * @param trail - Attempts, failures and spent providers the call reported.
 * @returns {string[]} Lines under the header, empty when the first provider answered.
 */
function fallbackLines(trail: FallbackTrail): string[] {
  const failures = trail.failures ?? [];
  const skipped = trail.skipped ?? [];
  if (failures.length === 0 && skipped.length === 0) return [];
  return [
    `Tried: ${(trail.attempts ?? []).map((provider) => line(provider, 80)).join(", ")}`,
    ...failures.map(
      (failure) => `  ${line(failure.provider, 80)} failed: ${line(failure.error, 300)}`,
    ),
    ...(skipped.length === 0
      ? []
      : [
          `  Passed over with spent credits: ${skipped.map((provider) => line(provider, 80)).join(", ")}`,
        ]),
  ];
}

function withHeader(header: string, body: readonly string[]): string {
  const joined = body.join("\n");
  return joined ? `${header}\n\n${joined}` : `${header}\nNo results.`;
}

function results(records: SearchAgentResults): string[] {
  return records.map((record, index) => resultText(record, index));
}

/**
 * Fan-out results name their providers and list the other records under each.
 * @param records - Results of a fan-out, or of a batch item that fanned out.
 * @returns {string[]} One entry per result.
 */
function fanoutResults(records: SearchAgentResults): string[] {
  return records.map((record, index) =>
    isFanoutResult(record) ? fanoutResultText(record, index) : resultText(record, index),
  );
}

function isFanoutResult(
  record: ReadonlySearchResult | SearchAllAgentResult,
): record is SearchAllAgentResult {
  return "providers" in record && Array.isArray(record.providers);
}

function fanoutResultText(record: Readonly<SearchAllAgentResult>, index: number): string {
  const providers = record.providers.join(", ");
  const evidence = record.evidence ?? [];
  if (evidence.length === 0) return resultText(record, index, providers);
  const head = resultText(record, index, providers, Math.floor(RESULT_MAX_CHARACTERS / 3));
  const heading = "\n   Evidence:\n";
  const remaining =
    RESULT_MAX_CHARACTERS -
    Array.from(head).length -
    Array.from(heading).length -
    (evidence.length - 1);
  const each = Math.max(2, Math.floor(remaining / evidence.length));
  const others = evidence.map((other, otherIndex) =>
    resultText(other, otherIndex, other.provider, each),
  );
  return cut(`${head}${heading}${others.join("\n")}`, RESULT_MAX_CHARACTERS);
}

function resultText(
  record: ReadonlySearchResult,
  index: number,
  providers?: string,
  maxCharacters = RESULT_MAX_CHARACTERS,
): string {
  const lines = [
    `${index + 1}. ${field(record.title || "(no title)", 160)}`,
    `   ${field(record.url, 300)}`,
    ...describedFields(record, providers),
    labeled("Text", record.text, TEXT_MAX_CHARACTERS),
  ].filter(Boolean);
  return cut(lines.join("\n"), maxCharacters);
}

function describedFields(record: ReadonlySearchResult, providers: string | undefined): string[] {
  return [
    labeled("Snippet", record.snippet),
    labeled("Providers", providers, 160),
    labeled("Score", record.score, 40),
    labeled("Published", record.publishedDate, 100),
    labeled("Author", record.author, 160),
    labeled("Image", record.image),
    labeled("Favicon", record.favicon),
    labeled("Summary", record.summary),
    labeled("Highlights", record.highlights?.join(" | "), 400),
    labeled("Metadata", record.metadata && metadataText(record.metadata), 400),
  ];
}

function labeled(
  label: string,
  value: string | number | undefined,
  maxCharacters = FIELD_MAX_CHARACTERS,
): string {
  if (value === undefined || value === "") return "";
  return `   ${label}: ${field(String(value), maxCharacters)}`;
}

function field(value: string, maxCharacters: number): string {
  return cut(line(value, RESULT_MAX_CHARACTERS), maxCharacters);
}

function cut(text: string, maxCharacters: number): string {
  const characters = Array.from(text);
  if (characters.length <= maxCharacters) return text;
  return `${characters.slice(0, maxCharacters - 1).join("")}…`;
}

/**
 * Filter warnings, continuations and metadata a fan-out reports per provider.
 * @param answer - The per-provider reports.
 * @returns {string[]} Labeled blocks, empty when nothing was reported.
 */
function fanoutReports(
  answer: Readonly<{
    filterReports: readonly SearchFilterReport[];
    providerPagination?: readonly SearchProviderPagination[];
    providerMetadata?: readonly SearchProviderMetadata[];
  }>,
): string[] {
  return [
    ...filterLines(answer.filterReports),
    ...continuationLines(answer.providerPagination ?? []),
    ...metadataLines(answer.providerMetadata ?? []),
  ];
}

function errorLines(errors: readonly ProviderFailure[]): string[] {
  if (errors.length === 0) return [];
  return [
    "",
    "Provider errors:",
    ...errors.map((error) => `  ${line(error.provider, 80)}: ${line(error.error, 2_000)}`),
  ];
}

function filterLines(reports: readonly SearchFilterReport[]): string[] {
  if (reports.length === 0) return [];
  return [
    "",
    "Filter warnings:",
    ...reports.flatMap((report) => [
      ...(report.ignoredFilters.length > 0
        ? [`  ${line(report.provider, 80)}: ignored ${report.ignoredFilters.join(", ")}`]
        : []),
      ...(report.undeclaredFilters.length > 0
        ? [
            `  ${line(report.provider, 80)}: support undeclared for ${report.undeclaredFilters.join(", ")}`,
          ]
        : []),
    ]),
  ];
}

function paginationLines(pagination: SearchPagination): string[] {
  return pagination.status === "next" || pagination.status === "unknown"
    ? [
        "",
        `Continuation (${pagination.status}): ${line(pagination.continuation, MAX_SEARCH_CONTINUATION_LENGTH)}`,
      ]
    : [];
}

function continuationLines(records: readonly SearchProviderPagination[]): string[] {
  const continuing = records.flatMap(({ provider, pagination }) =>
    pagination.status === "next" || pagination.status === "unknown"
      ? [
          `  ${line(provider, 80)}: ${line(pagination.continuation, MAX_SEARCH_CONTINUATION_LENGTH)}`,
        ]
      : [],
  );
  return continuing.length === 0 ? [] : ["", "Provider continuations:", ...continuing];
}

function metadataLines(records: readonly SearchProviderMetadata[]): string[] {
  if (records.length === 0) return [];
  return [
    "",
    "Provider metadata:",
    ...records.map(
      ({ provider, metadata }) => `  ${line(provider, 80)}: ${metadataText(metadata)}`,
    ),
  ];
}

function metadataText(metadata: Readonly<Record<string, unknown>>): string {
  try {
    return line(JSON.stringify(metadata), 500);
  } catch {
    return "[unserializable metadata]";
  }
}

function ignoredLabel(options: readonly string[] | undefined): string {
  return options?.length ? ` ignored=${options.join(",")}` : "";
}

/** A page read with the reader that returned it, as `readUrlDetailed` and a batch item carry it. */
type ReadAnswerView = Readonly<
  Pick<ReadUrlDetailedResult, "provider" | "requestedProvider" | "ignoredOptions">
> &
  FallbackTrail & { readonly result: PageView };

type ReadFailureView = Readonly<Pick<ReadBatchDetailedItem, "url">> &
  FallbackTrail & { readonly error: string };

type PageView = Readonly<
  Pick<ReadResult, "title" | "url" | "description" | "content" | "truncated" | "continuation">
> & {
  readonly links?: readonly string[];
  readonly images?: readonly string[];
};

function pageLines(page: PageView): string[] {
  const lines = [line(page.title || "(no title)", 500), `   ${line(page.url, 500)}`];
  if (page.description) lines.push(`   ${line(page.description, 160)}`);
  if (page.content) lines.push("", sanitizeTerminalContent(page.content));
  if (page.truncated) {
    const continuation = page.continuation
      ? `; continuation=${line(page.continuation, 1_024)}`
      : "";
    lines.push("", `[truncated${continuation}]`);
  }
  lines.push(...urlLines("Links", page.links), ...urlLines("Images", page.images));
  return lines;
}

function urlLines(label: string, urls: readonly string[] | undefined): string[] {
  if (urls === undefined || urls.length === 0) return [];
  return ["", `${label} (${urls.length}):`, ...urls.map((url) => `  ${line(url, 500)}`)];
}

function line(value: unknown, maxLength: number): string {
  return sanitizeTerminalText(value, maxLength);
}
