import {
  backgroundColor,
  cascade,
  colorText,
  forScreen,
  hidingReason,
  parseColor,
  parseDeclarations,
  parseStylesheet,
  LAYER_DEPTH_LIMIT,
  layerPath,
  ruleKey,
  sameColor,
  stylesheetPreamble,
  type Color,
  type LayerPath,
  type StylesheetImport,
  type StylesheetPreamble,
  type Declarations,
  type StyleRule,
} from "./css.ts";
import {
  decodeCharacterReferences,
  lineAt,
  lineStarts,
  tokenizeHtml,
  type HtmlComment,
  type HtmlEndTag,
  type HtmlStartTag,
  type HtmlText,
} from "./html.ts";
import { hiddenKinds, type HiddenKind } from "./hidden-kinds.ts";
import { clip } from "./text.ts";

export { hiddenKinds, type HiddenKind };

/** One thing a page keeps from its reader, and where in the source it sits. */
export interface HiddenFinding {
  readonly kind: HiddenKind;
  /** Line in the page source, counted from 1. */
  readonly line: number;
  /** The element: its tag, `#id` and up to two classes. */
  readonly element?: string;
  /** Why a reader misses it, such as `display: none` or `type=hidden`. */
  readonly reason?: string;
  /** Attribute, field, meta or link name. */
  readonly name?: string;
  /** Comment or hidden text, attribute or field value, meta content, URL or code excerpt. */
  readonly value?: string;
  /** Characters in the text or code {@link value} was cut from. */
  readonly size?: number;
  /** The invisible characters as `U+XXXX`, in order. */
  readonly codePoints?: readonly string[];
  /** Elements that carry the same attribute with the same value. */
  readonly count?: number;
}

/** A stylesheet as read, and the address after any redirect, which its imports resolve against. */
export interface Stylesheet {
  readonly text: string;
  readonly url: string;
}

/** Options for {@link revealHtml}. */
export interface RevealHtmlOptions {
  /** Address of the page, which relative URLs resolve against. */
  readonly url?: string;
  /** Sheets by the absolute URLs {@link linkedStylesheets} names; a missing one adds no rules. */
  readonly stylesheets?: Readonly<Record<string, string | Stylesheet>>;
}

const HIDDEN_TEXT_LIMIT = 1_000;
const VALUE_LIMIT = 500;
const CODE_EXCERPT_LIMIT = 200;
const CONTEXT_CHARACTERS = 24;
const CODE_POINT_LIMIT = 32;
/** How far down the stack an implied end tag looks; real pages nest a few dozen deep. */
const SCOPE_SCAN_LIMIT = 256;
/** Deepest nesting the walk keeps; past it an element closes where it opens. */
const STACK_LIMIT = 512;
/** Rules kept from a page's stylesheets; Bootstrap files about 370, so past this is no clue. */
const RULE_LIMIT = 2_000;
/** Linked sheets filed per page, each import counted; repeated imports would multiply forever. */
const SHEET_FILINGS_LIMIT = 50;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const SINGLETON_ELEMENTS = new Set(["html", "head", "body"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
/** Hiding properties that inherit, so a descendant can set them back. */
const INHERITED_HIDING = new Set(["visibility", "font-size", "color"]);
/** Values that undo an inherited hiding; `inherit`, `em` and `%` follow the parent. */
const VISIBLE_VALUES: Readonly<Record<string, RegExp>> = {
  visibility: /^visible$/iu,
  "font-size":
    /^(?:(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt|pc|in|cm|mm|q|rem|vw|vh|vmin|vmax)|medium|(?:x{1,3}-)?(?:small|large))$/iu,
};
const FIELD_ELEMENTS = new Set(["input", "select", "textarea", "button"]);
/** Raw text a browser never draws: code, and the fallbacks for frames and plugins. */
const UNDRAWN_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "noembed",
  "noframes",
  "xmp",
  "title",
]);
/** Start tags that close an open `<p>`, the way the HTML tree builder does. */
const CLOSES_PARAGRAPH = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);
const PARAGRAPH_SCOPE = [
  "applet",
  "button",
  "caption",
  "html",
  "marquee",
  "object",
  "table",
  "td",
  "th",
  "template",
];

/** A start tag ends an open element of its group unless the group's holder is nearer. */
interface ImpliedEnd {
  readonly closes: readonly string[];
  readonly scope: readonly string[];
}

const IMPLIED_END: Readonly<Record<string, ImpliedEnd>> = {
  li: { closes: ["li"], scope: ["ul", "ol", "menu"] },
  dt: { closes: ["dt", "dd"], scope: ["dl"] },
  dd: { closes: ["dt", "dd"], scope: ["dl"] },
  option: { closes: ["option"], scope: ["select", "datalist", "optgroup"] },
  tr: { closes: ["tr", "td", "th"], scope: ["table", "tbody", "thead", "tfoot"] },
  td: { closes: ["td", "th"], scope: ["tr", "table"] },
  th: { closes: ["td", "th"], scope: ["tr", "table"] },
};
/** Utility classes that CSS frameworks define as hidden. */
const HIDING_CLASSES = new Set([
  "d-none",
  "hidden",
  "hide",
  "invisible",
  "is-hidden",
  "screen-reader-text",
  "sr-only",
  "visually-hidden",
]);
/** Attributes HTML defines, as one string so a bundle that never reveals drops it. */
const STANDARD_ATTRIBUTE_NAMES =
  "abbr about accept accept-charset accesskey action align alink allow allowfullscreen alt archive as async " +
  "autocapitalize autocomplete autocorrect autofocus autoplay axis background bgcolor blocking border " +
  "cellpadding cellspacing char charoff charset checked cite class classid clear closedby codebase codetype " +
  "color cols colspan command commandfor compact content contenteditable controls controlslist coords " +
  "crossorigin csp data datatype datetime declare decoding default defer dir dirname disabled download " +
  "draggable enctype enterkeyhint exportparts face fetchpriority for form formaction formenctype formmethod " +
  "formnovalidate formtarget frame frameborder headers height hidden high href hreflang hspace http-equiv id " +
  "imagesizes imagesrcset incremental inert inlist inputmode integrity is ismap itemid itemprop itemref " +
  "itemscope itemtype kind label lang language link list loading longdesc loop low manifest marginheight " +
  "marginwidth max maxlength media method min minlength multiple muted name nomodule nonce noresize noshade " +
  "novalidate nowrap open optimum part pattern ping placeholder playsinline popover popovertarget " +
  "popovertargetaction poster prefix preload profile property readonly referrerpolicy rel required resource " +
  "results rev reversed role rows rowspan rules sandbox scheme scope scrolling selected shadowrootclonable " +
  "shadowrootdelegatesfocus shadowrootmode shadowrootserializable shape size sizes slot span spellcheck src " +
  "srcdoc srclang srcset standby start step style summary tabindex target text title translate type typeof " +
  "usemap valign value valuetype version vlink vocab vspace width wrap writingsuggestions xmlns";
