/** One declared value and where it came from: the element's `style`, or a rule's selector. */
export interface Declaration {
  readonly value: string;
  readonly important: boolean;
  readonly source?: string;
}

/** Declarations by lowercase property name. */
export type Declarations = Readonly<Record<string, Declaration>>;

/** The parts of an element a simple selector can match. */
export interface ElementIdentity {
  readonly tag: string;
  readonly id?: string;
  readonly classes: readonly string[];
}

/** A rule from a `<style>` block whose selector names one tag, id or class set. */
export interface StyleRule {
  readonly selector: string;
  readonly tag?: string;
  readonly id?: string;
  readonly classes: readonly string[];
  readonly specificity: number;
  /** Position in the page's stylesheets, which breaks ties of specificity. */
  readonly order: number;
  readonly declarations: Declarations;
}

/** A color with alpha from 0 to 1. */
export interface Color {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

const COMPOUND_SELECTOR = /^(?<tag>[a-z][\w-]*|\*)?(?<rest>(?:[.#][\w-]+)*)$/iu;
const SELECTOR_PART = /[.#][\w-]+/gu;
const COLOR_TOKEN = /#[\da-f]{3,8}\b|rgba?\([^)]{0,64}\)|\b[a-z]+\b/giu;
/** A background value longer than this holds no color worth reading, only cost. */
const BACKGROUND_SCAN = 200;
/** The properties that hide an element or color its text; a rule with none of them is dropped. */
const READ_PROPERTIES = new Set([
  "background",
  "background-color",
  "clip",
  "clip-path",
  "color",
  "display",
  "font-size",
  "height",
  "left",
  "opacity",
  "overflow",
  "position",
  "text-indent",
  "top",
  "visibility",
  "width",
]);
const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu;
const RGB_COLOR = /^rgba?\((?<body>[^)]*)\)$/iu;
const ZERO_LENGTH = /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[a-z]+|%)?$/iu;
const FAR_OFF = /^-(?<amount>\d+(?:\.\d+)?)px$/iu;
const CLIPPED =
  /^(?:rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)|inset\(\s*(?:50|100)%\s*\))$/iu;
const AT_MOST_ONE_PIXEL = /^(?:0*(?:\.\d+)?|1)(?:px)?$/iu;
/** A pushed element sits this far off the left or top edge, past any screen it could show on. */
const OFF_SCREEN_PIXELS = 999;

/** The CSS named colors pages use for text and backgrounds; any other name compares as unknown. */
const NAMED_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  navy: [0, 0, 128],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  aqua: [0, 255, 255],
  magenta: [255, 0, 255],
  fuchsia: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  teal: [0, 128, 128],
  purple: [128, 0, 128],
  orange: [255, 165, 0],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  whitesmoke: [245, 245, 245],
  snow: [255, 250, 250],
  ivory: [255, 255, 240],
};

/**
 * Read a `style` attribute or a rule body; `!important` holds against a later plain value.
 * @param text - Declarations as written, `;` separated.
 * @param source - Where they came from, kept on each declaration.
 * @returns {Record<string, Declaration>} Declarations by lowercase property.
 */
export function parseDeclarations(text: string, source?: string): Record<string, Declaration> {
  const declarations: Record<string, Declaration> = {};
  for (const part of splitTopLevel(text, ";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    const raw = part.slice(colon + 1).trim();
    const important = /!\s*important$/iu.test(raw);
    const value = (important ? raw.replace(/!\s*important$/iu, "") : raw).trim();
    const declaration = { value, important, ...(source === undefined ? {} : { source }) };
    declarations[property] = winner(declarations[property], declaration);
  }
  return declarations;
}

/**
 * Top-level rules for one element, like `.secret` or `p#key`; `@media` depends on a screen we lack.
 * @param css - Content of a `<style>` element.
 * @param firstOrder - Order of its first rule, after the rules of earlier stylesheets.
 * @returns {StyleRule[]} One rule per simple selector, in source order.
 */
export function parseStylesheet(css: string, firstOrder = 0): StyleRule[] {
  const rules: StyleRule[] = [];
  const text = withoutComments(css);
  let position = 0;
  while (position < text.length) {
    const open = text.indexOf("{", position);
    if (open === -1) break;
    const close = matchingBrace(text, open);
    const prelude = text.slice(position, open).trim();
    if (!prelude.startsWith("@")) {
      rules.push(...selectorRules(prelude, text.slice(open + 1, close), firstOrder + rules.length));
    }
    position = close + 1;
  }
  return rules;
}

/**
 * The cascade for one element: matching rules by specificity, then its `style` attribute.
 * @param rulesFor - The page's rules filed under one key, from {@link ruleKey}.
 * @param element - Tag, id and classes of the element.
 * @param inline - Declarations of its `style` attribute.
 * @returns {Declarations} The declarations that win.
 */
export function cascade(
  rulesFor: (key: string) => readonly StyleRule[],
  element: Readonly<ElementIdentity>,
  inline: Declarations,
): Declarations {
  const keys = new Set(["*", element.tag, ...element.classes.map((name) => `.${name}`)]);
  if (element.id !== undefined) keys.add(`#${element.id}`);
  const matched = [...keys]
    .flatMap((key) => rulesFor(key))
    .filter((rule) => matches(rule, element))
    .toSorted((left, right) => left.specificity - right.specificity || left.order - right.order);
  const result: Record<string, Declaration> = {};
  for (const rule of matched) {
    for (const [property, declaration] of Object.entries(rule.declarations)) {
      result[property] = winner(result[property], declaration);
    }
  }
  for (const [property, declaration] of Object.entries(inline)) {
    result[property] = winner(result[property], declaration);
  }
  return result;
}

/**
 * Why declarations keep an element and everything in it out of sight, if they do.
 * @param declarations - The element's winning declarations.
 * @returns {string | undefined} The deciding declaration, such as `display: none via .secret`.
 */
export function hidingReason(declarations: Declarations): string | undefined {
  return (
    keyword(declarations, "display", ["none"]) ??
    keyword(declarations, "visibility", ["hidden", "collapse"]) ??
    zero(declarations, "opacity") ??
    zero(declarations, "font-size") ??
    transparentText(declarations) ??
    offScreen(declarations) ??
    clipped(declarations) ??
    squeezed(declarations)
  );
}

/**
 * Parse hex, `rgb()`, `rgba()` or a name from {@link NAMED_COLORS}; anything else is unknown.
 * @param value - The declared value.
 * @returns {Color | undefined} The color, or undefined for anything else.
 */
export function parseColor(value: string): Color | undefined {
  const text = value.trim().toLowerCase();
  if (text === "transparent") return { red: 0, green: 0, blue: 0, alpha: 0 };
  if (HEX_COLOR.test(text)) return hexColor(text.slice(1));
  const rgb = RGB_COLOR.exec(text)?.groups?.body;
  if (rgb !== undefined) return rgbColor(rgb);
  const named = Object.hasOwn(NAMED_COLORS, text) ? NAMED_COLORS[text] : undefined;
  return named ? { red: named[0], green: named[1], blue: named[2], alpha: 1 } : undefined;
}

/**
 * The background color declarations paint, from `background-color` or the `background` shorthand.
 * @param declarations - The element's winning declarations.
 * @returns {Color | undefined} The color, or undefined when none is set or it is transparent.
 */
export function backgroundColor(declarations: Declarations): Color | undefined {
  const color = declarations["background-color"]?.value ?? declarations.background?.value;
  if (color === undefined) return undefined;
  for (const [token] of color.slice(0, BACKGROUND_SCAN).matchAll(COLOR_TOKEN)) {
    const parsed = parseColor(token);
    if (parsed !== undefined) return parsed.alpha === 0 ? undefined : parsed;
  }
  return undefined;
}

/**
 * Whether two opaque colors are too close for a reader to tell apart.
 * @param left - One color.
 * @param right - The other.
 * @returns {boolean} True when no channel differs by more than 12 of 255.
 */
export function sameColor(left: Readonly<Color>, right: Readonly<Color>): boolean {
  return (
    Math.abs(left.red - right.red) <= 12 &&
    Math.abs(left.green - right.green) <= 12 &&
    Math.abs(left.blue - right.blue) <= 12
  );
}

/**
 * Write a color the way a reader compares it.
 * @param color - The color.
 * @returns {string} `#rrggbb`.
 */
export function colorText(color: Readonly<Color>): string {
  return `#${[color.red, color.green, color.blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The declaration that holds when a second one sets the same property.
 * @param current - What is set so far.
 * @param next - The later declaration.
 * @returns {Declaration} The later one, unless only the earlier one is `!important`.
 */
function winner(
  current: Readonly<Declaration> | undefined,
  next: Readonly<Declaration>,
): Declaration {
  return current?.important === true && !next.important ? current : next;
}

/**
 * Split on a separator outside parentheses and quotes, so `url(data:a;b)` stays whole.
 * @param text - Text to split.
 * @param separator - One character.
 * @returns {string[]} The parts, trimmed, empty ones left out.
 */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    const quoted = quote !== "";
    quote = quoteAfter(quote, character);
    if (!quoted && quote === "") depth += NESTING[character] ?? 0;
    if (character === separator && quote === "" && depth <= 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** How parentheses move the nesting depth outside quotes. */
const NESTING: Readonly<Record<string, number>> = { "(": 1, ")": -1 };

/**
 * The quote a splitter is inside after one more character.
 * @param quote - The open quote, or an empty string.
 * @param character - The next character.
 * @returns {string} The open quote after it.
 */
function quoteAfter(quote: string, character: string): string {
  if (quote !== "") return character === quote ? "" : quote;
  return character === '"' || character === "'" ? character : "";
}

/**
 * The brace that closes the block opened at `open`, skipping braces inside quoted strings.
 * @param text - Stylesheet text without comments.
 * @param open - Offset of the `{`.
 * @returns {number} Offset of its `}`, or the text length when it never closes.
 */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let index = open; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quote !== "" && character === "\\") {
      index += 1;
      continue;
    }
    const quoted = quote !== "";
    quote = quoteAfter(quote, character);
    if (!quoted && quote === "") depth += BRACES[character] ?? 0;
    if (depth === 0) return index;
  }
  return text.length;
}

/** How braces move the nesting depth outside quotes. */
const BRACES: Readonly<Record<string, number>> = { "{": 1, "}": -1 };

function selectorRules(prelude: string, body: string, order: number): StyleRule[] {
  if (body.includes("{")) return [];
  const declarations = Object.fromEntries(
    Object.entries(parseDeclarations(body)).filter(([property]) => READ_PROPERTIES.has(property)),
  );
  if (Object.keys(declarations).length === 0) return [];
  return splitTopLevel(prelude, ",").flatMap(
    (selector, index) => simpleRule(selector, declarations, order + index) ?? [],
  );
}

/**
 * The key a rule is filed under: its id, else its first class, else its tag, else `*`.
 * @param rule - A rule from {@link parseStylesheet}.
 * @returns {string} The key {@link cascade} asks its lookup for.
 */
export function ruleKey(rule: Readonly<StyleRule>): string {
  if (rule.id !== undefined) return `#${rule.id}`;
  const [first] = rule.classes;
  if (first !== undefined) return `.${first}`;
  return rule.tag ?? "*";
}

/**
 * CSS without its comments, found with `indexOf` so an unclosed `/*` costs one pass.
 * @param css - Stylesheet text.
 * @returns {string} The text with each comment as one space.
 */
function withoutComments(css: string): string {
  let text = "";
  let start = 0;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index] ?? "";
    if (character === '"' || character === "'") {
      index = stringEnd(css, index);
    } else if (character === "/" && css[index + 1] === "*") {
      const close = css.indexOf("*/", index + 2);
      text += `${css.slice(start, index)} `;
      start = close === -1 ? css.length : close + 2;
      index = start - 1;
    }
  }
  return text + css.slice(start);
}

