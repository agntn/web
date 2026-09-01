import { stripVTControlCharacters } from "node:util";

import stringWidth from "string-width";

/** Web tools with dedicated Pi and OMP presentation. */
export type WebToolName = "web_search" | "web_search_image" | "web_read" | "web_providers";

/** Colors used by the shared web presentation. */
export type StatusColor =
  | "accent"
  | "dim"
  | "error"
  | "muted"
  | "success"
  | "toolOutput"
  | "toolTitle";

/** Theme methods shared by the Pi and OMP render adapters. */
export interface StatusTheme {
  readonly fg?: (color: StatusColor, text: string) => string;
  readonly bold?: (text: string) => string;
}

/** Render state fields exposed across Pi and OMP. */
export interface RenderOptions {
  readonly expanded?: boolean;
  readonly isPartial?: boolean;
  readonly spinnerFrame?: number;
  readonly executionStarted?: boolean;
  readonly viewportWidth?: number;
}

/** Width-aware component shared by the Pi and OMP adapters. */
export interface ViewportText {
  readonly render: (width: number) => string[];
  readonly invalidate: () => void;
}

/** Small common result shape consumed by both host renderers. */
export interface RenderedToolResult {
  readonly content?: readonly unknown[];
  readonly details?: unknown;
  readonly isError?: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FIELD_WIDTH = 88;
const META_WIDTH = 48;
const FIELD_SCAN_LIMIT = 2048;
const PREVIEW_LINES = 10;
const PREVIEW_WIDTH = 180;
const TERMINAL_UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const MALFORMED_SURROGATE = /\p{Cs}/gu;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const PRESENTATION: Readonly<Record<WebToolName, { symbol: string; label: string }>> = {
  web_search: { symbol: "⌕", label: "Web Search" },
  web_search_image: { symbol: "▧", label: "Search by Image" },
  web_read: { symbol: "↗", label: "Web Read" },
  web_providers: { symbol: "◫", label: "Web Providers" },
};

function cutAt(text: string, end: number): string {
  const last = text.codePointAt(end - 1);
  const splitsPair = last !== undefined && (last > 0xffff || (last >= 0xd800 && last <= 0xdbff));
  return text.slice(0, splitsPair ? end - 1 : end);
}

function clip(text: string, max: number): string {
  if (max <= 0) return "";
  if (stringWidth(text) <= max) return text;
  let clipped = "";
  let width = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
    const segmentWidth = stringWidth(segment);
    if (width + segmentWidth > max - 1) break;
    clipped += segment;
    width += segmentWidth;
  }
  return `${clipped}…`;
}

function cleanTerminalText(text: string): string {
  return stripVTControlCharacters(text.replace(MALFORMED_SURROGATE, " "))
    .replace(TERMINAL_UNSAFE, " ")
    .replaceAll(/\p{Zs}+/gu, " ");
}

/** Sanitize one untrusted value before it reaches a terminal component.
 * @param value - Value crossing the terminal boundary.
 * @param max - Maximum rendered field width.
 * @returns {string} Terminal-safe single-line text.
 */
export function sanitizeTerminalText(value: unknown, max = FIELD_WIDTH): string {
  const text = String(value);
  const bounded = text.length > FIELD_SCAN_LIMIT ? `${cutAt(text, FIELD_SCAN_LIMIT - 1)}…` : text;
  return clip(cleanTerminalText(bounded).replaceAll(/\s+/g, " ").trim(), max);
}

function paint(theme: Readonly<StatusTheme>, color: StatusColor, text: string): string {
  return theme.fg ? theme.fg(color, text) : text;
}

function viewportWidth(options: Readonly<RenderOptions> | undefined): number {
  const width = options?.viewportWidth;
  return width === undefined || !Number.isFinite(width)
    ? PREVIEW_WIDTH
    : Math.max(1, Math.floor(width));
}

/** Create a component that lays out its immutable content at the host viewport width.
 * @param renderText - Width-aware text factory.
 * @returns {ViewportText} Host-neutral component.
 */
