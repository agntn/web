/** A hex color of three, four, six or eight digits. */
export const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu;
const SPACE = /^[ \t\n\r\f]$/u;
/** A CSS escape: up to six hex digits and one optional space, or any other character. */
export const ESCAPE = /\\(?:([\da-f]{1,6})[ \t\n\r\f]?|([^\n\r\f]))/giu;
const ESCAPE_AT = new RegExp(ESCAPE.source, "iuy");
/** Keywords every property takes. */
const CSS_WIDE = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);
/** A value a browser fills in later, so it can't be judged when the sheet is read. */
const SUBSTITUTION = /(?:^|[^\w-])(?:var|env|attr|if|inherit)\(/u;
/** One function call, like `inset(50%)`, read by its name. */
const FUNCTION = /^(?<name>-?[a-z][\w-]*)\((?<body>[\s\S]*)\)$/u;
/** A vendor keyword like `-webkit-box`; browsers disagree on those, so each one passes. */
const VENDOR = /^-[a-z]+-[a-z][\w-]*$/u;
const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/u;
const PERCENTAGE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?%$/u;
const LENGTH =
  /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?:px|r?em|r?ex|r?ch|r?cap|r?ic|r?lh|[sld]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max)|cm|mm|q|in|pt|pc)$/u;
/** Hex digits without the `#`, which quirks mode still takes as a color. */
const HASHLESS_HEX = /^(?:[\da-f]{3}|[\da-f]{6})$/u;
const MATH_FUNCTIONS = names(
  "calc min max clamp round mod rem abs sign sin cos tan asin acos atan atan2 pow sqrt hypot " +
    "log exp progress random sibling-count sibling-index calc-size",
);
const COLOR_FUNCTIONS = names(
  "rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark contrast-color " +
    "device-cmyk",
);
/** CSS Color 4 named colors, system colors and the deprecated system colors browsers still take. */
const COLOR_KEYWORDS = keywords(
  "transparent currentcolor aliceblue antiquewhite aqua aquamarine azure beige bisque black " +
    "blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral " +
    "cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen " +
    "darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon " +
    "darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink " +
    "deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " +
    "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo " +
    "ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow " +
    "yellowgreen accentcolor accentcolortext activetext buttonborder buttonface buttontext " +
    "canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext " +
    "selecteditem selecteditemtext visitedtext activeborder activecaption appworkspace " +
    "background buttonhighlight buttonshadow captiontext inactiveborder inactivecaption " +
    "inactivecaptiontext infobackground infotext menu menutext scrollbar threeddarkshadow " +
    "threedface threedhighlight threedlightshadow threedshadow window windowframe windowtext",
);
/** A whole `display` value of one keyword. */
const DISPLAY_KEYWORDS = keywords(
  "none contents block inline run-in flow flow-root table flex grid ruby list-item math " +
    "inline-block inline-table inline-flex inline-grid table-row-group table-header-group " +
    "table-footer-group table-row table-cell table-column-group table-column table-caption " +
    "ruby-base ruby-text ruby-base-container ruby-text-container grid-lanes inline-grid-lanes",
);
/** Keywords that also pair up, as in `inline flow-root`. */
const DISPLAY_PARTS = names(
  "block inline run-in flow flow-root table flex grid ruby list-item math",
);
const FONT_SIZE_KEYWORDS = keywords(
  "xx-small x-small small medium large x-large xx-large xxx-large smaller larger math",
);
const SIZE_KEYWORDS = keywords("auto min-content max-content fit-content stretch");
const SIZE_FUNCTIONS = names("fit-content anchor-size");
const OFFSET_FUNCTIONS = names("anchor anchor-size");
const POSITIONS = keywords("static relative absolute fixed sticky");
const OVERFLOWS = keywords("visible hidden clip scroll auto overlay");
const SHAPE_FUNCTIONS = names("inset circle ellipse polygon path rect xywh shape");
const GEOMETRY_BOXES = names(
  "border-box padding-box content-box margin-box fill-box stroke-box view-box",
);
const BACKGROUND_KEYWORDS = keywords(
  "none left right top bottom center repeat repeat-x repeat-y space round no-repeat scroll " +
    "fixed local border-box padding-box content-box text auto cover contain",
);
const IMAGE_FUNCTIONS = names(
  "url linear-gradient radial-gradient conic-gradient repeating-linear-gradient " +
    "repeating-radial-gradient repeating-conic-gradient gradient image image-set cross-fade " +
    "element paint",
);
/** How parentheses move the nesting depth outside quotes. */
export const NESTING: Readonly<Record<string, number>> = { "(": 1, ")": -1 };
/** What splits `background` besides whitespace: its layers, and the `/` before a size. */
const BACKGROUND_DELIMITERS = ",/";