/**
 * Where a quoted CSS string ends: its closing quote, past escapes, or a line break that cuts it.
 * @param css - Stylesheet text.
 * @param open - Offset of the opening quote.
 * @returns {number} Offset of the character that ends the string.
 */
function stringEnd(css: string, open: number): number {
  const quote = css[open];
  for (let index = open + 1; index < css.length; index += 1) {
    if (css[index] === "\\") index += 1;
    else if (css[index] === quote || css[index] === "\n") return index;
  }
  return css.length;
}

/**
 * A rule for a selector naming one element; combinators need a document tree we don't build.
 * @param selector - One selector of a rule's list.
 * @param declarations - The rule's declarations a reveal reads.
 * @param order - Its position among the page's rules.
 * @returns {StyleRule | undefined} The rule, or undefined for any other selector.
 */
function simpleRule(
  selector: string,
  declarations: Declarations,
  order: number,
): StyleRule | undefined {
  const match = COMPOUND_SELECTOR.exec(selector)?.groups;
  if (match === undefined) return undefined;
  const parts = [...(match.rest ?? "").matchAll(SELECTOR_PART)].map(([part]) => part);
  const ids = parts.filter((part) => part.startsWith("#")).map((part) => part.slice(1));
  const classes = parts.filter((part) => part.startsWith(".")).map((part) => part.slice(1));
  const tag = match.tag?.toLowerCase().replace(/^\*$/u, "") || undefined;
  const rule = {
    selector,
    classes,
    specificity: ids.length * 10_000 + classes.length * 100 + (tag === undefined ? 0 : 1),
    order,
    declarations: Object.fromEntries(
      Object.entries(declarations).map(([property, value]) => [
        property,
        { ...value, source: selector },
      ]),
    ),
  };
  return {
    ...rule,
    ...(tag === undefined ? {} : { tag }),
    ...(ids[0] === undefined ? {} : { id: ids[0] }),
  };
}

