/** One attribute as the page wrote it, its value with character references decoded. */
export interface HtmlAttribute {
  readonly name: string;
  readonly value: string;
}

/** Text between tags, raw: character references stay as written. */
export interface HtmlText {
  readonly kind: "text";
  readonly start: number;
  readonly text: string;
}

/** A comment, a `<?...>` or a `<!...>` other than the doctype: all three stay comments. */
export interface HtmlComment {
  readonly kind: "comment";
  readonly start: number;
  readonly text: string;
}

/** An opening tag with its attributes, the first of each name. */
export interface HtmlStartTag {
  readonly kind: "start";
  readonly start: number;
  readonly name: string;
  readonly attributes: readonly HtmlAttribute[];
  readonly selfClosing: boolean;
}

/** A closing tag. */
export interface HtmlEndTag {
  readonly kind: "end";
  readonly start: number;
  readonly name: string;
}

/** What the tokenizer finds, with `start` as the offset of its first character in the source. */
export type HtmlToken = HtmlText | HtmlComment | HtmlStartTag | HtmlEndTag;

/** Elements whose content is text up to their own end tag, markup included. */
const RAW_TEXT = new Set([
  "iframe",
  "noembed",
  "noframes",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

/** Where a tag name, an attribute name and an unquoted value end, searched from `lastIndex`. */
const ENDS = {
  tagName: /[\t\n\f\r />]/gu,
  attributeName: /[\t\n\f\r /=>]/gu,
  unquotedValue: /[\t\n\f\r >]/gu,
} as const;
const SPACE = /[\t\n\f\r ]/u;
const ASCII_LETTER = /[A-Za-z]/u;
/** Markup that opens like a comment but is a declaration a reveal has no use for. */
const DECLARATIONS: Readonly<Record<string, RegExp>> = {
  "!": /^doctype\b/iu,
  "?": /^xml(?=\s|\?|$)/iu,
};
/** Numeric references need no `;`, as browsers read `key&#8203word`; named ones do. */
const CHARACTER_REFERENCE =
  /&(?:#[Xx]([\dA-Fa-f]+);?|#(\d+);?|([A-Za-z][A-Za-z\d]{1,31});|(amp|lt|gt|quot|nbsp|shy|copy|reg|laquo|raquo|middot|deg|times))/gu;
/** In an attribute, a legacy name followed by a letter, digit or \`=\` stays as written. */
const ATTRIBUTE_REFERENCE =
  /&(?:#[Xx]([\dA-Fa-f]+);?|#(\d+);?|([A-Za-z][A-Za-z\d]{1,31});|(amp|lt|gt|quot|nbsp|shy|copy|reg|laquo|raquo|middot|deg|times)(?![A-Za-z\d=]))/gu;

/** Named references hidden text uses, plus common ones; any other stays as written. */
const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  shy: "\u00AD",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  zwnj: "\u200C",
  zwj: "\u200D",
  lrm: "\u200E",
  rlm: "\u200F",
  ZeroWidthSpace: "\u200B",
  NegativeMediumSpace: "\u{200B}",
  NegativeThinSpace: "\u{200B}",
  NegativeThickSpace: "\u{200B}",
  NegativeVeryThinSpace: "\u{200B}",
  NoBreak: "\u2060",
  ApplyFunction: "\u2061",
  InvisibleTimes: "\u2062",
  InvisibleComma: "\u2063",
  ic: "\u2063",
  it: "\u2062",
  af: "\u2061",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  laquo: "\u00AB",
  raquo: "\u00BB",
  middot: "\u00B7",
  bull: "\u2022",
  copy: "\u00A9",
  reg: "\u00AE",
  trade: "\u2122",
  deg: "\u00B0",
  times: "\u00D7",
  euro: "\u20AC",
};

/**
 * Split HTML into tokens like a browser does; whatever opens no markup is text.
 * @param html - The page source.
 * @yields {HtmlToken} Tokens in source order, a few at a time, never the whole page as a list.
 */
export function* tokenizeHtml(html: string): Generator<HtmlToken> {
  yield* new Tokenizer(html).run();
}

/**
 * Decode character references the way text and attribute values show them.
 * @param text - Text or an attribute value as written.
 * @param attribute - Read it as an attribute value, where a legacy name before a letter stays.
 * @returns {string} The text a reader sees; an unknown or out of range reference stays as written.
 */
export function decodeCharacterReferences(text: string, attribute = false): string {
  if (!text.includes("&")) return text;
  return text.replaceAll(
    attribute ? ATTRIBUTE_REFERENCE : CHARACTER_REFERENCE,
    (
      reference: string,
      hex: string | undefined,
      decimal: string | undefined,
      named: string | undefined,
      legacy: string | undefined,
    ) => {
      const name = named ?? legacy;
      if (name !== undefined) {
        return Object.hasOwn(NAMED_REFERENCES, name) ? NAMED_REFERENCES[name]! : reference;
      }
      const codePoint = Number.parseInt(hex ?? decimal ?? "", hex === undefined ? 10 : 16);
      return isScalarValue(codePoint) ? String.fromCodePoint(codePoint) : reference;
    },
  );
}

/**
 * Offsets where each line of a source starts, for {@link lineAt}.
 * @param source - The page source.
 * @returns {number[]} Ascending offsets, the first one 0.
 */
export function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/**
 * The line an offset falls on.
 * @param starts - Line starts from {@link lineStarts}.
 * @param offset - Offset in the same source.
 * @returns {number} The line number, counted from 1.
 */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/**
 * Find where a name or value ends without copying the rest of a long page per tag.
 * @param source - The page source.
 * @param end - Which end to look for.
 * @param from - Offset to search from.
 * @returns {number} Offset of the first ending character, or the source length.
 */
function endOf(source: string, end: keyof typeof ENDS, from: number): number {
  const pattern = ENDS[end];
  pattern.lastIndex = from;
  return pattern.exec(source)?.index ?? source.length;
}

function isScalarValue(codePoint: number): boolean {
  return codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
}

/** Holds the position while it walks the source once. */
class Tokenizer {
  private readonly html: string;
  private readonly tokens: HtmlToken[] = [];
  private position = 0;
  private textStart = 0;

  constructor(html: string) {
    this.html = html;
  }

  *run(): Generator<HtmlToken> {
    while (this.position < this.html.length) {
      const open = this.html.indexOf("<", this.position);
      if (open === -1) break;
      this.position = open;
      if (!this.markup()) this.position = open + 1;
      yield* this.tokens.splice(0);
    }
    this.flushText(this.html.length);
    yield* this.tokens.splice(0);
  }

  /**
   * Read the markup at `<`, if it opens any.
   * @returns {boolean} False when the `<` is plain text.
   */
  private markup(): boolean {
    const next = this.html[this.position + 1] ?? "";
    if (this.html.startsWith("<!--", this.position)) return this.comment();
    if (next === "!" || next === "?") return this.bogusComment(next);
    if (next === "/") return this.endTag();
    if (ASCII_LETTER.test(next)) return this.startTag();
    return false;
  }

  private comment(): boolean {
    const start = this.position;
    const bodyStart = start + 4;
    const abrupt = /^-?>/u.exec(this.html.slice(bodyStart, bodyStart + 2));
    const close = abrupt ? bodyStart : this.html.indexOf("-->", bodyStart);
    const end = close === -1 ? this.html.length : close;
    const after = abrupt ? bodyStart + abrupt[0].length : Math.min(this.html.length, end + 3);
    this.emit({ kind: "comment", start, text: this.html.slice(bodyStart, end) }, after);
    return true;
  }

  /**
   * Skip the doctype and `<?xml`; browsers keep any other `<!`, `<?` or bare `</` as a comment.
   * @param marker - The character after `<`.
   * @returns {boolean} Always true: each of them opens markup.
   */
  private bogusComment(marker: string): boolean {
    const start = this.position;
    const close = this.html.indexOf(">", start);
    const end = close === -1 ? this.html.length : close;
    const text = this.html.slice(start + 2, end);
    const after = Math.min(this.html.length, end + 1);
    if (DECLARATIONS[marker]?.test(text) === true) this.skip(start, after);
    else this.emit({ kind: "comment", start, text }, after);
    return true;
  }

  private endTag(): boolean {
    const start = this.position;
    const nameStart = start + 2;
    const first = this.html[nameStart] ?? "";
    if (first === ">") return this.skip(start, nameStart + 1);
    if (first === "") return false;
    if (!ASCII_LETTER.test(first)) return this.bogusComment("/");
    const nameEnd = endOf(this.html, "tagName", nameStart);
    const close = this.html.indexOf(">", nameEnd);
    const name = this.html.slice(nameStart, nameEnd).toLowerCase();
    this.emit({ kind: "end", start, name }, close === -1 ? this.html.length : close + 1);
    return true;
  }

  private startTag(): boolean {
    const start = this.position;
    const nameEnd = endOf(this.html, "tagName", start + 1);
    const name = this.html.slice(start + 1, nameEnd).toLowerCase();
    const tag = new AttributeReader(this.html, nameEnd).read();
    if (tag === undefined) return this.skip(start, this.html.length);
    this.emit(
      { kind: "start", start, name, attributes: tag.attributes, selfClosing: tag.selfClosing },
      tag.end,
    );
    if (RAW_TEXT.has(name)) this.rawText(name);
    return true;
  }

  /**
   * Everything up to `</name` is text, the way a browser reads a script or a style.
   * @param name - The raw text element just opened.
   */
  private rawText(name: string): void {
    const pattern = new RegExp(`</${name}[\\t\\n\\f\\r />]`, "giu");
    pattern.lastIndex = this.position;
    const close = pattern.exec(this.html)?.index ?? this.html.length;
    if (close > this.position) {
      this.tokens.push({
        kind: "text",
        start: this.position,
        text: this.html.slice(this.position, close),
      });
    }
    this.position = this.textStart = close;
  }

  /**
   * Drop markup a browser ignores, such as `</>` or the doctype.
   * @param start - Offset of its `<`.
   * @param end - Offset after it.
   * @returns {boolean} Always true.
   */
  private skip(start: number, end: number): boolean {
    this.flushText(start);
    this.position = this.textStart = end;
    return true;
  }

  private emit(token: HtmlToken, end: number): void {
    this.flushText(token.start);
    this.tokens.push(token);
    this.position = this.textStart = end;
  }

  private flushText(end: number): void {
    if (end > this.textStart) {
      this.tokens.push({
        kind: "text",
        start: this.textStart,
        text: this.html.slice(this.textStart, end),
      });
    }
    this.textStart = end;
  }
}

/** Reads the attributes of one start tag, the way the HTML tokenizer's attribute states do. */
class AttributeReader {
  private readonly html: string;
  private readonly attributes: HtmlAttribute[] = [];
  private readonly seen = new Set<string>();
  private position: number;

  constructor(html: string, position: number) {
    this.html = html;
    this.position = position;
  }

  /**
   * @returns {{ attributes: HtmlAttribute[]; selfClosing: boolean; end: number } | undefined} The
   * attributes and the offset after `>`, or undefined when the source ends inside the tag.
   */
  read(): { attributes: HtmlAttribute[]; selfClosing: boolean; end: number } | undefined {
    while (this.position < this.html.length) {
      const character = this.html[this.position]!;
      if (character === ">") {
        const selfClosing = this.html[this.position - 1] === "/";
        return { attributes: this.attributes, selfClosing, end: this.position + 1 };
      }
      if (SPACE.test(character) || character === "/") this.position += 1;
      else this.attribute();
    }
    return undefined;
  }

  private attribute(): void {
    const nameStart = this.position;
    const nameEnd = endOf(this.html, "attributeName", nameStart + 1);
    const name = this.html.slice(nameStart, nameEnd).toLowerCase();
    this.position = this.skipSpace(nameEnd);
    let value = "";
    if (this.html[this.position] === "=") {
      this.position = this.skipSpace(this.position + 1);
      value = this.value();
    }
    if (this.seen.has(name)) return;
    this.seen.add(name);
    this.attributes.push({ name, value: decodeCharacterReferences(value, true) });
  }

  private value(): string {
    const quote = this.html[this.position];
    if (quote === '"' || quote === "'") {
      const close = this.html.indexOf(quote, this.position + 1);
      const end = close === -1 ? this.html.length : close;
      const value = this.html.slice(this.position + 1, end);
      this.position = Math.min(this.html.length, end + 1);
      return value;
    }
    const end = endOf(this.html, "unquotedValue", this.position);
    const value = this.html.slice(this.position, end);
    this.position = end;
    return value;
  }

  private skipSpace(from: number): number {
    let position = from;
    while (SPACE.test(this.html[position] ?? "")) position += 1;
    return position;
  }
}