let standardAttributes: ReadonlySet<string> | undefined;
/** Event handlers, ARIA and the binding syntax of Vue, Alpine, Angular, htmx and kin. */
const ROUTINE_ATTRIBUTE = /^(?:on|aria-|v-|x-|ng-|hx-|wire:|th:|xml:|xmlns:|xlink:|[:@#[(*])/u;
const SCRIPT_TYPES = new Set(["", "module", "text/javascript", "application/javascript"]);
/** A character with no glyph and no width; combining marks sit outside the class. */
const ONE_INVISIBLE =
  /[\u{AD}\u{61C}\u{115F}\u{1160}\u{17B4}\u{17B5}\u{180E}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{206F}\u{2800}\u{3164}\u{FEFF}\u{FFA0}\u{FFF9}-\u{FFFB}\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}]|\u{34F}|[\u{180B}-\u{180D}]|\u{180F}|[\u{FE00}-\u{FE0D}]|[\u{E0100}-\u{E01EF}]/u;
let invisibleRun: RegExp | undefined;
const JOINERS = /^[\u200C\u200D]+$/u;
const PICTOGRAPH = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]/u;
const NON_LATIN_LETTER = /(?![\p{Script=Latin}\p{Script=Common}])[\p{L}\p{M}]/u;
const READABLE = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u;

/** Text a hidden or camouflaged element holds, gathered until the element closes. */
class HiddenText {
  readonly kind: "hidden" | "camouflage";
  readonly line: number;
  readonly label: string;
  readonly reason: string;
  readonly fallback: string | undefined;
  fields = 0;
  private text = "";
  private length = 0;
  private summaryShown = false;

  constructor(
    kind: "hidden" | "camouflage",
    line: number,
    label: string,
    reason: string,
    fallback?: string,
  ) {
    this.kind = kind;
    this.line = line;
    this.label = label;
    this.reason = reason;
    this.fallback = fallback;
  }

  /**
   * A closed `<details>` shows its first `<summary>` and nothing else.
   * @returns {boolean} True for the first summary asked about, false after.
   */
  showSummary(): boolean {
    if (this.summaryShown) return false;
    this.summaryShown = true;
    return true;
  }

  add(text: string): void {
    const collapsed = text.replaceAll(/\s+/gu, " ");
    if (collapsed.trim() === "") {
      if (this.text !== "" && !this.text.endsWith(" ")) this.text += " ";
      return;
    }
    this.length += collapsed.length;
    if (this.text.length <= HIDDEN_TEXT_LIMIT) this.text += collapsed;
  }

  /**
   * @returns {HiddenFinding | undefined} The finding, or undefined when the element holds
   * nothing a reader could miss.
   */
  finding(): HiddenFinding | undefined {
    const text = marked(this.text.trim());
    const value = text === "" ? this.fallback : clip(text, HIDDEN_TEXT_LIMIT);
    if (value === undefined && (this.kind === "camouflage" || this.fields === 0)) return undefined;
    return {
      kind: this.kind,
      line: this.line,
      element: this.label,
      reason: this.reason,
      ...(value === undefined ? {} : { value }),
      ...(this.length > HIDDEN_TEXT_LIMIT ? { size: this.length } : {}),
    };
  }
}

/** A color an element paints and where it was set. */
interface Paint {
  readonly color: Color;
  readonly source: string;
}

/** An element the walk is inside, with what it inherits. */
interface OpenElement {
  readonly name: string;
  readonly label: string;
  readonly foreign: boolean;
  readonly hidden: HiddenText | undefined;
  readonly color: Paint | undefined;
  readonly background: Paint | undefined;
  readonly camouflage: HiddenText | undefined;
  /** Records this element started, reported when it closes. */
  readonly owned: readonly HiddenText[];
}

/** An inline script, style or textarea, completed by the text token that follows it. */
interface Pending {
  readonly element: string;
  readonly finding: HiddenFinding;
}

/** A linked sheet's imports, resolved, its rules and the layers its body names. */
interface ParsedSheet {
  readonly preamble: StylesheetPreamble;
  readonly rules: readonly StyleRule[];
  readonly layers: readonly LayerPath[];
}

/** A rule filed before the layer ranks are known, with the full name of its layer. */
interface FiledRule {
  readonly rule: StyleRule;
  readonly layer: string | undefined;
}

/** A repeated attribute, listed once with how often it occurs. */
interface AttributeTally {
  readonly finding: HiddenFinding;
  count: number;
}

/** Where a start tag sits and what the walk names it. */
interface Place {
  readonly label: string;
  readonly line: number;
}

/**
 * List what an HTML page keeps from its reader, each finding with its line.
 * @param html - The page source, as the server sent it.
 * @param options - The page address, for relative URLs.
 * @returns {HiddenFinding[]} Findings by kind in {@link hiddenKinds} order, then by line.
 */
export function revealHtml(html: string, options?: Readonly<RevealHtmlOptions>): HiddenFinding[] {
  return new HiddenScanner(html, options?.url, options?.stylesheets).run();
}