function matches(rule: Readonly<StyleRule>, element: Readonly<ElementIdentity>): boolean {
  if (rule.tag !== undefined && rule.tag !== element.tag) return false;
  if (rule.id !== undefined && rule.id !== element.id) return false;
  return rule.classes.every((name) => element.classes.includes(name));
}

function reason(property: string, declaration: Readonly<Declaration>): string {
  const via = declaration.source === undefined ? "" : ` via ${declaration.source}`;
  return `${property}: ${declaration.value}${via}`;
}

function keyword(
  declarations: Declarations,
  property: string,
  values: readonly string[],
): string | undefined {
  const declaration = declarations[property];
  if (declaration === undefined || !values.includes(declaration.value.toLowerCase()))
    return undefined;
  return reason(property, declaration);
}

function zero(declarations: Declarations, property: string): string | undefined {
  const declaration = declarations[property];
  if (declaration === undefined || !ZERO_LENGTH.test(declaration.value)) return undefined;
  return reason(property, declaration);
}

function transparentText(declarations: Declarations): string | undefined {
  const declaration = declarations.color;
  if (declaration === undefined || parseColor(declaration.value)?.alpha !== 0) return undefined;
  return reason("color", declaration);
}

function offScreen(declarations: Declarations): string | undefined {
  const indent = farOff(declarations, "text-indent");
  if (indent !== undefined) return indent;
  const position = declarations.position?.value.toLowerCase();
  if (position !== "absolute" && position !== "fixed") return undefined;
  return farOff(declarations, "left") ?? farOff(declarations, "top");
}

