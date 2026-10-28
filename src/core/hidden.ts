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
  layerPaths,
  ruleKey,
  sameColor,
  stylesheetPreamble,
  trimmed,
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
  type HtmlTree,
  type HtmlComment,
  type HtmlEndTag,
  type HtmlStartTag,
  type HtmlText,
  type HtmlToken,
  writtenOffsets,
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
/** Linked sheets filed per tree, each import counted; repeated imports would multiply forever. */
const SHEET_FILINGS_LIMIT = 50;
/** Rules kept across every shadow root, so a page of components can't take a budget each. */
const SHADOW_RULE_LIMIT = 50 * RULE_LIMIT;

/** SVG elements whose children are HTML again. The tokenizer lowercases `foreignObject`. */
const SVG_HTML_POINTS = new Set(["foreignobject", "desc", "title"]);
/** MathML text elements, whose children are HTML but for {@link MATH_GLYPHS}. */
const MATH_TEXT_POINTS = new Set(["mi", "mo", "mn", "ms", "mtext"]);
const MATH_GLYPHS = new Set(["mglyph", "malignmark"]);
/** The `encoding` values that make an `annotation-xml` hold HTML. */
const ANNOTATION_HTML = new Set(["text/html", "application/xhtml+xml"]);
/** What a tag like `<p>` closes before it opens: SVG and MathML that hold no HTML. */
const FOREIGN_CONTENT = new Set<Content>(["svg", "math", "annotation"]);
/** HTML tags that close the SVG or MathML they open in, and `<font>` with any of these. */
const BREAKOUT_TAGS = new Set(
  (
    "b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img " +
    "li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var"
  ).split(" "),
);
const FONT_BREAKOUT = ["color", "face", "size"];

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
/** HTML elements DOM lets a shadow root attach to, besides custom elements. */
const SHADOW_HOSTS = new Set([
  "article",
  "aside",
  "blockquote",
  "body",
  "div",
  "footer",
  ...HEADINGS,
  "header",
  "main",
  "nav",
  "p",
  "section",
  "span",
]);
/** Hyphenated names SVG and MathML took first, so no custom element can have them. */
const TAKEN_CUSTOM_NAMES = new Set([
  "annotation-xml",
  "color-profile",
  "font-face",
  "font-face-src",
  "font-face-uri",
  "font-face-format",
  "font-face-name",
  "missing-glyph",
]);
/** What separates `class` and `rel` tokens: ASCII whitespace, so `a\u00a0` stays one class. */
const TOKEN_GAP = /[\t\n\f\r ]+/u;
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
  "shadowrootcustomelementregistry shadowrootdelegatesfocus shadowrootmode shadowrootserializable " +
  "shadowrootslotassignment shape size sizes slot span spellcheck src " +
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
  /** Set on a copy {@link slotted} made, whose reason already names where the hiding sits. */
  private copy = false;

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

  /**
   * A copy at a slotted child's own line, since this one went out with the shadow root.
   * @param place - The child's label and line.
   * @param own - Whether the slot started this record, rather than an element around it.
   * @param fallback - What the child shows without text.
   * @returns {HiddenText} The copy.
   */
  slotted(place: Place, own: boolean, fallback?: string): HiddenText {
    const where = own ? "its slot" : this.label;
    const around = own ? "" : ", around its slot";
    const placed = this.copy || this.kind === "camouflage";
    const reason = placed
      ? this.reason
      : `${this.reason} on ${where} at line ${this.line}${around}`;
    const copy = new HiddenText(this.kind, place.line, place.label, reason, fallback);
    copy.copy = true;
    return copy;
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

const DEFAULT_TEXT: Paint = {
  color: { red: 0, green: 0, blue: 0, alpha: 1 },
  source: "the default text color",
};
const DEFAULT_PAGE: Paint = {
  color: { red: 255, green: 255, blue: 255, alpha: 1 },
  source: "the default white page",
};

/** Where an element belongs: HTML, or the SVG and MathML islands that follow XML rules. */
type Namespace = "html" | "svg" | "math";

/**
 * What an element's children open as. `mathText` keeps only `mglyph` and `malignmark` MathML,
 * and `annotation` is an `annotation-xml` without HTML, which still lets an `<svg>` in.
 */
type Content = Namespace | "mathText" | "annotation";

/** An element the walk is inside, with what it inherits. */
interface OpenElement {
  readonly name: string;
  readonly label: string;
  readonly foreign: boolean;
  readonly content: Content;
  readonly hidden: HiddenText | undefined;
  readonly color: Paint | undefined;
  readonly background: Paint | undefined;
  readonly camouflage: HiddenText | undefined;
  /** Records this element started, reported when it closes; a host adds its light text's later. */
  readonly owned: HiddenText[];
  /** The tree its children sit in, whose rules are the only ones that match them. */
  readonly styles: TreeStyles;
  /** Slots of the shadow root it sits in; none in the page's own tree or an inert template. */
  readonly slots: SlotTree<OpenElement> | undefined;
}

/** One shadow root's slots, the first of each name, which is the one DOM assigns to. */
class SlotTree<T> {
  /** `shadowrootslotassignment=manual` leaves assigning to script, so nothing lands anywhere. */
  readonly manual: boolean;
  private readonly slots = new Map<string, T>();
  /** Whether the host's light DOM asks for a slot by this name. */
  private readonly asked: (name: string) => boolean;

  constructor(manual: boolean, asked: (name: string) => boolean) {
    this.manual = manual;
    this.asked = asked;
  }

  /**
   * @param name - The slot's `name`, empty for the default slot.
   * @param slot - The slot element.
   * @returns {boolean} Whether light DOM lands in it, which keeps its fallback off the page.
   */
  add(name: string, slot: T): boolean {
    if (this.slots.has(name)) return false;
    this.slots.set(name, slot);
    return !this.manual && this.asked(name);
  }

  /**
   * @param name - A light child's `slot` attribute, empty for text and elements without one.
   * @returns {T | undefined} The slot it lands in, or undefined when none takes it.
   */
  find(name: string): T | undefined {
    return this.manual ? undefined : this.slots.get(name);
  }
}

/** An inline script, style or textarea, completed by the text it holds once it closes. */
interface Pending {
  readonly element: string;
  readonly finding: HiddenFinding;
  /** Its text children so far; in SVG a CDATA section or a comment splits the code. */
  text: string;
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
  /** The earliest occurrence, since a shadow root's template is walked ahead of light DOM. */
  finding: HiddenFinding;
  count: number;
}

/** The rules one tree applies: the page's, or a shadow root's, which no other tree sees. */
class TreeStyles {
  /** Stylesheet rules by {@link ruleKey}, so an element meets only the rules that can match it. */
  readonly rules = new Map<string, StyleRule[]>();
  ruleCount = 0;
  /** Linked sheets filed, each import counted; repeated imports would multiply forever. */
  filings = 0;
  /** False once it links or imports a sheet that could change the black on white defaults. */
  assumeDefaults = true;
  /** Rules in filing order, ranked once every layer is known. */
  readonly filed: FiledRule[] = [];
  /** Layers by full name, each part quoted so `a\.b` stays one, with its nested ones in order. */
  private readonly layers = new Map<string, string[]>([["", []]]);
  /** How deep each layer sits, so imports can't nest past {@link LAYER_DEPTH_LIMIT} either. */
  private readonly depths = new Map<string, number>([["", 0]]);

  /**
   * Declare a layer nested in another, each part the first time it comes up.
   * @param outer - The full name of the layer it sits in, if any.
   * @param path - Its name's parts, folded past {@link LAYER_DEPTH_LIMIT}.
   * @returns {string | undefined} Its full name, or undefined outside any layer.
   */
  declareLayer(outer: string | undefined, path: LayerPath): string | undefined {
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
  rank(): void {
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
  return new HiddenScanner(html, options?.url, options?.stylesheets).stylesheets();
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
 * Open elements, closed the way the walk models the HTML tree builder. Implied ends follow HTML for
 * paragraphs, lists, options, tables and headings; the rest of its error recovery is out of scope.
 * The sheet pass keeps one too, so both agree on every shadow root.
 */
class ElementStack<T extends Readonly<{ name: string; foreign: boolean; content: Content }>> {
  readonly items: T[] = [];
  /** Open elements by name, so a tag nothing matches costs nothing however deep the stack. */
  private readonly open = new Map<string, number>();
  /** Elements that got a shadow root; a second one on the same host stays an inert template. */
  private readonly hosts = new WeakSet<T>();
  private readonly closed: (element: T) => void;

  constructor(closed: (element: T) => void) {
    this.closed = closed;
  }

  /**
   * Close whatever a start tag ends without saying so.
   * @param tag - The tag about to open.
   * @returns {boolean} False for a second `<html>`, `<head>` or `<body>`, which opens nothing.
   */
  opens(tag: HtmlStartTag): boolean {
    const { name } = tag;
    this.breakOut(tag);
    const rule = Object.hasOwn(IMPLIED_END, name) ? IMPLIED_END[name] : undefined;
    if (rule !== undefined) this.closeWithin(rule.closes, rule.scope);
    if (CLOSES_PARAGRAPH.has(name)) this.closeWithin(["p"], PARAGRAPH_SCOPE);
    if (HEADINGS.has(name) && HEADINGS.has(this.items.at(-1)?.name ?? "")) this.pop();
    return !SINGLETON_ELEMENTS.has(name) || !this.isOpen(name);
  }

  /**
   * SVG and MathML follow XML rules: no HTML attributes to judge, and `/>` closes an element.
   * @param name - The tag about to open.
   * @returns {Namespace} The namespace it opens in.
   */
  namespaceAt(name: string): Namespace {
    return namespaceIn(this.items.at(-1)?.content ?? "html", name);
  }

  /**
   * @returns {boolean} Whether the current element is SVG or MathML, where a `<![CDATA[` opens
   * text, right inside a `foreignObject` too.
   */
  inForeignContent(): boolean {
    return this.items.at(-1)?.foreign === true;
  }

  /**
   * A `<template shadowrootmode>` the parser attaches to a host that may take one and has none.
   * An implied `<body>` host and custom elements that refuse a shadow root aren't modeled.
   * @param tag - The start tag.
   * @param foreign - Whether it opens in SVG or MathML, where a template is just an element.
   * @returns {boolean} Whether it attaches one; asking again for the same host answers false.
   */
  attachesShadowRoot(tag: HtmlStartTag, foreign: boolean): boolean {
    const host = this.items.at(-1);
    if (foreign || host === undefined || !opensShadowRoot(tag)) return false;
    if (!canHostShadow(host.name) || this.hosts.has(host)) return false;
    this.hosts.add(host);
    return true;
  }

  push(element: T): void {
    this.items.push(element);
    this.open.set(element.name, (this.open.get(element.name) ?? 0) + 1);
  }

  /**
   * Close an element that holds no content where it opens, and any past {@link STACK_LIMIT}.
   * @param tag - Its start tag.
   * @param foreign - Whether it sits in foreign content.
   */
  settle(tag: HtmlStartTag, foreign: boolean): void {
    if (closesAtOnce(tag, foreign) || this.items.length > STACK_LIMIT) this.pop();
  }

  /** @param name - An end tag; it closes nothing past an HTML template but the template. */
  end(name: string): void {
    if (!this.isOpen(name)) return;
    const index = this.items.findLastIndex(
      (element) => element.name === name || walledOff(element),
    );
    if (index === -1 || this.items[index]!.name !== name) return;
    while (this.items.length > index) this.pop();
  }

  /** @param element - The top element again, as its children see it, under the same name. */
  replaceTop(element: T): void {
    this.items[this.items.length - 1] = element;
  }

  pop(): void {
    const element = this.items.pop();
    if (element === undefined) return;
    this.open.set(element.name, (this.open.get(element.name) ?? 1) - 1);
    this.closed(element);
  }

  /** @param tag - A tag like `<p>`, which pops SVG and MathML down to whatever holds HTML. */
  private breakOut(tag: HtmlStartTag): void {
    if (!breaksOut(tag)) return;
    while (FOREIGN_CONTENT.has(this.items.at(-1)?.content ?? "html")) this.pop();
  }

  private isOpen(name: string): boolean {
    return (this.open.get(name) ?? 0) > 0;
  }

  /**
   * Close the nearest open element named in `closes`, unless a `scope` element or, as in every
   * HTML scope, a `<template>` sits above it.
   * @param closes - Elements the start tag ends.
   * @param scope - Elements that keep them open.
   */
  private closeWithin(closes: readonly string[], scope: readonly string[]): void {
    if (!closes.some((name) => this.isOpen(name))) return;
    const bottom = Math.max(0, this.items.length - SCOPE_SCAN_LIMIT);
    for (let index = this.items.length - 1; index >= bottom; index -= 1) {
      const name = this.items[index]!.name;
      if (closes.includes(name)) {
        while (this.items.length > index) this.pop();
        return;
      }
      if (walledOff(this.items[index]!) || scope.includes(name)) return;
    }
  }
}

/** Light DOM the walk holds back until its host's shadow root template has gone first. */
interface Hold {
  readonly move: Move;
  /** Token index of the first one held. */
  readonly base: number;
  readonly tokens: HtmlToken[];
  /** Open elements once its host opened, so a template the file never closes ends first. */
  readonly depth: number;
}

/** Where a text came from, so a finding in it lands on the line the page wrote it on. */
interface CharacterSource {
  /** The text before its character references were decoded; left out, nothing was. */
  readonly written?: string;
  /** Whether it was decoded as an attribute value. */
  readonly attribute?: boolean;
  /** Whether it opens the document, where a byte order mark is no finding. */
  readonly documentStart?: boolean;
}

/** Walks the tokens once with the stack of open elements. */
class HiddenScanner {
  private readonly lines: number[];
  private readonly html: string;
  /** Templates the walk takes ahead of the light DOM before them, by their host's token index. */
  private readonly moves: Map<number, Move>;
  /** The sheet pass, which also knows the slots each host's light DOM asks for. */
  private readonly nesting: Nesting;
  private readonly page = new TreeStyles();
  /** Declarative shadow roots by the offset of their `<template>`. */
  private readonly shadows = new Map<number, TreeStyles>();
  /** The tree sheets get filed into while {@link prepare} reads the source. */
  private tree = this.page;
  /** Closing an element settles its pending code or field and reports its hidden records. */
  private readonly elements = new ElementStack<OpenElement>((element) => {
    if (this.pending?.element === element.name) this.settlePending();
    for (const record of element.owned) {
      const finding = record.finding();
      if (finding !== undefined) this.findings.push(finding);
    }
  });
  private readonly stack = this.elements.items;
  private readonly findings: HiddenFinding[] = [];
  private readonly attributes = new Map<string, AttributeTally>();
  /** Each host's shadow root slots, which its light children land in. */
  private readonly hosts = new WeakMap<OpenElement, SlotTree<OpenElement>>();
  /** The record a host's light text goes to, once it holds some a reader misses. */
  private readonly lightText = new WeakMap<OpenElement, HiddenText>();
  /** What the opening element inherits from: its parent, or the slot a light child lands in. */
  private from: OpenElement | undefined;
  private base: string | undefined;
  private baseFromPage = false;
  private pending: Pending | undefined;
  private readonly sheets: Readonly<Record<string, string | Stylesheet>>;
  /** Each linked sheet parsed once, however often it gets imported. */
  private readonly parsed = new Map<string, ParsedSheet>();
  /** Inline sheets by base and text, since every copy of a component brings its own `<style>`. */
  private readonly inline = new Map<string, ParsedSheet>();
  /** Rules filed into shadow roots so far, against {@link SHADOW_RULE_LIMIT}. */
  private shadowRules = 0;
  private preferredTitle: string | undefined;
  /** Anonymous layers so far, which keeps each one apart. */
  private anonymousLayers = 0;
  /** Every stylesheet the page's own tree applies, read or not, by absolute URL. */
  private readonly linked = new Set<string>();
  /** The same for its shadow roots, fetched after the page's own. */
  private readonly shadowLinked = new Set<string>();

  constructor(
    html: string,
    url: string | undefined,
    sheets: Readonly<Record<string, string | Stylesheet>> = {},
  ) {
    this.lines = lineStarts(html);
    this.html = html;
    this.base = url;
    this.sheets = sheets;
    this.nesting = this.prepare();
    this.moves = this.nesting.moves;
  }

  run(): HiddenFinding[] {
    for (const token of this.walkOrder()) {
      if (token.kind === "start") this.start(token);
      else if (token.kind === "end") this.end(token);
      else if (token.kind === "text") this.text(token);
      else this.comment(token);
    }
    while (this.stack.length > 0) this.elements.pop();
    const tallies = [...this.attributes.values()].map(({ finding, count }) =>
      count > 1 ? { ...finding, count } : finding,
    );
    return [...this.findings, ...tallies].toSorted(
      (left, right) =>
        hiddenKinds.indexOf(left.kind) - hiddenKinds.indexOf(right.kind) || left.line - right.line,
    );
  }

  /** @returns {string[]} The page's own sheets, then the ones only its shadow roots apply. */
  stylesheets(): string[] {
    return [...new Set([...this.linked, ...this.shadowLinked])];
  }

  /**
   * Source order, but a shadow root's template goes before the light DOM ahead of it, held back.
   * A moved run closes what it opens, so the stack matches; at EOF the open template closes first.
   * @yields {HtmlToken} Each token once.
   */
  private *walkOrder(): Generator<HtmlToken> {
    const holds: Hold[] = [];
    let index = -1;
    const tree: HtmlTree = {
      cdataAt: (offset) => this.nesting.sections.has(offset),
      rawTextAt: (tag) => !this.nesting.markup.has(tag.start),
    };
    for (const token of tokenizeHtml(this.html, tree)) {
      index += 1;
      const hold = holds.at(-1);
      if (hold !== undefined && index < hold.move.template) {
        hold.tokens.push(token);
        continue;
      }
      yield token;
      const move = this.moves.get(index);
      if (move !== undefined)
        holds.push({ move, base: index + 1, tokens: [], depth: this.stack.length });
      for (let done = holds.at(-1); done?.move.end === index; done = holds.at(-1)) {
        holds.pop();
        while (this.stack.length > done.depth) this.elements.pop();
        yield* this.heldOrder(done.base, done.tokens);
      }
    }
  }

  /**
   * Held light DOM in walk order, a host inside it taking its template first too.
   * @param base - Token index of the first one held.
   * @param tokens - The tokens held.
   * @yields {HtmlToken} Each one once.
   */
  private *heldOrder(base: number, tokens: readonly HtmlToken[]): Generator<HtmlToken> {
    const ranges: (readonly [number, number])[] = [[base, base + tokens.length - 1]];
    for (let range = ranges.pop(); range !== undefined; range = ranges.pop()) {
      const [from, to] = range;
      for (let index = from; index <= to; index += 1) {
        yield tokens[index - base]!;
        const move = this.moves.get(index);
        if (move === undefined) continue;
        ranges.push([move.end + 1, to], [index + 1, move.template - 1], [move.template, move.end]);
        break;
      }
    }
  }

  /**
   * Sheet rules, the `<base>` URL and linked sheets before the walk; inert templates hold none.
   * @returns {Nesting} The pass, which also knows where each host's light DOM goes.
   */
  private prepare(): Nesting {
    let index = -1;
    const nesting = new Nesting((css) => {
      this.fileStyle(css);
    });
    const tree: HtmlTree = {
      cdataAt: (offset) => nesting.cdataAt(offset),
      rawTextAt: (tag) => nesting.rawTextAt(tag),
    };
    for (const token of tokenizeHtml(this.html, tree)) {
      index += 1;
      nesting.step(token, index);
      if (token.kind !== "start" || nesting.inert) continue;
      this.tree = this.treeAt(nesting.shadowRoot);
      const { namespace } = nesting;
      if (token.name === "style" && namespace !== "math" && this.styleApplies(token))
        nesting.gatherSheet();
      if (namespace === "html") this.prepareTag(token);
    }
    nesting.finish(index);
    this.page.rank();
    for (const tree of this.shadows.values()) tree.rank();
    return nesting;
  }

  /**
   * @param start - Offset of a shadow root's `<template>`, or undefined for the page.
   * @returns {TreeStyles} That tree, created the first time.
   */
  private treeAt(start: number | undefined): TreeStyles {
    if (start === undefined) return this.page;
    const known = this.shadows.get(start);
    if (known !== undefined) return known;
    const tree = new TreeStyles();
    this.shadows.set(start, tree);
    return tree;
  }

  /**
   * A `<style>` that just closed; one that imports anything drops the default colors too.
   * @param css - Its text children, joined.
   */
  private fileStyle(css: string): void {
    this.fileSheet(css);
    if (/@import\b/iu.test(css)) this.tree.assumeDefaults = false;
  }

  /**
   * File an inline sheet's imports, then its own rules, the order a browser cascades them in.
   * @param css - The content of a `<style>`.
   */
  private fileSheet(css: string): void {
    const key = `${this.base ?? ""}\u0000${css}`;
    let sheet = this.inline.get(key);
    if (sheet === undefined) {
      sheet = parseSheet(css, this.base);
      this.inline.set(key, sheet);
    }
    this.fileParsed(sheet, [], undefined);
  }

  /**
   * File a linked sheet the same way, when it was read.
   * @param url - Its absolute URL.
   * @param chain - Sheets importing this one, so an import cycle ends.
   * @param layer - The cascade layer an import put it in, if any.
   */
  private fileLinked(url: string, chain: readonly string[], layer: string | undefined): void {
    const { tree } = this;
    (tree === this.page ? this.linked : this.shadowLinked).add(url);
    const sheet = this.parsedSheet(url);
    if (sheet === undefined || chain.includes(url) || tree.filings >= SHEET_FILINGS_LIMIT) return;
    if (this.ruleRoom() === 0) return;
    tree.filings += 1;
    this.fileParsed(sheet, [...chain, url], layer);
  }

  /** @returns {number} Rules the current tree still takes, shadow roots sharing one budget too. */
  private ruleRoom(): number {
    const own = RULE_LIMIT - this.tree.ruleCount;
    return this.tree === this.page ? own : Math.min(own, SHADOW_RULE_LIMIT - this.shadowRules);
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
    const { tree } = this;
    const scope = this.anonymousLayers++;
    const own = (path: LayerPath): string | undefined =>
      tree.declareLayer(
        layer,
        path.map((part) => (part.startsWith("\u0000") ? `\u0000${scope}:${part.slice(1)}` : part)),
      );
    for (const entry of sheet.preamble) {
      if ("layers" in entry) for (const path of entry.layers) own(path);
      else this.fileImport(entry, chain, layer);
    }
    for (const path of sheet.layers) own(path);
    const kept = sheet.rules.slice(0, this.ruleRoom());
    for (const rule of kept) {
      const placed = { ...rule, order: rule.order + tree.ruleCount };
      tree.filed.push({ rule: placed, layer: rule.layerPath ? own(rule.layerPath) : layer });
    }
    tree.ruleCount = Math.min(RULE_LIMIT, tree.ruleCount + sheet.rules.length);
    if (tree !== this.page) this.shadowRules += kept.length;
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
    let own: LayerPath | undefined = [];
    if (entry.layer === "") own = anonymous;
    else if (entry.layer !== undefined) own = layerPaths(entry.layer)?.[0];
    if (own !== undefined) this.fileLinked(entry.url, chain, this.tree.declareLayer(layer, own));
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

  /**
   * A `<base>` counts only in the page's own tree, never in a shadow root.
   * @param tag - An HTML start tag outside any inert template.
   */
  private prepareTag(tag: HtmlStartTag): void {
    if (tag.name === "link") this.prepareLink(tag);
    const href = attribute(tag, "href");
    if (tag.name !== "base" || href === undefined || this.baseFromPage || this.tree !== this.page)
      return;
    this.base = resolve(href, this.base);
    this.baseFromPage = true;
  }

  /**
   * A screen stylesheet drops the default colors; an alternate one or one of another titled set
   * waits for the reader's pick, and a disabled one or one typed as `text/less` applies nothing.
   * @param tag - The `<link>` start tag.
   */
  private prepareLink(tag: HtmlStartTag): void {
    const rel = attribute(tag, "rel")?.toLowerCase().split(TOKEN_GAP) ?? [];
    if (!rel.includes("stylesheet") || !linkApplies(tag)) return;
    this.tree.assumeDefaults = false;
    const href = attribute(tag, "href");
    const applied = !rel.includes("alternate") && this.inPreferredSet(attribute(tag, "title"));
    if (href !== undefined && applied) this.fileLinked(resolve(href, this.base), [], undefined);
  }

  private styleApplies(tag: HtmlStartTag): boolean {
    if (!styleIsCss(tag)) return false;
    return forScreen(attribute(tag, "media")) && this.inPreferredSet(attribute(tag, "title"));
  }

  /**
   * Whether a sheet's title keeps it on: an untitled sheet always is, and the first title picks
   * the set, the way CSSOM chooses the preferred style sheet set. In a shadow root HTML gives the
   * sheet no title at all.
   * @param title - Its `title` attribute.
   * @returns {boolean} True when a browser applies it without the reader picking another set.
   */
  private inPreferredSet(title: string | undefined): boolean {
    const name = this.tree === this.page ? (title ?? "") : "";
    if (name === "") return true;
    this.preferredTitle ??= name;
    return this.preferredTitle === name;
  }

  private start(tag: HtmlStartTag): void {
    if (!this.elements.opens(tag)) return;
    const place = { label: labelOf(tag), line: this.lineOf(tag.start) };
    const namespace = this.elements.namespaceAt(tag.name);
    const foreign = namespace !== "html";
    if (!foreign) this.tallyAttributes(tag, place);
    for (const { value, written, start } of tag.attributes) {
      this.characters(value, this.lineOf(start), place.label, { written, attribute: true });
    }
    this.headFinding(tag, place, foreign);
    this.elements.push(this.element(tag, place, namespace));
    if (tag.name === "slot" && !foreign) this.fileSlot(tag);
    if (FIELD_ELEMENTS.has(tag.name) && !foreign) this.field(tag, place);
    this.elements.settle(tag, foreign);
  }

  private element(tag: HtmlStartTag, place: Place, namespace: Namespace): OpenElement {
    const foreign = namespace !== "html";
    const shadowRoot = this.shadowRootAt(tag, place, foreign);
    if (shadowRoot !== undefined) return shadowRoot;
    const parent = this.stack.at(-1);
    this.from = this.inheritedFrom(attribute(tag, "slot") ?? "", place, fallbackOf(tag));
    const declarations = this.declarationsOf(tag);
    const hidden = this.hiddenAt(tag, place, declarations, namespace);
    const { color, background } = this.paintsOf(tag, place, declarations);
    const camouflage =
      hidden === undefined ? this.camouflageAt(place, color, background) : undefined;
    const owned = [hidden, camouflage].filter(
      (record): record is HiddenText =>
        record !== undefined && record !== parent?.hidden && record !== parent?.camouflage,
    );
    return {
      name: tag.name,
      label: place.label,
      foreign,
      content: contentOf(tag, namespace),
      hidden,
      color,
      background,
      camouflage,
      owned,
      styles: parent?.styles ?? this.page,
      slots: walledOff({ name: tag.name, foreign }) ? undefined : parent?.slots,
    };
  }

  /**
   * File the `<slot>` just opened with its shadow root. A filled slot buries its own children,
   * the fallback, but what lands in it still takes the slot's real look.
   * @param tag - Its start tag.
   */
  private fileSlot(tag: HtmlStartTag): void {
    const slot = this.stack.at(-1);
    const name = attribute(tag, "name") ?? "";
    if (slot?.slots?.add(name, slot) !== true) return;
    const fallback = new HiddenText("hidden", this.lineOf(tag.start), slot.label, filledSlot(name));
    this.elements.replaceTop({ ...slot, hidden: fallback, owned: [...slot.owned, fallback] });
  }

  /**
   * A shadow root renders as part of its host and inherits from it, so the template hides nothing.
   * @param tag - The start tag.
   * @param place - Its label and line.
   * @param foreign - Whether it opens in foreign content.
   * @returns {OpenElement | undefined} The shadow root, or undefined when the tag opens none.
   */
  private shadowRootAt(tag: HtmlStartTag, place: Place, foreign: boolean): OpenElement | undefined {
    const host = this.stack.at(-1);
    if (host === undefined || !this.elements.attachesShadowRoot(tag, foreign)) return undefined;
    const styles = this.shadows.get(tag.start) ?? new TreeStyles();
    const color = unlessDefault(host.color, DEFAULT_TEXT);
    const background = unlessDefault(host.background, DEFAULT_PAGE);
    const defaulted = color !== host.color || background !== host.background;
    const ownSheets = { color, background, camouflage: defaulted ? undefined : host.camouflage };
    const assignment = attribute(tag, "shadowrootslotassignment")?.toLowerCase();
    const asked = (name: string): boolean => this.nesting.asked(tag.start, name);
    const slots = new SlotTree<OpenElement>(assignment === "manual", asked);
    this.hosts.set(host, slots);
    return {
      ...host,
      ...(styles.assumeDefaults ? {} : ownSheets),
      name: tag.name,
      label: place.label,
      content: "html",
      owned: [],
      styles,
      slots,
    };
  }

  /** @returns {SlotTree<OpenElement> | undefined} The current element's shadow root slots. */
  private hostSlots(): SlotTree<OpenElement> | undefined {
    const top = this.stack.at(-1);
    return top === undefined ? undefined : this.hosts.get(top);
  }

  /**
   * What a node inherits from: its element, or for a host's light child the slot it lands in.
   * @param name - Its `slot` attribute; text and elements without one take the default slot.
   * @param place - Its label and line.
   * @param fallback - What it shows without text, such as an image's `alt`.
   * @returns {OpenElement | undefined} The element or slot; an unslotted node hides past overrides.
   */
  private inheritedFrom(name: string, place: Place, fallback?: string): OpenElement | undefined {
    const host = this.stack.at(-1);
    const slots = this.hostSlots();
    if (host === undefined || slots === undefined) return host;
    const slot = slots.find(name);
    if (slot === undefined) {
      const reason = unslotted(name, slots.manual);
      return {
        ...host,
        hidden: new HiddenText("hidden", place.line, place.label, reason, fallback),
      };
    }
    const { hidden, camouflage } = slot;
    const own = hidden !== undefined && slot.owned.includes(hidden);
    return {
      ...slot,
      hidden: hidden === host.hidden ? hidden : hidden?.slotted(place, own, fallback),
      camouflage: camouflage === host.camouflage ? camouflage : camouflage?.slotted(place, false),
    };
  }

  private hiddenAt(
    tag: HtmlStartTag,
    place: Place,
    declarations: Declarations,
    namespace: Namespace,
  ): HiddenText | undefined {
    const inherited = this.from?.hidden;
    if (inherited !== undefined && !this.shows(tag.name, declarations)) return inherited;
    const undrawn = namespace === "svg" && UNDRAWN_ELEMENTS.has(tag.name);
    const reason = undrawn ? `${tag.name} content` : hiddenBy(tag, declarations);
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
    const { from } = this;
    const record = from?.hidden;
    if (from === undefined || record === undefined) return false;
    const opener = from.name === "details" && from.owned.includes(record);
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
    const color = ownColor(tag, declarations, place.label) ?? this.from?.color;
    const background = ownBackground(tag, declarations, place.label) ?? this.from?.background;
    if (this.from !== undefined) return { color, background };
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
    const { from } = this;
    if (from?.color === color && from.background === background) return from.camouflage;
    const reason = `${colorText(color.color)} text from ${color.source} on ${colorText(background.color)} from ${background.source}`;
    return new HiddenText("camouflage", place.line, place.label, reason);
  }

  /**
   * With no stylesheet linked or imported, a browser draws black text on a white page. Only an
   * element without a parent takes it; below that a paint nobody knows stays unknown.
   * @param role - Which default to take.
   * @returns {Paint | undefined} The default, or undefined when a stylesheet could change it.
   */
  private defaultPaint(role: "text" | "page"): Paint | undefined {
    if (!this.page.assumeDefaults) return undefined;
    return role === "text" ? DEFAULT_TEXT : DEFAULT_PAGE;
  }

  private declarationsOf(tag: HtmlStartTag): Declarations {
    const id = attribute(tag, "id");
    const inline = parseDeclarations(attribute(tag, "style") ?? "");
    const identity = {
      tag: tag.name,
      classes: classesOf(tag),
      ...(id === undefined ? {} : { id }),
    };
    const { rules } = this.stack.at(-1)?.styles ?? this.page;
    return cascade((key) => rules.get(key) ?? [], identity, inline);
  }

  private end(tag: HtmlEndTag): void {
    this.elements.end(tag.name);
  }

  private text(token: HtmlText): void {
    const line = this.lineOf(token.start);
    if (this.rawText(token, line)) return;
    const text = token.cdata ? token.text : decodeCharacterReferences(token.text);
    const source = token.cdata ? {} : { written: token.text };
    this.characters(text, line, this.stack.at(-1)?.label, {
      ...source,
      documentStart: token.start === 0,
    });
    this.textRecord(line, text)?.add(text);
  }

  /**
   * The record text joins: its element's, or for a host the one its default slot gives.
   * @param line - The text's line.
   * @param text - The decoded text.
   * @returns {HiddenText | undefined} The record, or undefined when a reader sees the text.
   */
  private textRecord(line: number, text: string): HiddenText | undefined {
    const top = this.stack.at(-1);
    if (top === undefined || this.hostSlots() === undefined) return top?.hidden ?? top?.camouflage;
    const known = this.lightText.get(top);
    return known !== undefined || text.trim() === "" ? known : this.lightTextRecord(line);
  }

  /**
   * The record a host's light text gets through the default slot; a new one stays with the host.
   * @param line - Line of the first light text that isn't blank.
   * @returns {HiddenText | undefined} What hides or camouflages it, if anything.
   */
  private lightTextRecord(line: number): HiddenText | undefined {
    const host = this.stack.at(-1)!;
    const from = this.inheritedFrom("", { label: host.label, line });
    const record = from?.hidden ?? from?.camouflage;
    if (record === undefined || record === host.hidden || record === host.camouflage) return record;
    host.owned.push(record);
    this.lightText.set(host, record);
    return record;
  }

  /**
   * Text a browser never draws as page text, such as a script or a title.
   * @param token - The text, raw in HTML; in SVG and MathML its references decode outside CDATA.
   * @param line - Its line.
   * @returns {boolean} Whether the text was taken here.
   */
  private rawText(token: HtmlText, line: number): boolean {
    const top = this.stack.at(-1);
    if (top === undefined) return false;
    const pending = this.pending?.element === top.name ? this.pending : undefined;
    if (pending === undefined && !UNDRAWN_ELEMENTS.has(top.name)) return false;
    const text = childText(token, top.foreign);
    this.characters(text, line, top.label, text === token.text ? {} : { written: token.text });
    if (pending !== undefined)
      pending.text += top.name === "textarea" ? decodeCharacterReferences(text) : text;
    return true;
  }

  private comment(token: HtmlComment): void {
    const line = this.lineOf(token.start);
    const element = this.stack.at(-1)?.label ?? "document";
    this.findings.push({ kind: "comment", line, element, value: marked(token.text.trim()) });
    this.characters(token.text, line, element);
  }

  private settlePending(): void {
    const pending = this.pending;
    if (pending === undefined) return;
    this.pending = undefined;
    const { finding, text } = pending;
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
        continue;
      }
      tally.count += 1;
      if (place.line < tally.finding.line) {
        tally.finding = attributeFinding(place, name, value, reason);
      }
    }
  }

  /**
   * What a meta tag, link or inline code holds; in SVG a link or base is just an element.
   * @param tag - The start tag.
   * @param place - Its label and line.
   * @param foreign - Whether it opens in SVG or MathML.
   */
  private headFinding(tag: HtmlStartTag, place: Place, foreign: boolean): void {
    let finding: HiddenFinding | undefined;
    if (tag.name === "script" || tag.name === "style") finding = this.codeFinding(tag, place);
    else if (foreign) return;
    else if (tag.name === "meta") finding = metaFinding(tag, place.line);
    else if (tag.name === "link" || tag.name === "base")
      finding = linkFinding(tag, place.line, this.base);
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
    this.settlePending();
    this.pending = { element: tag.name, finding, text: "" };
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
    if (tag.name === "textarea") this.pending = { element: "textarea", finding, text: "" };
    else this.findings.push(finding);
  }

  private characters(
    text: string,
    line: number,
    element: string | undefined,
    source: Readonly<CharacterSource> = {},
  ): void {
    const { written, attribute, documentStart = false } = source;
    const runs = invisibleRuns(text, documentStart);
    if (runs.length === 0) return;
    const indexes = runs.map(({ index }) => index);
    const offsets = written === undefined ? indexes : writtenOffsets(written, indexes, attribute);
    const starts = lineStarts(written ?? text);
    for (const [position, { index, run }] of runs.entries()) {
      const at = line - 1 + lineAt(starts, offsets[position]!);
      const finding = invisibleFinding(text, index, run, at);
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
 * @param tag - A start tag.
 * @returns {boolean} Whether it closes SVG or MathML when it opens in them.
 */
function breaksOut(tag: HtmlStartTag): boolean {
  if (tag.name !== "font") return BREAKOUT_TAGS.has(tag.name);
  return FONT_BREAKOUT.some((name) => attribute(tag, name) !== undefined);
}

/**
 * @param content - What the parent's children open as.
 * @param name - The tag about to open.
 * @returns {Namespace} Its namespace; inside SVG, even a `<math>` stays SVG.
 */
function namespaceIn(content: Content, name: string): Namespace {
  if (content === "svg" || content === "math") return content;
  if (name === "svg" || name === "math") return name;
  if (content === "annotation" || (content === "mathText" && MATH_GLYPHS.has(name))) return "math";
  return "html";
}

/**
 * Children of `foreignObject`, `desc`, an SVG `title` and an HTML `annotation-xml` are HTML again.
 * @param tag - Its start tag.
 * @param namespace - The namespace it opened in.
 * @returns {Content} What its children open as.
 */
function contentOf(tag: HtmlStartTag, namespace: Namespace): Content {
  if (namespace === "svg") return SVG_HTML_POINTS.has(tag.name) ? "html" : "svg";
  if (namespace === "html") return "html";
  if (MATH_TEXT_POINTS.has(tag.name)) return "mathText";
  if (tag.name !== "annotation-xml") return "math";
  const encoding = attribute(tag, "encoding")?.toLowerCase() ?? "";
  return ANNOTATION_HTML.has(encoding) ? "html" : "annotation";
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
  return visible?.test(own.value) === true && hidingReason({ [property]: own }) === undefined;
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
  const type = trimmed(attribute(tag, "type")?.split(";")[0] ?? "").toLowerCase();
  const css = type === "" || type === "text/css";
  return css && attribute(tag, "disabled") === undefined && forScreen(attribute(tag, "media"));
}

/**
 * Whether HTML reads a `<style>` as CSS: no type, an empty one or `text/css`, nothing trimmed.
 * @param tag - The `<style>` start tag.
 * @returns {boolean} Stricter than a link: even `text/css; charset=utf-8` stays out.
 */
function styleIsCss(tag: HtmlStartTag): boolean {
  const type = attribute(tag, "type");
  return type === undefined || type === "" || type.toLowerCase() === "text/css";
}

/**
 * @param token - A text child of a script, style or the like.
 * @param foreign - Whether the element sits in SVG or MathML, whose text is markup text.
 * @returns {string} The text as the element holds it: raw in HTML, decoded outside CDATA there.
 */
function childText(token: HtmlText, foreign: boolean): string {
  return foreign && token.cdata !== true ? decodeCharacterReferences(token.text) : token.text;
}

/** An element {@link Nesting} tracks: an inert HTML template, a shadow root or anything else. */
interface Nested {
  readonly name: string;
  readonly foreign: boolean;
  readonly content: Content;
  readonly kind: "inert" | "shadow" | "other";
  /** Token index of its start tag. */
  readonly index: number;
  /** For a shadow root, the token index of its host's start tag. */
  readonly host?: number;
  /** Whether a child goes to the default slot, should this element turn out to be a host. */
  asksDefault: boolean;
  /** Named slots its children ask for, the same way; most elements never get one. */
  asksNamed: Set<string> | undefined;
  /** For a `<style>` that applies, its text children so far, filed once it closes. */
  sheet?: string;
}

/** A shadow root's template by its first and last token, walked before the light DOM ahead. */
interface Move {
  readonly template: number;
  readonly end: number;
}

/** What the sheet pass sits in, on the same stack the walk keeps: inert templates, shadow roots. */
class Nesting {
  /** Hosts by token index, the ones with light DOM ahead of their shadow root's template. */
  readonly moves = new Map<number, Move>();
  /** Offsets of the `<![CDATA[` that open a section, so the walk splits the page the same way. */
  readonly sections = new Set<number>();
  /** Offsets of a script, style or the like opened in SVG or MathML, whose tags count there. */
  readonly markup = new Set<number>();
  /** Hosts by the offset of their shadow root's template. */
  private readonly hosts = new Map<number, Nested>();
  private readonly elements = new ElementStack<Nested>((element) => {
    this.closed(element);
  });
  /** Takes the CSS of each `<style>` {@link gatherSheet} picked, once the element closes. */
  private readonly sheetClosed: (css: string) => void;
  /** Where the last start tag opened. */
  private opened: Namespace = "html";
  private inertTemplates = 0;
  private readonly shadowRoots: number[] = [];
  /** Index of the token being stepped through. */
  private index = 0;

  constructor(sheetClosed: (css: string) => void) {
    this.sheetClosed = sheetClosed;
  }

  /** @returns {Namespace} Where the start tag just stepped through opened. */
  get namespace(): Namespace {
    return this.opened;
  }

  /** @returns {boolean} Whether what comes next sits in an inert HTML template, out of the page. */
  get inert(): boolean {
    return this.inertTemplates > 0;
  }

  /** @returns {number | undefined} Offset of the innermost shadow root open, if any. */
  get shadowRoot(): number | undefined {
    return this.shadowRoots.at(-1);
  }

  /**
   * @param token - The next token.
   * @param index - Its index among the page's tokens.
   */
  step(token: HtmlToken, index: number): void {
    this.index = index;
    if (token.kind === "end") this.elements.end(token.name);
    else if (token.kind === "text") this.addText(token);
    else if (token.kind === "start") this.start(token);
  }

  /** Gather the text of the `<style>` just opened, unless `/>` closed it at once. */
  gatherSheet(): void {
    const style = this.elements.items.at(-1);
    if (style?.index === this.index) style.sheet = "";
  }

  /**
   * @param template - Offset of a shadow root's template.
   * @param name - A slot's `name`, empty for the default slot.
   * @returns {boolean} Whether the host's light DOM asks for that slot, ahead of the root or after.
   */
  asked(template: number, name: string): boolean {
    const host = this.hosts.get(template);
    if (host === undefined) return false;
    return name === "" ? host.asksDefault : host.asksNamed?.has(name) === true;
  }

  /**
   * @param offset - Offset of a `<![CDATA[`, met after every token ahead of it has been stepped.
   * @returns {boolean} Whether it opens a section, which then gets filed in {@link sections}.
   */
  cdataAt(offset: number): boolean {
    if (!this.elements.inForeignContent()) return false;
    this.sections.add(offset);
    return true;
  }

  /**
   * @param tag - A script, style or the like, met before it gets stepped through. None of them
   * closes SVG or MathML, so the open elements already say where it lands.
   * @returns {boolean} Whether it opens as HTML; otherwise it gets filed in {@link markup}.
   */
  rawTextAt(tag: HtmlStartTag): boolean {
    if (this.elements.namespaceAt(tag.name) === "html") return true;
    this.markup.add(tag.start);
    return false;
  }

  /** @param last - Index of the page's last token, where the end of the file closes the rest. */
  finish(last: number): void {
    this.index = last;
    while (this.elements.items.length > 0) this.elements.pop();
  }

  /** @param tag - A start tag; a second `<html>`, `<head>` or `<body>` opens nothing. */
  private start(tag: HtmlStartTag): void {
    this.opened = "html";
    if (this.elements.opens(tag)) this.open(tag);
  }

  /** @param token - Text, which joins a gathered sheet when its `<style>` holds it directly. */
  private addText(token: HtmlText): void {
    this.request("");
    const parent = this.elements.items.at(-1);
    if (parent?.sheet !== undefined) parent.sheet += childText(token, parent.foreign);
  }

  /**
   * Only an HTML template walls its content off; inside SVG or MathML it's just another element.
   * @param tag - The start tag.
   */
  private open(tag: HtmlStartTag): void {
    const namespace = this.elements.namespaceAt(tag.name);
    this.opened = namespace;
    const foreign = namespace !== "html";
    const host = this.elements.items.at(-1)?.index;
    let kind: Nested["kind"] = "other";
    if (tag.name === "template" && !foreign)
      kind = this.elements.attachesShadowRoot(tag, foreign) ? "shadow" : "inert";
    const element: Nested = {
      name: tag.name,
      foreign,
      content: contentOf(tag, namespace),
      kind,
      index: this.index,
      asksDefault: false,
      asksNamed: undefined,
    };
    if (kind === "shadow") this.attach(tag.start);
    else this.request(attribute(tag, "slot") ?? "");
    this.elements.push(kind === "shadow" ? { ...element, host } : element);
    if (kind === "inert") this.inertTemplates += 1;
    this.elements.settle(tag, foreign);
  }

  /** @param template - Offset of the template that gives the open element a shadow root. */
  private attach(template: number): void {
    const host = this.elements.items.at(-1);
    if (host !== undefined) this.hosts.set(template, host);
    this.shadowRoots.push(template);
  }

  /**
   * DOM hands every text node to the default slot, a lone newline too, so tidy markup fills it.
   * Comments don't count.
   * @param name - The child's `slot` attribute, empty for text and elements without one.
   */
  private request(name: string): void {
    const parent = this.elements.items.at(-1);
    if (parent === undefined) return;
    if (name === "") parent.asksDefault = true;
    else (parent.asksNamed ??= new Set()).add(name);
  }

  private closed(element: Readonly<Pick<Nested, "kind" | "index" | "host" | "sheet">>): void {
    if (element.sheet !== undefined) this.sheetClosed(element.sheet);
    if (element.kind === "inert") this.inertTemplates -= 1;
    if (element.kind !== "shadow") return;
    this.shadowRoots.pop();
    const { host, index: template } = element;
    if (host !== undefined && template > host + 1)
      this.moves.set(host, { template, end: this.index });
  }
}

/**
 * @param tag - A start tag.
 * @returns {boolean} Whether it's a template whose `shadowrootmode` is `open` or `closed`.
 */
function opensShadowRoot(tag: HtmlStartTag): boolean {
  const mode = attribute(tag, "shadowrootmode")?.toLowerCase();
  return tag.name === "template" && (mode === "open" || mode === "closed");
}

/**
 * @param name - An HTML element's name.
 * @returns {boolean} Whether DOM lets it host a shadow root: a custom element or one of a few.
 */
function canHostShadow(name: string): boolean {
  if (SHADOW_HOSTS.has(name)) return true;
  return /^[a-z]/u.test(name) && name.includes("-") && !TAKEN_CUSTOM_NAMES.has(name);
}

/**
 * @param element - An open element.
 * @returns {boolean} Whether it's an HTML template, which no end tag or implied end crosses.
 */
function walledOff(element: Readonly<{ name: string; foreign: boolean }>): boolean {
  return element.name === "template" && !element.foreign;
}

/**
 * @param name - A light child's `slot` attribute, empty for the default slot.
 * @param manual - Whether the shadow root leaves assigning to script.
 * @returns {string} Why no slot takes it.
 */
function unslotted(name: string, manual: boolean): string {
  if (manual) return "unslotted, its shadow root assigns slots by script";
  return name === "" ? "unslotted, no default slot" : `unslotted, no slot named ${valueOf(name)}`;
}

/**
 * @param name - A slot's `name`, empty for the default slot.
 * @returns {string} Why its fallback never shows.
 */
function filledSlot(name: string): string {
  const slot = name === "" ? "the default slot" : `the slot named ${valueOf(name)}`;
  return `fallback, light DOM fills ${slot}`;
}

/**
 * @param paint - A paint a shadow root inherits.
 * @param standard - The default it could be.
 * @returns {Paint | undefined} The paint, or undefined when it's only the default.
 */
function unlessDefault(paint: Paint | undefined, standard: Paint): Paint | undefined {
  return paint === standard ? undefined : paint;
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
  const rel = tag.name === "base" ? "base" : trimmed(attribute(tag, "rel") ?? "").toLowerCase();
  return {
    kind: rel.split(TOKEN_GAP).includes("stylesheet") ? "style" : "link",
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
  return (attribute(tag, "class") ?? "").split(TOKEN_GAP).filter((name) => name !== "");
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