type Grammar = (words: readonly string[]) => boolean;

/** What each property the reveal reads takes, word by word. */
const GRAMMARS: Readonly<Record<string, Grammar>> = {
  display,
  visibility: one((word) => ["visible", "hidden", "collapse"].includes(word)),
  opacity: one((word) => NUMBER.test(word) || PERCENTAGE.test(word) || math(word)),
  "font-size": one((word) => FONT_SIZE_KEYWORDS(word) || lengthPercentage(word, false)),
  color: one(color),
  "background-color": one(color),
  left: one(offset),
  top: one(offset),
  "text-indent": textIndent,
  position: one(POSITIONS),
  overflow: (words) => words.length <= 2 && words.every(OVERFLOWS),
  clip: one((word) => word === "auto" || functionName(word) === "rect"),
  "clip-path": clipPath,
  width: one(size),
  height: one(size),
  background: (words) => words.every(backgroundPart),
};

/**
 * Whether a browser keeps a declaration, for the properties a reveal reads; any other passes.
 * When in doubt it passes, so a value the reveal can't judge never undoes one it can.
 * @param property - The property, lowercase.
 * @param value - Its value without `!important`.
 * @returns {boolean} False when a browser throws the declaration away.
 */
export function validValue(property: string, value: string): boolean {
  const grammar = Object.hasOwn(GRAMMARS, property) ? GRAMMARS[property] : undefined;
  if (grammar === undefined) return true;
  const parts = words(value, property === "background" ? BACKGROUND_DELIMITERS : "");
  if (parts.some((part) => SUBSTITUTION.test(part))) return true;
  if (parts.length === 1 && CSS_WIDE.has(parts[0] ?? "")) return true;
  return parts.length > 0 && grammar(parts);
}

/**
 * A value split outside parentheses, strings and escapes, then each word decoded, so `red\9`
 * stays one word with a tab in it, the way a browser reads it before throwing it away.
 * @param value - The value as written.
 * @param delimiters - Characters that split it besides CSS whitespace.
 * @returns {string[]} Its words.
 */
function words(value: string, delimiters: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value.charAt(index);
    if (character === "\\") index = escapeEnd(value, index) - 1;
    else if (inString(quote, character)) quote = quoteAfter(quote, character);
    else if (depth === 0 && splits(character, delimiters)) {
      if (index > start) result.push(identifier(value.slice(start, index)).toLowerCase());
      start = index + 1;
    } else depth = Math.max(0, depth + (NESTING[character] ?? 0));
  }
  return result;
}

/**
 * Where an escape that starts at a backslash ends.
 * @param value - The value.
 * @param index - Offset of the backslash.
 * @returns {number} Offset just past the escape; a backslash before a newline is one character.
 */
function escapeEnd(value: string, index: number): number {
  ESCAPE_AT.lastIndex = index;
  return ESCAPE_AT.test(value) ? ESCAPE_AT.lastIndex : index + 1;
}

/**
 * The quote a splitter is inside after one more character.
 * @param quote - The open quote, or an empty string.
 * @param character - The next character.
 * @returns {string} The open quote after it.
 */
export function quoteAfter(quote: string, character: string): string {
  if (quote !== "") return character === quote ? "" : quote;
  return character === '"' || character === "'" ? character : "";
}

/**
 * Whether a character is inside a quoted string, or opens one.
 * @param quote - The open quote, or an empty string.
 * @param character - The character.
 * @returns {boolean} True when the string's quote tracking takes it.
 */
export function inString(quote: string, character: string): boolean {
  return quote !== "" || character === '"' || character === "'";
}