function farOff(declarations: Declarations, property: string): string | undefined {
  const declaration = declarations[property];
  const amount = Number(FAR_OFF.exec(declaration?.value ?? "")?.groups?.amount ?? 0);
  return declaration !== undefined && amount >= OFF_SCREEN_PIXELS
    ? reason(property, declaration)
    : undefined;
}

function clipped(declarations: Declarations): string | undefined {
  const clip = declarations.clip ?? declarations["clip-path"];
  if (clip === undefined || !CLIPPED.test(clip.value.trim())) return undefined;
  return reason(declarations.clip === undefined ? "clip-path" : "clip", clip);
}

function squeezed(declarations: Declarations): string | undefined {
  if (declarations.overflow?.value.toLowerCase() !== "hidden") return undefined;
  for (const property of ["height", "width"]) {
    const declaration = declarations[property];
    if (declaration !== undefined && AT_MOST_ONE_PIXEL.test(declaration.value.trim())) {
      return `${reason(property, declaration)}, overflow: hidden`;
    }
  }
  return undefined;
}

function hexColor(hex: string): Color {
  const digits = hex.length <= 4 ? Array.from(hex, (digit) => digit + digit) : hex.match(/../gu)!;
  const [red = 0, green = 0, blue = 0, alpha = 255] = digits.map((pair) =>
    Number.parseInt(pair, 16),
  );
  return { red, green, blue, alpha: alpha / 255 };
}

function rgbColor(body: string): Color | undefined {
  const parts = body.split(/[\s,/]+/u).filter((part) => part.length > 0);
  if (parts.length < 3) return undefined;
  const [red, green, blue] = parts.slice(0, 3).map((part) => channel(part, 255));
  const alpha = parts[3] === undefined ? 1 : channel(parts[3], 1);
  if (red === undefined || green === undefined || blue === undefined || alpha === undefined) {
    return undefined;
  }
  return { red, green, blue, alpha };
}

function channel(part: string, scale: number): number | undefined {
  const percent = part.endsWith("%");
  const number = Number(percent ? part.slice(0, -1) : part);
  if (!Number.isFinite(number)) return undefined;
  const value = percent ? (number / 100) * scale : number;
  return Math.min(scale, Math.max(0, value));
}