/**
 * The stylesheets a page applies on a screen: linked ones and the ones its `<style>` imports.
 * @param html - The page source.
 * @param options - The page address, for relative URLs; sheets already read add their imports.
 * @returns {string[]} Absolute URLs in the order the page applies them, each once.
 */
export function linkedStylesheets(html: string, options?: Readonly<RevealHtmlOptions>): string[] {
  return [...new HiddenScanner(html, options?.url, options?.stylesheets).linked];
}

/**
 * List the invisible characters in a text that is not HTML, such as a plain text or JSON file.
 * @param text - The file content.
 * @returns {HiddenFinding[]} One finding per run of invisible characters.
 */
export function invisibleCharacters(text: string): HiddenFinding[] {
  const starts = lineStarts(text);
  return invisibleRuns(text, true).map(({ index, run }) =>
    invisibleFinding(text, index, run, lineAt(starts, index)),
  );
}

/**
 * Walks the tokens once with the stack of open elements. Implied ends follow HTML for paragraphs,
 * lists, options, tables and headings; the rest of its error recovery is out of scope.
 */
class HiddenScanner {
  private readonly lines: number[];
  private readonly html: string;
  /** Stylesheet rules by {@link ruleKey}, so an element meets only the rules that can match it. */
  private readonly rules = new Map<string, StyleRule[]>();
  private ruleCount = 0;
  private readonly stack: OpenElement[] = [];
  /** Open elements by name, so a tag nothing matches costs nothing however deep the stack. */
  private readonly open = new Map<string, number>();
  private readonly findings: HiddenFinding[] = [];
  private readonly attributes = new Map<string, AttributeTally>();
  private base: string | undefined;
  private baseFromPage = false;
  private assumeDefaults = true;
  private pending: Pending | undefined;
  private readonly sheets: Readonly<Record<string, string | Stylesheet>>;
  /** Each linked sheet parsed once, however often it gets imported. */
  private readonly parsed = new Map<string, ParsedSheet>();
  private filings = 0;
  private preferredTitle: string | undefined;
  /** Layers by full name, each part quoted so `a\.b` stays one, with its nested ones in order. */
  private readonly layers = new Map<string, string[]>([["", []]]);
  /** How deep each layer sits, so imports can't nest past {@link LAYER_DEPTH_LIMIT} either. */
  private readonly depths = new Map<string, number>([["", 0]]);
  /** Anonymous layers so far, which keeps each one apart. */
  private anonymousLayers = 0;
  /** Rules in filing order, ranked once every layer is known. */
  private readonly filed: FiledRule[] = [];
  /** Every stylesheet the page applies, read or not, by absolute URL. */
  readonly linked = new Set<string>();

  constructor(
    html: string,
    url: string | undefined,
    sheets: Readonly<Record<string, string | Stylesheet>> = {},
  ) {
    this.lines = lineStarts(html);
    this.html = html;
    this.base = url;
    this.sheets = sheets;
    this.prepare();
  }

  run(): HiddenFinding[] {
    for (const token of tokenizeHtml(this.html)) {
      if (token.kind === "start") this.start(token);
      else if (token.kind === "end") this.end(token);
      else if (token.kind === "text") this.text(token);
      else this.comment(token);
    }
    while (this.stack.length > 0) this.pop();
    const tallies = [...this.attributes.values()].map(({ finding, count }) =>
      count > 1 ? { ...finding, count } : finding,
    );
    return [...this.findings, ...tallies].toSorted(
      (left, right) =>
        hiddenKinds.indexOf(left.kind) - hiddenKinds.indexOf(right.kind) || left.line - right.line,
    );
  }

  /** Stylesheet rules, the `<base>` URL and whether a stylesheet is linked, before the walk. */
  private prepare(): void {
    let inStyle = false;
    for (const token of tokenizeHtml(this.html)) {
      if (token.kind === "text" && inStyle) {
        this.fileSheet(token.text);
        if (/@import\b/iu.test(token.text)) this.assumeDefaults = false;
      }
      inStyle = token.kind === "start" && token.name === "style" && this.styleApplies(token);
      if (token.kind === "start") this.prepareTag(token);
    }
    this.rankRules();
  }

  /**
   * File an inline sheet's imports, then its own rules, the order a browser cascades them in.
   * @param css - The content of a `<style>`.
   */
  private fileSheet(css: string): void {
    this.fileParsed(parseSheet(css, this.base), [], undefined);
  }

  /**
   * File a linked sheet the same way, when it was read.
   * @param url - Its absolute URL.
   * @param chain - Sheets importing this one, so an import cycle ends.
   * @param layer - The cascade layer an import put it in, if any.
   */
  private fileLinked(url: string, chain: readonly string[], layer: string | undefined): void {
    this.linked.add(url);
    const sheet = this.parsedSheet(url);
    if (sheet === undefined || chain.includes(url) || this.filings >= SHEET_FILINGS_LIMIT) return;
    this.filings += 1;
    this.fileParsed(sheet, [...chain, url], layer);
  }

  /**
   * File imports before rules, the sheet's layers nested in the one it sits in, if any.
   * @param sheet - The parsed sheet.
   * @param chain - Sheets importing this one.
   * @param layer - The layer an import put it in.
   */
  private fileParsed(
    sheet: Readonly<ParsedSheet>,
    chain: readonly string[],
    layer: string | undefined,
  ): void {
    const scope = this.anonymousLayers++;
    const own = (path: LayerPath): string | undefined =>
      this.declareLayer(
        layer,
        path.map((part) => (part.startsWith("\u0000") ? `\u0000${scope}:${part.slice(1)}` : part)),
      );
    for (const entry of sheet.preamble) {
      if ("layers" in entry) for (const path of entry.layers) own(path);
      else this.fileImport(entry, chain, layer);
    }
    for (const path of sheet.layers) own(path);
    for (const rule of sheet.rules.slice(0, RULE_LIMIT - this.ruleCount)) {
      const placed = { ...rule, order: rule.order + this.ruleCount };
      this.filed.push({ rule: placed, layer: rule.layerPath ? own(rule.layerPath) : layer });
    }
    this.ruleCount = Math.min(RULE_LIMIT, this.ruleCount + sheet.rules.length);
  }