export function createViewportText(renderText: (width: number) => string): ViewportText {
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;
  return {
    render(width: number) {
      const constrainedWidth = Math.max(1, Math.floor(width));
      if (cachedWidth !== constrainedWidth || cachedLines === undefined) {
        cachedWidth = constrainedWidth;
        cachedLines = renderText(constrainedWidth).split("\n");
      }
      return cachedLines;
    },
    invalidate() {
      cachedWidth = undefined;
      cachedLines = undefined;
    },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function scalar(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function listLength(record: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = record[key];
  return Array.isArray(value) ? value.length : undefined;
}

function callIcon(
  options: Readonly<RenderOptions> | undefined,
): Readonly<{ glyph: string; color: StatusColor }> {
  if (options?.isPartial === false) return { glyph: "✓", color: "success" };
  if (options?.spinnerFrame !== undefined) {
    return {
      glyph: SPINNER_FRAMES[options.spinnerFrame % SPINNER_FRAMES.length] ?? "⠋",
      color: "accent",
    };
  }
  return options?.executionStarted === true
    ? { glyph: "◌", color: "accent" }
    : { glyph: "·", color: "muted" };
}

function inputSubject(name: WebToolName, record: Readonly<Record<string, unknown>>): string {
  if (name === "web_search") {
    const query = record.query;
    return Array.isArray(query)
      ? `${query.length} queries`
      : sanitizeTerminalText(query ?? "Search", FIELD_WIDTH);
  }
  if (name === "web_read") {
    const url = record.url;
    return Array.isArray(url) ? `${url.length} pages` : sanitizeTerminalText(url ?? "Page");
  }
  if (name === "web_search_image") return sanitizeTerminalText(record.url ?? "Image");
  return "Provider registry";
}

function searchInputMeta(record: Readonly<Record<string, unknown>>): string[] {
  const maxResults = scalar(record, "maxResults");
  const filterCount = [
    "includeDomains",
    "excludeDomains",
    "sources",
    "categories",
    "category",
    "startPublishedDate",
    "endPublishedDate",
  ].filter((key) => record[key] !== undefined).length;
  return [
    ...(maxResults ? [`top ${sanitizeTerminalText(maxResults, META_WIDTH)}`] : []),
    ...(filterCount > 0 ? [`${filterCount} filter${filterCount === 1 ? "" : "s"}`] : []),
  ];
}

function readInputMeta(record: Readonly<Record<string, unknown>>): string[] {
  const format = scalar(record, "format");
  const maxTokens = scalar(record, "maxTokens");
  return [
    ...(format ? [sanitizeTerminalText(format, META_WIDTH)] : []),
    ...(maxTokens ? [`${sanitizeTerminalText(maxTokens, META_WIDTH)} tokens`] : []),
  ];
}

function inputMeta(name: WebToolName, record: Readonly<Record<string, unknown>>): string[] {
  const provider = scalar(record, "provider");
  const operationMeta =
    name === "web_search"
      ? searchInputMeta(record)
      : name === "web_search_image"
        ? searchInputMeta(record).slice(0, 1)
        : name === "web_read"
          ? readInputMeta(record)
          : [];
  return [
    ...(provider ? [sanitizeTerminalText(provider, META_WIDTH)] : []),
    ...operationMeta,
  ].slice(0, 4);
}

/** Return the symbol and label used by native tool menus.
 * @param name - Registered web tool name.
 * @returns {string} Stable symbol and label.
 */
export function webToolTitle(name: WebToolName): string {
  const item = PRESENTATION[name];
  return `${item.symbol} ${item.label}`;
}

/** Render one compact, terminal-safe tool call row.
 * @param name - Registered web tool name.
 * @param args - Untrusted model arguments.
 * @param options - Host render state.
 * @param theme - Active host theme.
 * @returns {string} One terminal row.
 */
export function renderWebToolCall(
  name: WebToolName,
  args: unknown,
  options: Readonly<RenderOptions> | undefined,
  theme: Readonly<StatusTheme>,
): string {
  const record = isRecord(args) ? args : {};
  const icon = callIcon(options);
  const title = webToolTitle(name);
  const width = viewportWidth(options);
  const prefixText = `${icon.glyph} ${title}`;
  const prefixWidth = stringWidth(prefixText);
  if (prefixWidth >= width) return paint(theme, icon.color, clip(prefixText, width));

  const subject = inputSubject(name, record);
  const meta = inputMeta(name, record);
  const tail = clip([subject, meta.join(" · ")].filter(Boolean).join(" "), width - prefixWidth - 1);
  const prefix = [
    paint(theme, icon.color, icon.glyph),
    paint(theme, "toolTitle", theme.bold ? theme.bold(title) : title),
  ].join(" ");
  return tail ? `${prefix} ${paint(theme, "dim", tail)}` : prefix;
}

function resultText(result: Readonly<RenderedToolResult>): string {
  const parts: string[] = [];
  for (const part of result.content ?? []) {
    if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("\n").trimEnd();
}

function detailText(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > FIELD_SCAN_LIMIT ? `${cutAt(value, FIELD_SCAN_LIMIT - 1)}…` : value;
}

function searchResultPreview(item: unknown): string[] {
  if (!isRecord(item)) return [];
  const title = detailText(item, "title");
  const url = detailText(item, "url") ?? detailText(item, "pageUrl");
  const snippet = detailText(item, "snippet");
  return [title, url, snippet].filter((value): value is string => value !== undefined);
}

function searchPreview(details: unknown): string | undefined {
  if (!isRecord(details)) return undefined;
  if (Array.isArray(details.results)) {
    return details.results.slice(0, 4).flatMap(searchResultPreview).join("\n") || undefined;
  }
  if (!Array.isArray(details.outcomes)) return undefined;
  const lines = details.outcomes.slice(0, 3).flatMap((outcome) => {
    if (!isRecord(outcome)) return [];
    const query = detailText(outcome, "query");
    const error = detailText(outcome, "error");
    const results = Array.isArray(outcome.results)
      ? outcome.results.slice(0, 2).flatMap(searchResultPreview)
      : [];
    return [query, error, ...results].filter((value): value is string => value !== undefined);
  });
  return lines.join("\n") || undefined;
}

function readPreview(details: unknown): string | undefined {
  if (!isRecord(details)) return undefined;
  const result = isRecord(details.result) ? details.result : undefined;
  if (result && typeof result.content === "string") return result.content;
  if (!Array.isArray(details.outcomes)) return undefined;
  const lines = details.outcomes.slice(0, PREVIEW_LINES).flatMap((outcome) => {
    if (!isRecord(outcome)) return [];
    const url = detailText(outcome, "url");
    const error = detailText(outcome, "error");
    const provider = detailText(outcome, "provider");
    return [url, error ?? provider].filter((value): value is string => value !== undefined);
  });
  return lines.join("\n") || undefined;
}

function providersPreview(details: unknown): string | undefined {
  if (!isRecord(details) || !Array.isArray(details.providers)) return undefined;
  const lines = details.providers.slice(0, PREVIEW_LINES + 1).flatMap((provider) => {
    if (!isRecord(provider)) return [];
    const name = detailText(provider, "name");
    if (!name) return [];
    const state =
      provider.configured !== true
        ? "not configured"
        : provider.reachable === false
          ? "unreachable"
          : "configured";
    return [`${name} · ${state}`];
  });
  return lines.join("\n") || undefined;
}

function structuredPreview(name: WebToolName, details: unknown): string | undefined {
  if (name === "web_search" || name === "web_search_image") return searchPreview(details);
  if (name === "web_read") return readPreview(details);
  return providersPreview(details);
}

function previewText(
  name: WebToolName,
  result: Readonly<RenderedToolResult>,
  text: string,
): string {
  const trimmed = text.trimStart();
  const serialized = trimmed.startsWith("{") || trimmed.startsWith("[");
  return serialized ? (structuredPreview(name, result.details) ?? text) : text;
}

function failedItems(items: readonly unknown[]): number {
  return items.filter((item) => isRecord(item) && typeof item.error === "string").length;
}

function batchMeta(items: readonly unknown[], label: string): string[] {
  const failed = failedItems(items);
  return [`${items.length} ${label}`, ...(failed > 0 ? [`${failed} failed`] : [])];
}

function successfulProvidersMeta(details: Readonly<Record<string, unknown>>): string | undefined {
  const count = listLength(details, "successfulProviders");
  if (count === undefined) return undefined;
  return `${count} provider${count === 1 ? "" : "s"}`;
}

function scalarSearchMeta(details: Readonly<Record<string, unknown>>): string[] {
  const count = scalar(details, "count") ?? listLength(details, "results")?.toString();
  const provider = scalar(details, "provider") ?? successfulProvidersMeta(details);
  const errors = listLength(details, "errors") ?? 0;
  const meta = count ? [`${sanitizeTerminalText(count, META_WIDTH)} results`] : [];
  if (provider) meta.push(sanitizeTerminalText(provider, META_WIDTH));
  if (errors > 0) meta.push(`${errors} provider error${errors === 1 ? "" : "s"}`);
  return meta;
}

function searchMeta(details: unknown): string[] {
  if (Array.isArray(details)) return batchMeta(details, "queries");
  if (!isRecord(details)) return [];
  const outcomes = details.mode === "batch" ? details.outcomes : undefined;
  return Array.isArray(outcomes) ? batchMeta(outcomes, "queries") : scalarSearchMeta(details);
}

function imageMeta(details: unknown): string[] {
  const results = Array.isArray(details)
    ? details.length
    : isRecord(details) && Array.isArray(details.results)
      ? details.results.length
      : undefined;
  const provider = isRecord(details) ? scalar(details, "provider") : undefined;
  return [
    ...(results === undefined ? [] : [`${results} matches`]),
    ...(provider ? [sanitizeTerminalText(provider, META_WIDTH)] : []),
  ];
}

function scalarReadMeta(details: Readonly<Record<string, unknown>>): string[] {
  const provider = scalar(details, "effectiveProvider") ?? scalar(details, "provider");
  const result = isRecord(details.result) ? details.result : undefined;
  const content = result && typeof result.content === "string" ? result.content : undefined;
  const attempts = listLength(details, "attempts") ?? 0;
  const meta = provider ? [sanitizeTerminalText(provider, META_WIDTH)] : [];
  if (content) meta.push(`${content.length.toLocaleString("en")} chars`);
  if (attempts > 1) meta.push(`${attempts} attempts`);
  return meta;
}

function readMeta(details: unknown): string[] {
  if (Array.isArray(details)) return batchMeta(details, "pages");
  if (!isRecord(details)) return [];
  const outcomes = details.mode === "batch" ? details.outcomes : undefined;
  return Array.isArray(outcomes) ? batchMeta(outcomes, "pages") : scalarReadMeta(details);
}

function providersMeta(details: unknown): string[] {
  const record = isRecord(details) ? details : {};
  const providers = Array.isArray(record.providers) ? record.providers : [];
  const configured = providers.filter(
    (provider) => isRecord(provider) && provider.configured === true,
  ).length;
  const reachable = providers.filter(
    (provider) =>
      isRecord(provider) && provider.reachable !== false && provider.configured === true,
  ).length;
  return [
    `${configured}/${providers.length} configured`,
    ...(configured > 0 ? [`${reachable} reachable`] : []),
  ];
}

function resultMeta(name: WebToolName, details: unknown): string[] {
  if (name === "web_search") return searchMeta(details).slice(0, 4);
  if (name === "web_search_image") return imageMeta(details).slice(0, 4);
  if (name === "web_read") return readMeta(details).slice(0, 4);
  return providersMeta(details).slice(0, 4);
}

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

function previewBody(text: string, theme: Readonly<StatusTheme>, width: number): string[] {
  const lines: string[] = [];
  const indent = width > 2 ? "  " : "";
  const contentWidth = Math.max(1, Math.min(PREVIEW_WIDTH, width - stringWidth(indent)));
  let offset = 0;
  while (offset < text.length && lines.length < PREVIEW_LINES) {
    const windowEnd = Math.min(text.length, offset + FIELD_SCAN_LIMIT);
    const window = text.slice(offset, windowEnd);
    const newline = window.indexOf("\n");
    const rawLine = newline === -1 ? window : window.slice(0, newline);
    const line = clip(cleanTerminalText(rawLine).trimEnd(), contentWidth);
    lines.push(`${indent}${paint(theme, "toolOutput", line)}`);
    if (newline !== -1) {
      offset += newline + 1;
    } else if (windowEnd < text.length) {
      break;
    } else {
      offset = text.length;
    }
  }
  if (offset < text.length) {
    const marker = clip("… preview truncated", contentWidth);
    lines.push(`${indent}${paint(theme, "muted", marker)}`);
  }
  return lines;
}

function activityLabel(name: WebToolName): string {
  if (name === "web_search") return "Searching";
  if (name === "web_search_image") return "Matching image";
  if (name === "web_read") return "Reading";
  return "Checking providers";
}

function renderFailure(
  text: string,
  options: Readonly<RenderOptions>,
  theme: Readonly<StatusTheme>,
): string {
  const width = viewportWidth(options);
  if (width === 1) return paint(theme, "error", "✗");
  const description = sanitizeTerminalText(firstLine(text) || "Request failed", width - 2);
  return `${paint(theme, "error", "✗")} ${paint(theme, "dim", description)}`;
}

function resultVerb(name: WebToolName): string {
  if (name === "web_search") return "found";
  if (name === "web_search_image") return "matched";
  if (name === "web_read") return "read";
  return "checked";
}

function renderPartial(
  name: WebToolName,
  options: Readonly<RenderOptions>,
  theme: Readonly<StatusTheme>,
): string {
  const icon = callIcon(options);
  const width = viewportWidth(options);
  if (width === 1) return paint(theme, icon.color, icon.glyph);
  const activity = clip(activityLabel(name), width - 2);
  return `${paint(theme, icon.color, icon.glyph)} ${paint(theme, "dim", activity)}`;
}

function renderSummary(
  name: WebToolName,
  meta: readonly string[],
  options: Readonly<RenderOptions>,
  theme: Readonly<StatusTheme>,
): string {
  const verb = resultVerb(name);
  const prefixText = `✓ ${verb}`;
  const width = viewportWidth(options);
  const prefixWidth = stringWidth(prefixText);
  if (prefixWidth >= width) return paint(theme, "success", clip(prefixText, width));
  const tail = clip(meta.join(" · "), width - prefixWidth - 1);
  const prefix = `${paint(theme, "success", "✓")} ${paint(theme, "accent", verb)}`;
  return tail ? `${prefix} ${paint(theme, "muted", tail)}` : prefix;
}

/** Render a result summary and a bounded expanded preview.
 * @param name - Registered web tool name.
 * @param result - Tool content and structured details.
 * @param isError - Failure flag supplied by the host adapter.
 * @param options - Host render state.
 * @param theme - Active host theme.
 * @returns {string} Compact summary with an optional preview.
 */
export function renderWebToolResult(
  name: WebToolName,
  result: Readonly<RenderedToolResult>,
  isError: boolean,
  options: Readonly<RenderOptions>,
  theme: Readonly<StatusTheme>,
): string {
  const text = resultText(result);
  if (isError || result.isError === true) return renderFailure(text, options, theme);
  if (options.isPartial === true) return renderPartial(name, options, theme);

  const meta = resultMeta(name, result.details);
  const header = renderSummary(name, meta, options, theme);
  const body =
    options.expanded === true && text
      ? previewBody(previewText(name, result, text), theme, viewportWidth(options))
      : [];
  return body.length > 0 ? [header, ...body].join("\n") : header;
}