function splits(character: string, delimiters: string): boolean {
  return character === "" || SPACE.test(character) || delimiters.includes(character);
}

/**
 * An identifier with its escapes decoded, so `\66 oo` and `foo` name the same layer.
 * @param text - The identifier as written.
 * @returns {string} Its value; NUL and code points no string can hold become U+FFFD.
 */
export function identifier(text: string): string {
  if (!text.includes("\\") && !text.includes("\u0000")) return text;
  return text
    .replaceAll(ESCAPE, (_escape, hex: string | undefined, character: string | undefined) => {
      if (hex === undefined) return character ?? "";
      const point = Number.parseInt(hex, 16);
      const invalid = point === 0 || point > 0x10_ff_ff || (point >= 0xd8_00 && point <= 0xdf_ff);
      return invalid ? "\uFFFD" : String.fromCodePoint(point);
    })
    .replaceAll("\u0000", "\uFFFD");
}

function one(test: (word: string) => boolean): Grammar {
  return (words) => words.length === 1 && test(words[0] ?? "");
}

/**
 * A test for a word from a list.
 * @param list - The words, space separated.
 * @returns {(word: string) => boolean} The test.
 */
function names(list: string): (word: string) => boolean {
  const known = new Set(list.split(" "));
  return (word) => known.has(word);
}

/**
 * A test for a keyword from a list, or any vendor keyword.
 * @param list - The keywords, space separated.
 * @returns {(word: string) => boolean} The test.
 */
function keywords(list: string): (word: string) => boolean {
  const known = names(list);
  return (word) => known(word) || VENDOR.test(word);
}

function functionName(word: string): string | undefined {
  return FUNCTION.exec(word)?.groups?.name?.replace(/^-(?:webkit|moz|ms|o)-/u, "");
}

function math(word: string): boolean {
  return MATH_FUNCTIONS(functionName(word) ?? "");
}

/**
 * A length or percentage, or a bare number, which quirks mode reads as pixels.
 * @param word - One word of the value.
 * @param negative - Whether the property takes a value below zero.
 * @returns {boolean} True when it fits.
 */
function lengthPercentage(word: string, negative: boolean): boolean {
  if (math(word)) return true;
  const fits = LENGTH.test(word) || PERCENTAGE.test(word) || NUMBER.test(word);
  return fits && (negative || Number.parseFloat(word) >= 0);
}

function color(word: string): boolean {
  if (HEX_COLOR.test(word) || HASHLESS_HEX.test(word)) return true;
  return COLOR_KEYWORDS(word) || COLOR_FUNCTIONS(functionName(word) ?? "");
}

function offset(word: string): boolean {
  return (
    word === "auto" || OFFSET_FUNCTIONS(functionName(word) ?? "") || lengthPercentage(word, true)
  );
}

function size(word: string): boolean {
  if (SIZE_KEYWORDS(word) || SIZE_FUNCTIONS(functionName(word) ?? "")) return true;
  return lengthPercentage(word, false);
}

function textIndent(words: readonly string[]): boolean {
  const lengths = words.filter((word) => lengthPercentage(word, true));
  const flags = words.filter((word) => word === "hanging" || word === "each-line");
  return (
    lengths.length === 1 &&
    lengths.length + flags.length === words.length &&
    new Set(flags).size === flags.length
  );
}

function display(words: readonly string[]): boolean {
  if (words.length === 1) return DISPLAY_KEYWORDS(words[0] ?? "");
  return words.length <= 3 && words.every(DISPLAY_PARTS) && new Set(words).size === words.length;
}

function clipPath(words: readonly string[]): boolean {
  const [only] = words;
  if (words.length === 1 && (only === "none" || functionName(only ?? "") === "url")) return true;
  const shapes = words.filter((word) => SHAPE_FUNCTIONS(functionName(word) ?? ""));
  const boxes = words.filter(GEOMETRY_BOXES);
  return shapes.length <= 1 && boxes.length <= 1 && shapes.length + boxes.length === words.length;
}

function backgroundPart(word: string): boolean {
  if (BACKGROUND_KEYWORDS(word) || IMAGE_FUNCTIONS(functionName(word) ?? "")) return true;
  return lengthPercentage(word, true) || color(word);
}