  /**
   * Declare an import's layer as the walk meets it, the order a browser declares layers in, then
   * file the sheet into it, nested in the layer of the sheet that imports it.
   * @param entry - The import.
   * @param chain - Sheets importing the one that holds it.
   * @param layer - The layer that sheet sits in, if any.
   */
  private fileImport(
    entry: Readonly<StylesheetImport>,
    chain: readonly string[],
    layer: string | undefined,
  ): void {
    const anonymous = [`\u0000${this.anonymousLayers++}`];
    let own: LayerPath = [];
    if (entry.layer === "") own = anonymous;
    else if (entry.layer !== undefined) own = layerPath(entry.layer);
    this.fileLinked(entry.url, chain, this.declareLayer(layer, own));
  }

  /**
   * Declare a layer nested in another, each part the first time it comes up.
   * @param outer - The full name of the layer it sits in, if any.
   * @param path - Its name's parts, folded past {@link LAYER_DEPTH_LIMIT}.
   * @returns {string | undefined} Its full name, or undefined outside any layer.
   */
  private declareLayer(outer: string | undefined, path: LayerPath): string | undefined {
    let name = outer ?? "";
    let depth = this.depths.get(name) ?? 0;
    for (const part of path.slice(0, Math.max(0, LAYER_DEPTH_LIMIT - depth))) {
      const full = `${name}/${JSON.stringify(part)}`;
      depth += 1;
      if (!this.layers.has(full)) {
        this.layers.get(name)?.push(full);
        this.layers.set(full, []);
        this.depths.set(full, depth);
      }
      name = full;
    }
    return name === "" ? undefined : name;
  }

  /**
   * Rank every layer, nested ones below the rules of the layer around them, as a browser does,
   * then file the rules by {@link ruleKey}.
   */
  private rankRules(): void {
    const ranks = new Map<string, number>();
    const stack = [{ name: "", next: 0 }];
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const child = this.layers.get(top.name)?.[top.next];
      top.next += 1;
      if (child === undefined) {
        stack.pop();
        ranks.set(top.name, ranks.size);
      } else {
        stack.push({ name: child, next: 0 });
      }
    }
    for (const { rule, layer } of this.filed) {
      const ranked = layer === undefined ? rule : { ...rule, layer: ranks.get(layer) };
      const key = ruleKey(ranked);
      this.rules.set(key, [...(this.rules.get(key) ?? []), ranked]);
    }
  }

  private parsedSheet(url: string): ParsedSheet | undefined {
    const known = this.parsed.get(url);
    if (known !== undefined) return known;
    const source = Object.hasOwn(this.sheets, url) ? this.sheets[url] : undefined;
    if (source === undefined) return undefined;
    const { text, url: base } = typeof source === "string" ? { text: source, url } : source;
    const sheet = parseSheet(text, base);
    this.parsed.set(url, sheet);
    return sheet;
  }

  private prepareTag(tag: HtmlStartTag): void {
    if (tag.name === "link") this.prepareLink(tag);
    const href = attribute(tag, "href");
    if (tag.name !== "base" || href === undefined || this.baseFromPage) return;
    this.base = resolve(href, this.base);
    this.baseFromPage = true;
  }

  /**
   * A screen stylesheet drops the default colors; an alternate one or one of another titled set
   * waits for the reader's pick, and a disabled one or one typed as `text/less` applies nothing.
   * @param tag - The `<link>` start tag.
   */
  private prepareLink(tag: HtmlStartTag): void {
    const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/u) ?? [];
    if (!rel.includes("stylesheet") || !linkApplies(tag)) return;
    this.assumeDefaults = false;
    const href = attribute(tag, "href");
    const applied = !rel.includes("alternate") && this.inPreferredSet(attribute(tag, "title"));
    if (href !== undefined && applied) this.fileLinked(resolve(href, this.base), [], undefined);
  }

  private styleApplies(tag: HtmlStartTag): boolean {
    return forScreen(attribute(tag, "media")) && this.inPreferredSet(attribute(tag, "title"));
  }

  /**
   * Whether a sheet's title keeps it on: an untitled sheet always is, and the first title picks
   * the set, the way CSSOM chooses the preferred style sheet set.
   * @param title - Its `title` attribute.
   * @returns {boolean} True when a browser applies it without the reader picking another set.
   */
  private inPreferredSet(title: string | undefined): boolean {
    const name = title ?? "";
    if (name === "") return true;
    this.preferredTitle ??= name;
    return this.preferredTitle === name;
  }

  private start(tag: HtmlStartTag): void {
    this.closeImplied(tag.name);
    if (SINGLETON_ELEMENTS.has(tag.name) && this.isOpen(tag.name)) return;
    const place = { label: labelOf(tag), line: this.lineOf(tag.start) };
    const foreign = this.foreignAt(tag.name);
    if (!foreign) this.tallyAttributes(tag, place);
    for (const { value } of tag.attributes) this.characters(value, place.line, place.label);
    this.headFinding(tag, place);
    const element = this.element(tag, place, foreign);
    this.stack.push(element);
    this.open.set(element.name, (this.open.get(element.name) ?? 0) + 1);
    if (FIELD_ELEMENTS.has(tag.name)) this.field(tag, place);
    if (closesAtOnce(tag, foreign) || this.stack.length > STACK_LIMIT) this.pop();
  }

  /**
   * SVG and MathML follow XML rules: no HTML attributes to judge, and `/>` closes an element.
   * CDATA sections and `foreignObject` going back to HTML are not modeled.
   * @param name - The tag about to open.
   * @returns {boolean} Whether it opens inside, or as, foreign content.
   */
  private foreignAt(name: string): boolean {
    return this.stack.at(-1)?.foreign === true || name === "svg" || name === "math";
  }

  private isOpen(name: string): boolean {
    return (this.open.get(name) ?? 0) > 0;
  }

  private element(tag: HtmlStartTag, place: Place, foreign: boolean): OpenElement {
    const declarations = this.declarationsOf(tag);
    const hidden = this.hiddenAt(tag, place, declarations);
    const { color, background } = this.paintsOf(tag, place, declarations);
    const camouflage =
      hidden === undefined ? this.camouflageAt(place, color, background) : undefined;
    const parent = this.stack.at(-1);
    const owned = [hidden, camouflage].filter(
      (record): record is HiddenText =>
        record !== undefined && record !== parent?.hidden && record !== parent?.camouflage,
    );
    return {
      name: tag.name,
      label: place.label,
      foreign,
      hidden,
      color,
      background,
      camouflage,
      owned,
    };
  }

  private hiddenAt(
    tag: HtmlStartTag,
    place: Place,
    declarations: Declarations,
  ): HiddenText | undefined {
    const inherited = this.stack.at(-1)?.hidden;
    if (inherited !== undefined && !this.shows(tag.name, declarations)) return inherited;
    const reason = hiddenBy(tag, declarations);
    if (reason === undefined) return undefined;
    return new HiddenText("hidden", place.line, place.label, reason, fallbackOf(tag));
  }

  /**
   * Whether an element inside a hidden one shows anyway: the first summary of a closed
   * `<details>`, or a descendant that overrides an inherited `visibility`, size or color.
   * @param name - The tag about to open.
   * @param declarations - Its own winning declarations.
   * @returns {boolean} True when the element and its content are in sight.
   */
  private shows(name: string, declarations: Declarations): boolean {
    const parent = this.stack.at(-1);
    const record = parent?.hidden;
    if (parent === undefined || record === undefined) return false;
    const opener = parent.name === "details" && parent.owned.includes(record);
    if (opener && name === "summary" && record.reason === "closed details") {
      return record.showSummary();
    }
    return overridesHiding(record.reason, declarations);
  }

  private paintsOf(
    tag: HtmlStartTag,
    place: Place,
    declarations: Declarations,
  ): { color: Paint | undefined; background: Paint | undefined } {
    const parent = this.stack.at(-1);
    const color = ownColor(tag, declarations, place.label) ?? parent?.color;
    const background = ownBackground(tag, declarations, place.label) ?? parent?.background;
    return {
      color: color ?? this.defaultPaint("text"),
      background: background ?? this.defaultPaint("page"),
    };
  }

  private camouflageAt(
    place: Place,
    color: Paint | undefined,
    background: Paint | undefined,
  ): HiddenText | undefined {
    if (color === undefined || background === undefined || color.color.alpha === 0)
      return undefined;
    if (!sameColor(color.color, background.color)) return undefined;
    const parent = this.stack.at(-1);
    if (parent?.color === color && parent.background === background) return parent.camouflage;
    const reason = `${colorText(color.color)} text from ${color.source} on ${colorText(background.color)} from ${background.source}`;
    return new HiddenText("camouflage", place.line, place.label, reason);
  }

  /**
   * With no stylesheet linked or imported, a browser draws black text on a white page.
   * @param role - Which default to take.
   * @returns {Paint | undefined} The default, or undefined when a stylesheet could change it.
   */
  private defaultPaint(role: "text" | "page"): Paint | undefined {
    if (!this.assumeDefaults) return undefined;
    const channel = role === "text" ? 0 : 255;
    const color = { red: channel, green: channel, blue: channel, alpha: 1 };
    return { color, source: role === "text" ? "the default text color" : "the default white page" };
  }

  private declarationsOf(tag: HtmlStartTag): Declarations {
    const id = attribute(tag, "id");
    const inline = parseDeclarations(attribute(tag, "style") ?? "");
    const identity = {
      tag: tag.name,
      classes: classesOf(tag),
      ...(id === undefined ? {} : { id }),
    };
    return cascade((key) => this.rules.get(key) ?? [], identity, inline);
  }

  private end(tag: HtmlEndTag): void {
    if (!this.isOpen(tag.name)) return;
    const index = this.stack.findLastIndex(({ name }) => name === tag.name);
    if (index === -1) return;
    while (this.stack.length > index) this.pop();
  }

  private pop(): void {
    const element = this.stack.pop();
    if (element === undefined) return;
    this.open.set(element.name, (this.open.get(element.name) ?? 1) - 1);
    if (this.pending?.element === element.name) this.settlePending("");
    for (const record of element.owned) {
      const finding = record.finding();
      if (finding !== undefined) this.findings.push(finding);
    }
  }

  private closeImplied(name: string): void {
    const rule = Object.hasOwn(IMPLIED_END, name) ? IMPLIED_END[name] : undefined;
    if (rule !== undefined) this.closeWithin(rule.closes, rule.scope);
    if (CLOSES_PARAGRAPH.has(name)) this.closeWithin(["p"], PARAGRAPH_SCOPE);
    if (HEADINGS.has(name) && HEADINGS.has(this.stack.at(-1)?.name ?? "")) this.pop();
  }

  /**
   * Close the nearest open element named in `closes`, unless a `scope` element sits above it.
   * @param closes - Elements the start tag ends.
   * @param scope - Elements that keep them open.
   */
  private closeWithin(closes: readonly string[], scope: readonly string[]): void {
    if (!closes.some((name) => this.isOpen(name))) return;
    const bottom = Math.max(0, this.stack.length - SCOPE_SCAN_LIMIT);
    for (let index = this.stack.length - 1; index >= bottom; index -= 1) {
      const name = this.stack[index]!.name;
      if (closes.includes(name)) {
        while (this.stack.length > index) this.pop();
        return;
      }
      if (scope.includes(name)) return;
    }
  }

  private text(token: HtmlText): void {
    const line = this.lineOf(token.start);
    if (this.rawText(token.text, line)) return;
    const top = this.stack.at(-1);
    const text = decodeCharacterReferences(token.text);
    this.characters(text, line, top?.label, token.start === 0);
    (top?.hidden ?? top?.camouflage)?.add(text);
  }

  /**
   * Text a browser never draws as page text, such as a script or a title.
   * @param text - The raw text.
   * @param line - Its line.
   * @returns {boolean} Whether the text was taken here.
   */
  private rawText(text: string, line: number): boolean {
    const top = this.stack.at(-1);
    if (top === undefined) return false;
    const pending = this.pending?.element === top.name;
    if (!pending && !UNDRAWN_ELEMENTS.has(top.name)) return false;
    this.characters(text, line, top.label);
    if (pending)
      this.settlePending(top.name === "textarea" ? decodeCharacterReferences(text) : text);
    return true;
  }

  private comment(token: HtmlComment): void {
    const line = this.lineOf(token.start);
    const element = this.stack.at(-1)?.label ?? "document";
    this.findings.push({ kind: "comment", line, element, value: marked(token.text.trim()) });
    this.characters(token.text, line, element);
  }

  private settlePending(text: string): void {
    const pending = this.pending;
    if (pending === undefined) return;
    this.pending = undefined;
    const { finding } = pending;
    if (finding.kind === "field") {
      this.findings.push(text === "" ? finding : { ...finding, value: valueOf(text) });
      return;
    }
    const code = text.trim();
    if (code === "") return;
    const excerpt = marked(code.replaceAll(/\s+/gu, " "));
    this.findings.push({ ...finding, value: clip(excerpt, CODE_EXCERPT_LIMIT), size: code.length });
  }

  private tallyAttributes(tag: HtmlStartTag, place: Place): void {
    for (const { name, value } of tag.attributes) {
      const reason = notableAttribute(name);
      if (reason === undefined) continue;
      const key = `${name}\u0000${value}`;
      const tally = this.attributes.get(key);
      if (tally === undefined) {
        this.attributes.set(key, {
          finding: attributeFinding(place, name, value, reason),
          count: 1,
        });
      } else {
        tally.count += 1;
      }
    }
  }

  private headFinding(tag: HtmlStartTag, place: Place): void {
    let finding: HiddenFinding | undefined;
    if (tag.name === "meta") finding = metaFinding(tag, place.line);
    else if (tag.name === "link" || tag.name === "base")
      finding = linkFinding(tag, place.line, this.base);
    else if (tag.name === "script" || tag.name === "style") finding = this.codeFinding(tag, place);
    if (finding !== undefined) this.findings.push(finding);
  }

  private codeFinding(tag: HtmlStartTag, place: Place): HiddenFinding | undefined {
    const kind = tag.name === "script" ? "script" : "style";
    const type = attribute(tag, "type")?.trim().toLowerCase() ?? "";
    const typed = kind === "script" && !SCRIPT_TYPES.has(type);
    const finding: HiddenFinding = {
      kind,
      line: place.line,
      element: place.label,
      ...(typed ? { reason: `type=${type}` } : {}),
    };
    const src = kind === "script" ? attribute(tag, "src") : undefined;
    if (src !== undefined) return { ...finding, value: valueOf(resolve(src, this.base)) };
    this.pending = { element: tag.name, finding };
    return undefined;
  }

  /**
   * A form field in a hidden element, or one of `type=hidden` anywhere.
   * @param tag - The field's start tag.
   * @param place - Its label and line.
   */
  private field(tag: HtmlStartTag, place: Place): void {
    const hidden = this.stack.at(-1)?.hidden;
    const type = fieldType(tag);
    if (hidden === undefined && type !== "hidden") return;
    if (hidden !== undefined) hidden.fields += 1;
    const holder =
      hidden === undefined ? undefined : `inside hidden ${hidden.label} at line ${hidden.line}`;
    const finding = fieldFinding(tag, place, [type, holder]);
    if (tag.name === "textarea") this.pending = { element: "textarea", finding };
    else this.findings.push(finding);
  }

  private characters(
    text: string,
    line: number,
    element: string | undefined,
    documentStart = false,
  ): void {
    for (const { index, run } of invisibleRuns(text, documentStart)) {
      const finding = invisibleFinding(
        text,
        index,
        run,
        line + countNewlines(text.slice(0, index)),
      );
      this.findings.push(element === undefined ? finding : { ...finding, element });
    }
  }

  private lineOf(offset: number): number {
    return lineAt(this.lines, offset);
  }
}

/**
 * An element that holds no content: a void HTML element, or SVG and MathML closed with `/>`.
 * @param tag - The start tag.
 * @param foreign - Whether it sits in foreign content.
 * @returns {boolean} Whether it closes where it opens.
 */
function closesAtOnce(tag: HtmlStartTag, foreign: boolean): boolean {
  return VOID_ELEMENTS.has(tag.name) || (foreign && tag.selfClosing);
}

/**
 * Why an element and everything in it stays out of sight.
 * @param tag - The start tag.
 * @param declarations - Its winning declarations.
 * @returns {string | undefined} The reason, or undefined when it shows.
 */
function hiddenBy(tag: HtmlStartTag, declarations: Declarations): string | undefined {
  const structural = structuralReason(tag, declarations);
  if (structural !== undefined) return structural;
  if (fieldType(tag) === "hidden") return undefined;
  if (declarations.display !== undefined) return hidingReason(declarations);
  const hiding = hidingReason(declarations);
  if (hiding !== undefined) return hiding;
  const utility = classesOf(tag).find((name) => HIDING_CLASSES.has(name.toLowerCase()));
  return utility === undefined ? undefined : `class ${utility}, a framework's hidden class`;
}

/**
 * Whether an element's own declarations undo a hiding it inherits; `display: none` and the
 * rest hide the whole subtree, but `visibility`, `font-size` and `color` inherit and give way.
 * @param reason - The inherited reason, starting with its property.
 * @param declarations - The element's own winning declarations.
 * @returns {boolean} True when the element shows again.
 */
function overridesHiding(reason: string, declarations: Declarations): boolean {
  const property = reason.slice(0, reason.indexOf(":"));
  const own = declarations[property];
  if (own === undefined || !INHERITED_HIDING.has(property)) return false;
  if (property === "color") return (parseColor(own.value)?.alpha ?? 0) > 0;
  const visible = Object.hasOwn(VISIBLE_VALUES, property) ? VISIBLE_VALUES[property] : undefined;
  return (
    visible?.test(own.value.trim()) === true && hidingReason({ [property]: own }) === undefined
  );
}

/**
 * Hiding HTML does itself; the `hidden` attribute loses to a declared `display`.
 * @param tag - The start tag.
 * @param declarations - Its winning declarations.
 * @returns {string | undefined} The reason, or undefined.
 */
function structuralReason(tag: HtmlStartTag, declarations: Declarations): string | undefined {
  if (tag.name === "template") return "template content";
  if (attribute(tag, "popover") !== undefined) return "popover";
  const opens = tag.name === "dialog" || tag.name === "details";
  if (opens && attribute(tag, "open") === undefined) return `closed ${tag.name}`;
  const hidden = attribute(tag, "hidden") !== undefined && declarations.display === undefined;
  return hidden ? "hidden attribute" : undefined;
}

/**
 * Whether a browser would apply a linked sheet on a screen: not disabled, typed as CSS if at all.
 * @param tag - The `<link>` start tag.
 * @returns {boolean} True when the link counts.
 */
function linkApplies(tag: HtmlStartTag): boolean {
  const type = attribute(tag, "type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const css = type === "" || type === "text/css";
  return css && attribute(tag, "disabled") === undefined && forScreen(attribute(tag, "media"));
}

function fieldType(tag: HtmlStartTag): string {
  const type = attribute(tag, "type")?.trim().toLowerCase();
  if (type !== undefined && type !== "") return type;
  return tag.name === "input" ? "text" : "";
}

/**
 * @param tag - The field's start tag.
 * @param place - Its label and line.
 * @param reasons - Its type and the hidden element holding it, when there is one.
 * @returns {HiddenFinding} The field with its name and value.
 */
function fieldFinding(
  tag: HtmlStartTag,
  place: Place,
  reasons: readonly (string | undefined)[],
): HiddenFinding {
  const name = attribute(tag, "name");
  const value = attribute(tag, "value");
  const reason = reasons
    .filter((part): part is string => part !== undefined && part !== "")
    .map((part, index) => (index === 0 && !part.startsWith("inside") ? `type=${part}` : part))
    .join(", ");
  return {
    kind: "field",
    line: place.line,
    element: place.label,
    reason,
    ...(name === undefined ? {} : { name }),
    ...(value === undefined || value === "" ? {} : { value: valueOf(value) }),
  };
}

function attributeFinding(
  place: Place,
  name: string,
  value: string,
  reason: string,
): HiddenFinding {
  return {
    kind: "attribute",
    line: place.line,
    element: place.label,
    name,
    ...(reason === "" ? {} : { reason }),
    ...(value === "" ? {} : { value: valueOf(value), ...sizeOf(value) }),
  };
}

function ownColor(tag: HtmlStartTag, declarations: Declarations, label: string): Paint | undefined {
  const declared = declarations.color;
  const value = declared?.value ?? colorAttribute(tag);
  const color = value === undefined ? undefined : parseColor(value);
  if (color === undefined) return undefined;
  return { color, source: declared?.source ?? label };
}

function colorAttribute(tag: HtmlStartTag): string | undefined {
  if (tag.name === "font") return attribute(tag, "color");
  return tag.name === "body" ? attribute(tag, "text") : undefined;
}

function ownBackground(
  tag: HtmlStartTag,
  declarations: Declarations,
  label: string,
): Paint | undefined {
  const declared = backgroundColor(declarations);
  const source = declarations["background-color"]?.source;
  if (declared !== undefined) return { color: declared, source: source ?? label };
  const bgcolor = attribute(tag, "bgcolor");
  const color = bgcolor === undefined ? undefined : parseColor(bgcolor);
  return color === undefined || color.alpha === 0 ? undefined : { color, source: label };
}

function metaFinding(tag: HtmlStartTag, line: number): HiddenFinding | undefined {
  const charset = attribute(tag, "charset");
  if (charset !== undefined)
    return { kind: "meta", line, name: "charset", value: valueOf(charset) };
  const name =
    attribute(tag, "name") ??
    attribute(tag, "property") ??
    attribute(tag, "http-equiv") ??
    attribute(tag, "itemprop");
  const content = attribute(tag, "content");
  if (name === undefined && content === undefined) return undefined;
  return {
    kind: "meta",
    line,
    ...(name === undefined ? {} : { name }),
    ...(content === undefined ? {} : { value: valueOf(content), ...sizeOf(content) }),
  };
}

function linkFinding(
  tag: HtmlStartTag,
  line: number,
  base: string | undefined,
): HiddenFinding | undefined {
  const href = attribute(tag, "href");
  if (href === undefined) return undefined;
  const rel = tag.name === "base" ? "base" : (attribute(tag, "rel")?.trim().toLowerCase() ?? "");
  return {
    kind: rel.split(/\s+/u).includes("stylesheet") ? "style" : "link",
    line,
    ...(rel === "" ? {} : { name: rel }),
    value: valueOf(resolve(href, base)),
  };
}

/**
 * Why an attribute is worth listing.
 * @param name - The attribute name, lowercase.
 * @returns {string | undefined} An empty string for `data-*`, a reason for a nonstandard one,
 * or undefined for one a page uses openly.
 */
function notableAttribute(name: string): string | undefined {
  if (name.startsWith("data-")) return "";
  standardAttributes ??= new Set(STANDARD_ATTRIBUTE_NAMES.split(" "));
  if (standardAttributes.has(name) || ROUTINE_ATTRIBUTE.test(name)) return undefined;
  return "nonstandard";
}

/**
 * What a hidden element without text still shows a reader of its source.
 * @param tag - The start tag.
 * @returns {string | undefined} Its source, link, alternative text or value.
 */
function fallbackOf(tag: HtmlStartTag): string | undefined {
  const value =
    attribute(tag, "src") ??
    attribute(tag, "href") ??
    attribute(tag, "alt") ??
    attribute(tag, "value");
  return value === undefined || value === "" ? undefined : valueOf(value);
}

function attribute(tag: HtmlStartTag, name: string): string | undefined {
  return tag.attributes.find((candidate) => candidate.name === name)?.value;
}

function classesOf(tag: HtmlStartTag): string[] {
  return (attribute(tag, "class") ?? "").split(/\s+/u).filter((name) => name !== "");
}

/**
 * Name an element the way a selector would: tag, id and up to two classes.
 * @param tag - The start tag.
 * @returns {string} Such as `div#login.box.dark`.
 */
function labelOf(tag: HtmlStartTag): string {
  const id = attribute(tag, "id")?.trim() ?? "";
  const classes = classesOf(tag).slice(0, 2);
  const label = `${tag.name}${id === "" ? "" : `#${id}`}${classes.map((name) => `.${name}`).join("")}`;
  return clip(marked(label), 80);
}

/**
 * A sheet's imports resolved against its address, its layer names and its rules.
 * @param css - The sheet.
 * @param base - What its imports resolve against.
 * @returns {ParsedSheet} The parsed sheet.
 */
function parseSheet(css: string, base: string | undefined): ParsedSheet {
  const preamble = stylesheetPreamble(css).map((entry) =>
    "url" in entry ? { ...entry, url: resolve(entry.url, base) } : entry,
  );
  return { preamble, ...parseStylesheet(css) };
}

function resolve(url: string, base: string | undefined): string {
  try {
    return new URL(url.trim(), base).href;
  } catch {
    return url;
  }
}

function valueOf(text: string): string {
  return clip(marked(text), VALUE_LIMIT);
}

function sizeOf(text: string): { size?: number } {
  return text.length > VALUE_LIMIT ? { size: text.length } : {};
}

/**
 * Write each invisible character as `⟨U+XXXX⟩`, so a terminal or a model sees it.
 * @param text - Text from the page.
 * @returns {string} The same text with every invisible character spelled out.
 */
function marked(text: string): string {
  if (!ONE_INVISIBLE.test(text)) return text;
  return text.replaceAll(invisiblePattern(), (run) =>
    Array.from(run, (character) => `⟨${codePoint(character)}⟩`).join(""),
  );
}

function codePoint(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    count += 1;
  }
  return count;
}

/**
 * A run of {@link ONE_INVISIBLE} characters, built on first use so an unused import costs nothing.
 * @returns {RegExp} The global pattern; `matchAll` and `replaceAll` copy or reset its position.
 */
function invisiblePattern(): RegExp {
  invisibleRun ??= new RegExp(`(?:${ONE_INVISIBLE.source})+`, "gu");
  return invisibleRun;
}

/**
 * Runs of invisible characters, minus an opening byte order mark and joiners text needs.
 * @param text - Text to scan.
 * @param documentStart - Whether the text opens the source, where a byte order mark belongs.
 * @returns {{ index: number; run: string }[]} Each run with its offset.
 */
function invisibleRuns(text: string, documentStart: boolean): { index: number; run: string }[] {
  if (!ONE_INVISIBLE.test(text)) return [];
  const runs: { index: number; run: string }[] = [];
  for (const match of text.matchAll(invisiblePattern())) {
    const run = match[0] === "\uFEFF" && match.index === 0 && documentStart ? "" : match[0];
    if (run !== "" && !joinsText(text, match.index, run)) runs.push({ index: match.index, run });
  }
  return runs;
}

function joinsText(text: string, index: number, run: string): boolean {
  if (!JOINERS.test(run)) return false;
  const before = Array.from(text.slice(Math.max(0, index - 2), index)).at(-1) ?? "";
  const after = Array.from(text.slice(index + run.length, index + run.length + 2))[0] ?? "";
  const emoji = PICTOGRAPH.test(before) && PICTOGRAPH.test(after);
  return emoji || (NON_LATIN_LETTER.test(before) && NON_LATIN_LETTER.test(after));
}

function invisibleFinding(text: string, index: number, run: string, line: number): HiddenFinding {
  const characters = Array.from(run);
  const before = text.slice(Math.max(0, index - CONTEXT_CHARACTERS), index);
  const after = text.slice(index + run.length, index + run.length + CONTEXT_CHARACTERS);
  const context = marked(`${before}${run}${after}`.replaceAll(/\s+/gu, " "));
  const spelled = smuggled(characters);
  return {
    kind: "invisible",
    line,
    ...(spelled === undefined ? {} : { reason: spelled }),
    value: context,
    codePoints: characters.slice(0, CODE_POINT_LIMIT).map(codePoint),
    ...(characters.length > CODE_POINT_LIMIT ? { size: characters.length } : {}),
  };
}

/**
 * Read text smuggled in tag characters or in variation selectors carrying bytes.
 * @param characters - One run.
 * @returns {string | undefined} What it spells, or undefined when it spells nothing readable.
 */
function smuggled(characters: readonly string[]): string | undefined {
  if (characters.length < 2) return undefined;
  const points = characters.map((character) => character.codePointAt(0) ?? 0);
  if (points.every((point) => point >= 0xe0020 && point <= 0xe007e)) {
    return `tag characters spell "${String.fromCodePoint(...points.map((point) => point - 0xe0000))}"`;
  }
  const bytes: number[] = [];
  for (const point of points) {
    const byte = selectorByte(point);
    if (byte === undefined) return undefined;
    bytes.push(byte);
  }
  const decoded = utf8(bytes);
  return decoded !== undefined && READABLE.test(decoded)
    ? `variation selectors carry "${clip(decoded, VALUE_LIMIT)}"`
    : undefined;
}

function selectorByte(point: number): number | undefined {
  if (point >= 0xfe00 && point <= 0xfe0f) return point - 0xfe00;
  if (point >= 0xe0100 && point <= 0xe01ef) return point - 0xe0100 + 16;
  return undefined;
}

function utf8(bytes: readonly number[]): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return undefined;
  }
}
