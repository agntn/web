import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Value } from "typebox/value";
import type { TSchema } from "@agntn/tools";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  HTTPError,
  InvalidPageUrlError,
  PrivateAddressError,
  UnreadablePageError,
} from "../../src/core/errors.ts";
import {
  linkedStylesheets,
  revealHtml,
  revealUrl,
  type HiddenFinding,
} from "../../src/core/reveal.ts";
import { revealAnswer } from "../../src/tool-text.ts";
import { webTools } from "../../src/tools.ts";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const { lookup } = await import("node:dns/promises");

/* Every host resolves to a public address unless a test says otherwise. */
beforeEach(() => {
  vi.mocked(lookup)
    .mockReset()
    .mockResolvedValue([{ address: "207.241.237.3", family: 4 }] as never);
});

/*
 * https://web.archive.org/web/20260418153806id_/https://gsmg.io/theseedisplanted, fetched
 * 2026-10-12: the capture as archived, without the toolbar. SHA-256
 * 5356c88769137ec82953888d7c5b9f18b0fa00019fad7591cc6aaaaf91463136.
 */
const gsmg = readFileSync(
  new URL("../fixtures/gsmg-theseedisplanted.html", import.meta.url),
  "utf8",
);

const ZWSP = String.fromCodePoint(0x200b);
const ZWJ = String.fromCodePoint(0x200d);
const ZWNJ = String.fromCodePoint(0x200c);
const BOM = String.fromCodePoint(0xfeff);

/* The findings of one kind. */
function ofKind(findings: readonly HiddenFinding[], kind: HiddenFinding["kind"]): HiddenFinding[] {
  return findings.filter((finding) => finding.kind === kind);
}

/* Text spelled in tag characters, the way prompt smuggling hides it. */
function tagged(text: string): string {
  return Array.from(text, (character) =>
    String.fromCodePoint(0xe0000 + (character.codePointAt(0) ?? 0)),
  ).join("");
}

/* Bytes of UTF-8 text carried by variation selectors after a visible character. */
function selectors(text: string): string {
  return Array.from(new TextEncoder().encode(text), (byte) =>
    String.fromCodePoint(byte < 16 ? 0xfe00 + byte : 0xe0100 + byte - 16),
  ).join("");
}

describe("revealHtml", () => {
  it("finds the comment and the hidden password form on the GSMG page", () => {
    const findings = revealHtml(gsmg, { url: "https://gsmg.io/theseedisplanted" });

    expect(ofKind(findings, "comment")).toEqual([
      {
        kind: "comment",
        line: 13,
        element: "body",
        value: "Nice to see you around! Good luck little bunny hunter ;)",
      },
    ]);
    expect(ofKind(findings, "hidden")).toEqual([
      { kind: "hidden", line: 23, element: "div", reason: "display: none" },
    ]);
    expect(ofKind(findings, "field")).toEqual([
      {
        kind: "field",
        line: 24,
        element: "input",
        reason: "type=hidden, inside hidden div at line 23",
        name: "_token",
        value: "xq0K6y2tiigRgXSPeKoWeZIRhR0ucSeF2JQcpa9Y",
      },
      {
        kind: "field",
        line: 25,
        element: "input",
        reason: "type=password, inside hidden div at line 23",
        name: "password",
      },
      {
        kind: "field",
        line: 26,
        element: "input",
        reason: "type=submit, inside hidden div at line 23",
      },
    ]);
    expect(JSON.stringify(findings)).not.toMatch(/archive\.org|wayback|wombat/iu);
  });

  it.each([
    ["hidden attribute", "<p hidden>x</p>", "hidden attribute"],
    [
      "display none in a style rule",
      "<style>.s{display:none}</style><p class=s>x</p>",
      "display: none via .s",
    ],
    ["visibility", "<p style='visibility:hidden'>x</p>", "visibility: hidden"],
    ["a declaration with a comment in it", "<p style='display:/**/none'>x</p>", "display: none"],
    [
      "a screen stylesheet",
      "<style media='screen'>.s{display:none}</style><p class=s>x</p>",
      "display: none via .s",
    ],
    [
      "a stylesheet for anything but print",
      "<style media='not print'>.s{display:none}</style><p class=s>x</p>",
      "display: none via .s",
    ],
    ["opacity", "<p style='opacity:0.0'>x</p>", "opacity: 0.0"],
    ["font size", "<p style='font-size:0px'>x</p>", "font-size: 0px"],
    ["transparent text", "<p style='color:rgba(0,0,0,0)'>x</p>", "color: rgba(0,0,0,0)"],
    ["text indent", "<p style='text-indent:-9999px'>x</p>", "text-indent: -9999px"],
    ["off screen", "<p style='position:absolute;left:-10000px'>x</p>", "left: -10000px"],
    ["clip", "<p style='clip:rect(0 0 0 0)'>x</p>", "clip: rect(0 0 0 0)"],
    [
      "one pixel box",
      "<p style='width:1px;height:1px;overflow:hidden'>x</p>",
      "height: 1px, overflow: hidden",
    ],
    ["template", "<template><p>x</p></template>", "template content"],
    ["closed dialog", "<dialog><p>x</p></dialog>", "closed dialog"],
    ["popover", "<div popover>x</div>", "popover"],
    ["closed details", "<details><summary>Hint</summary>x</details>", "closed details"],
    [
      "a rule after a quoted comment",
      '<style>.a{content:"/*"} .s{display:none}</style><p class=s>x</p>',
      "display: none via .s",
    ],
    [
      "a rule after a quoted brace",
      '<style>.a{content:"}"} .s{display:none}</style><p class=s>x</p>',
      "display: none via .s",
    ],
    ["framework class", "<p class='d-none'>x</p>", "class d-none, a framework's hidden class"],
  ])("hides an element by %s", (_label, html, reason) => {
    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ kind: "hidden", reason, value: "x" }),
    ]);
  });

  it.each([
    ["a rule under @media print", "<style>@media print{.s{display:none}}</style><p class=s>x</p>"],
    ["an inline display over the hidden attribute", "<p hidden style='display:block'>x</p>"],
    [
      "an inline display over a hiding rule",
      "<style>.s{display:none}</style><p class=s style='display:block'>x</p>",
    ],
    ["half opacity", "<p style='opacity:.5'>x</p>"],
    ["an open dialog", "<dialog open>x</dialog>"],
    ["a print stylesheet", "<style media='print'>.s{display:none}</style><p class=s>x</p>"],
    [
      "a print stylesheet with a stray comma",
      "<style media='print,'>.s{display:none}</style><p class=s>x</p>",
    ],
    ["an open details", "<details open><summary>s</summary>x</details>"],
    ["a small negative margin", "<p style='text-indent:-2em'>x</p>"],
  ])("leaves %s in sight", (_label, html) => {
    expect(ofKind(revealHtml(html), "hidden")).toEqual([]);
  });

  it("lets a descendant undo inherited visibility, size or color", () => {
    const html = [
      "<div style='visibility:hidden'>gone <span style='visibility:visible'>back</span></div>",
      "<div style='font-size:0'>tiny <b style='font-size:16px'>big</b></div>",
      "<div style='display:none'>out <span style='display:block;visibility:visible'>still out</span></div>",
    ].join("\n");

    const hidden = ofKind(revealHtml(html), "hidden");

    expect(hidden.map(({ value }) => value)).toEqual(["gone", "tiny", "out still out"]);
  });

  it("keeps hiding a descendant whose value still follows the parent", () => {
    const html = [
      "<div style='color:transparent'>a<span style='color:inherit'>b</span></div>",
      "<div style='font-size:0'>c<b style='font-size:1em'>d</b></div>",
    ].join("\n");

    const hidden = ofKind(revealHtml(html), "hidden");

    expect(hidden.map(({ value }) => value)).toEqual(["ab", "cd"]);
  });

  it("still hides a descendant that undoes visibility but hides itself", () => {
    const html =
      "<div style='visibility:hidden'>a<span style='visibility:visible;display:none'>b</span></div>";

    const hidden = ofKind(revealHtml(html), "hidden");

    expect(hidden.map(({ reason, value }) => [reason, value])).toEqual([
      ["display: none", "b"],
      ["visibility: hidden", "a"],
    ]);
  });

  it("keeps a heading inside an open inline element, as the HTML parser does", () => {
    const hidden = ofKind(revealHtml("<h1 hidden>secret<span><h2>visible</h2>"), "hidden");

    expect(hidden).toEqual([expect.objectContaining({ value: "secretvisible" })]);
  });

  it("keeps an escaped quote inside a CSS string", () => {
    const html = String.raw`<div style="--x:'\';display:none;'">shown</div>`;

    expect(ofKind(revealHtml(html), "hidden")).toEqual([]);
  });

  it("shows only the first summary of closed details", () => {
    const html = "<details><summary>a</summary><summary>b</summary>c</details>";

    const hidden = ofKind(revealHtml(html), "hidden");

    expect(hidden).toEqual([expect.objectContaining({ reason: "closed details", value: "bc" })]);
  });

  it("ends a heading where the next one starts", () => {
    const hidden = ofKind(revealHtml("<h1 hidden>secret<h2>visible</h2>"), "hidden");

    expect(hidden).toEqual([expect.objectContaining({ value: "secret" })]);
  });

  it("ends a hidden paragraph where the next one starts", () => {
    const hidden = ofKind(revealHtml("<p hidden>gone<p>shown</p>"), "hidden");

    expect(hidden).toEqual([expect.objectContaining({ value: "gone" })]);
  });

  it("finds text in its background's color and names both colors", () => {
    const findings = revealHtml(
      [
        "<body bgcolor='#ffffff'>",
        "<span style='color:#fefefe'>white on white</span>",
        "<div style='background:#000'><i>black on black</i></div>",
        "<span style='color:#777'>gray on white</span>",
        "</body>",
      ].join("\n"),
    );

    expect(ofKind(findings, "camouflage")).toEqual([
      expect.objectContaining({
        line: 2,
        element: "span",
        reason: "#fefefe text from span on #ffffff from body",
        value: "white on white",
      }),
      expect.objectContaining({
        line: 3,
        reason: "#000000 text from the default text color on #000000 from div",
        value: "black on black",
      }),
    ]);
  });

  it("lets the later of background and background-color decide", () => {
    const later = "<span style='background-color:#000;background:#fff;color:#fff'>x</span>";
    const earlier = "<span style='background:#fff;background-color:#000;color:#fff'>y</span>";

    expect(ofKind(revealHtml(later), "camouflage")).toEqual([
      expect.objectContaining({ value: "x" }),
    ]);
    expect(ofKind(revealHtml(earlier), "camouflage")).toEqual([]);
  });

  it("keeps the default page under a print or disabled stylesheet and ignores words in url()", () => {
    const print = "<link rel=stylesheet media=print href=p.css><span style='color:#fff'>x</span>";
    const off = "<link rel=stylesheet disabled href=o.css><span style='color:#fff'>z</span>";
    const image = "<span style='background:url(red.png);color:red'>y</span>";

    expect(ofKind(revealHtml(print), "camouflage")).toEqual([
      expect.objectContaining({ value: "x" }),
    ]);
    expect(ofKind(revealHtml(image), "camouflage")).toEqual([]);
    expect(ofKind(revealHtml(off), "camouflage")).toEqual([
      expect.objectContaining({ value: "z" }),
    ]);
  });

  it("assumes no default colors once a stylesheet is linked", () => {
    const html = "<link rel=stylesheet href=a.css><span style='color:#fff'>maybe dark</span>";

    expect(ofKind(revealHtml(html), "camouflage")).toEqual([]);
  });

  it("keeps the rule after an @charset or @import statement", () => {
    const charset = `<style>@charset "utf-8"; .secret { display: none }</style><p class=secret>a</p>`;
    const imports = `<style>@import url("x;y.css"); .secret { display: none }</style><p class=secret>b</p>`;

    expect(ofKind(revealHtml(charset), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .secret", value: "a" }),
    ]);
    expect(ofKind(revealHtml(imports), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .secret", value: "b" }),
    ]);
  });

  it("cascades a linked sheet where the page links it, after the sheets it imports", () => {
    const url = "https://example.com/blog/post";
    const page = (order: string) =>
      `${order}<body><p class=secret>key</p><span class=quiet>white on white</span>`;
    const stylesheets = {
      "https://example.com/site.css": `@charset "UTF-8"; @import "theme.css"; .secret { display: none }`,
      "https://example.com/theme.css": "body { background: #fff } .quiet { color: #fff }",
    };
    const shown = "<style>.secret { display: block }</style>";
    const linked = "<link rel=stylesheet href=/site.css>";

    const after = revealHtml(page(shown + linked), { url, stylesheets });
    const before = revealHtml(page(linked + shown), { url, stylesheets });

    expect(ofKind(after, "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .secret", value: "key" }),
    ]);
    expect(ofKind(before, "hidden")).toEqual([]);
    expect(ofKind(after, "camouflage")).toEqual([
      expect.objectContaining({ reason: "#ffffff text from .quiet on #ffffff from body" }),
    ]);
  });

  it("ranks imported layers by their declared order, all below rules outside a layer", () => {
    const url = "https://example.com/";
    const stylesheets = {
      "https://example.com/high.css": ".a { display: block }",
      "https://example.com/low.css": ".a { display: none }",
      "https://example.com/kit.css": "p#b { display: none }",
    };
    const html = [
      "<style>.b { display: block }</style>",
      "<style>@layer low, high; @import 'high.css' layer(high); @import 'low.css' layer(low);",
      "@import 'kit.css' layer;</style>",
      "<p class=a>declared order</p><p id=b class=b>unlayered</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html, { url, stylesheets }), "hidden")).toEqual([]);
  });

  it("ranks layers in the order the imports reach them", () => {
    const url = "https://example.com/";
    const stylesheets = {
      "https://example.com/container.css": "@import 'x.css' layer(x);",
      "https://example.com/x.css": ".a { display: none }",
      "https://example.com/y.css": ".a { display: block }",
    };
    const html =
      "<style>@import 'container.css'; @import 'y.css' layer(y);</style><p class=a>y wins</p>";

    expect(ofKind(revealHtml(html, { url, stylesheets }), "hidden")).toEqual([]);
  });

  it("turns the layer order around for important declarations", () => {
    const url = "https://example.com/";
    const stylesheets = {
      "https://example.com/low.css": ".a { display: none !important }",
      "https://example.com/high.css": ".a { display: block !important }",
    };
    const html = [
      "<style>@layer low, high; @import 'low.css' layer(low); @import 'high.css' layer(high);</style>",
      "<style>.a { display: block !important }</style><p class=a>low wins</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html, { url, stylesheets }), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .a", value: "low wins" }),
    ]);
  });

  it("reads rules inside @layer blocks, the way Tailwind v4 ships them", () => {
    const html = [
      "<style>@layer theme, base, components, utilities;",
      "@layer components { .secret { display: none } .shown { display: none } }",
      "@layer utilities { .shown { display: block } }</style>",
      "<p class=secret>key</p><p class=shown>utilities win</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .secret", value: "key" }),
    ]);
  });

  it("ranks layer blocks in the order they first come up, all below rules outside a layer", () => {
    const html = [
      "<style>.b { display: block } @layer first { .a { display: block } }",
      "@layer second { .a { display: none } } @layer first { .a { display: block } .b { display: none } }</style>",
      "<p class=a>second wins</p><p class=b>unlayered</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .a", value: "second wins" }),
    ]);
  });

  it("puts a layer's own rules above the layers nested in it, and turns that around for important ones", () => {
    const html = [
      "<style>@layer outer { @layer inner { .a { display: block } .b { display: none !important } }",
      ".a { display: none } .b { display: block !important } }",
      "@layer outer.inner { .c { display: none } } @layer outer { .c { display: block } }</style>",
      "<p class=a>outer</p><p class=b>inner important</p><p class=c>dotted</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .a", value: "outer" }),
      expect.objectContaining({ reason: "display: none via .b", value: "inner important" }),
    ]);
  });

  it("keeps each anonymous layer block apart, the later one higher", () => {
    const html = [
      "<style>@layer { .a { display: block } .b { display: none } }",
      "@layer { .a { display: none } } .b { display: block }</style>",
      "<p class=a>second</p><p class=b>unlayered</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .a", value: "second" }),
    ]);
  });

  it("cascades a rule in a layer block the same as that rule imported into the layer", () => {
    const url = "https://example.com/";
    const theme = "@layer base { .a { display: block } } .a { display: none } .b { display: none }";
    const page = (styles: string) =>
      `<style>@layer low, theme; ${styles} @layer low { .b { display: block } }</style><p class=a>a</p><p class=b>b</p>`;
    const imported = revealHtml(page("@import 'theme.css' layer(theme);"), {
      url,
      stylesheets: { "https://example.com/theme.css": theme },
    });
    const inline = revealHtml(page(`@layer theme { ${theme} }`), { url });

    expect(ofKind(inline, "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .a", value: "a" }),
      expect.objectContaining({ reason: "display: none via .b", value: "b" }),
    ]);
    expect(ofKind(imported, "hidden")).toEqual(ofKind(inline, "hidden"));
  });

  it("nests a layer imported inside a layered sheet under that sheet's layer", () => {
    const url = "https://example.com/";
    const stylesheets = {
      "https://example.com/outer.css":
        "@import 'inner.css' layer(inner); .x { display: block !important }",
      "https://example.com/inner.css": ".x { display: none !important }",
    };
    const html = "<style>@import 'outer.css' layer(outer);</style><p class=x>inner important</p>";

    expect(ofKind(revealHtml(html, { url, stylesheets }), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .x", value: "inner important" }),
    ]);
  });

  it("applies no rules from a layer block whose name CSS rejects", () => {
    const html = [
      "<style>@layer a, b { .a { display: none } } @layer foo bar { .a { display: none } }",
      "@layer 1st { .a { display: none } } @layer a..b { .a { display: none } } @layer .a { .a { display: none } }",
      "@layer foo#bar { .a { display: none } }",
      "</style><p class=a>shown</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden")).toEqual([]);
  });

  it("reads a layer block that never closes in one pass", () => {
    const html = `<style>@layer a { ${"@x; ".repeat(300_000)}</style><p class=a>x</p>`;

    const started = performance.now();
    revealHtml(html);

    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("still reads rules from layers nested far deeper than any sheet needs", () => {
    const depth = 20_000;
    const nested = `${"@layer x { ".repeat(depth)}.a { display: none }${" }".repeat(depth)}`;
    const dotted = `@layer ${"x.".repeat(depth)}x { .c { display: none } }`;
    const html = `<style>${nested} ${dotted} @layer x { .b { display: none } }</style><p class=a>a</p><p class=b>b</p><p class=c>c</p>`;

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .a", value: "a" }),
      expect.objectContaining({ reason: "display: none via .b", value: "b" }),
      expect.objectContaining({ reason: "display: none via .c", value: "c" }),
    ]);
  });

  it("keeps a layer open past a brace in a quoted selector", () => {
    const html = `<style>@layer a { [data-x="}"] { display: block } .secret { display: none } }</style><p class=secret>key</p>`;

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .secret", value: "key" }),
    ]);
  });

  it("reads a layer name the way CSS spells identifiers, escapes and all", () => {
    const html = [
      "<style>@layer foo\\,bar { .comma { display: none } } @layer foo\\{bar { .brace { display: none } }",
      "@layer foo, bar; @layer \\66 oo { .x { display: none } } @layer bar { .x { display: block } }",
      "@layer a.b, z; @layer a\\.b { .y { display: none } } @layer z { .y { display: block } }",
      "@layer foo\\20, baz; @layer foo\\  { .z { display: none } } @layer baz { .z { display: block } }</style>",
      "<p class=comma>comma</p><p class=brace>brace</p><p class=x>escaped foo</p><p class=y>dot</p><p class=z>space</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .comma", value: "comma" }),
      expect.objectContaining({ reason: "display: none via .brace", value: "brace" }),
      expect.objectContaining({ reason: "display: none via .y", value: "dot" }),
    ]);
  });

  it("keeps an escaped space at the end of an imported layer's name", () => {
    const url = "https://example.com/";
    const stylesheets = {
      "https://example.com/x.css": ".x { display: none }",
      "https://example.com/y.css": ".x { display: block }",
    };
    const html =
      "<style>@layer foo\\ , bar; @import 'x.css' layer(foo\\ ); @import 'y.css' layer(bar);</style><p class=x>bar wins</p>";

    expect(ofKind(revealHtml(html, { url, stylesheets }), "hidden")).toEqual([]);
  });

  it("knows @layer by its decoded at-keyword, not by its first five letters", () => {
    const html = [
      "<style>@l\\61 yer a { .escaped { display: none } } @layeré { .accent { display: none } }</style>",
      "<p class=escaped>escaped</p><p class=accent>other at-rule</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .escaped", value: "escaped" }),
    ]);
  });

  it("reads rules inside an @media block that holds on any screen", () => {
    const html = [
      "<style>@media screen { .a { display: none } } @MEDIA all { .b { display: none } }",
      "@media print, screen { .c { display: none } } @media { .d { display: none } }",
      "@media only screen { .e { display: none } } @media not print { .f { display: none } }",
      "@media print { .g { display: none } } @media (min-width: 600px) { .h { display: none } }",
      "@media screen and (min-width: 600px) { .i { display: none } } @media print, { .j { display: none } }",
      "@media not screen { .k { display: none } } @media only { .l { display: none } }",
      "@media (example, all,), speech { .m { display: none } }</style>",
      "<p class=a>a</p><p class=b>b</p><p class=c>c</p><p class=d>d</p><p class=e>e</p><p class=f>f</p>",
      "<p class=g>g</p><p class=h>h</p><p class=i>i</p><p class=j>j</p><p class=k>k</p><p class=l>l</p>",
      "<p class=m>speech</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden").map(({ value }) => value)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });

  it("cascades @media rules in source order with the rules around them", () => {
    const html = [
      "<style>.a { display: none } @media screen { .a { display: block } .b { display: block } }",
      ".b { display: none }</style><p class=a>media wins</p><p class=b>later wins</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .b", value: "later wins" }),
    ]);
  });

  it("files @media rules under the layer around them, and layers inside under their own", () => {
    const html = [
      "<style>@layer low, high; @layer high { @media screen { .a { display: block } } }",
      "@layer low { .a { display: none } } @media screen { @layer low { .b { display: block } } }",
      "@layer high { .b { display: none } }</style><p class=a>high shows</p><p class=b>high hides</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .b", value: "high hides" }),
    ]);
  });

  it("skips a print block inside a screen block and reads on after it", () => {
    const html = [
      "<style>@media screen { @media print { .a { display: none } } .b { display: none } }",
      ".c { display: none }</style><p class=a>print</p><p class=b>b</p><p class=c>c</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .b", value: "b" }),
      expect.objectContaining({ reason: "display: none via .c", value: "c" }),
    ]);
  });

  it("reads @media blocks in a linked sheet too", () => {
    const url = "https://example.com/";
    const stylesheets = {
      "https://example.com/site.css": "@media screen { .secret { display: none } }",
    };
    const html = "<link rel=stylesheet href=site.css><p class=secret>key</p>";

    expect(ofKind(revealHtml(html, { url, stylesheets }), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .secret", value: "key" }),
    ]);
  });

  it("reads an @media block that never closes in one pass", () => {
    const html = `<style>@media screen { ${"@x; ".repeat(300_000)}</style><p class=a>x</p>`;

    const started = performance.now();
    revealHtml(html);

    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("decodes a media type the way CSS reads identifiers, and keeps layer out of it", () => {
    const html = [
      "<style>@media \\73 creen { .a { display: none } } @media \\6e ot print { .b { display: none } }",
      "@media \\73creen { .c { display: none } } @media not layer { .d { display: none } }</style>",
      "<style media='not \\70 rint'>.e { display: none }</style>",
      "<p class=a>a</p><p class=b>b</p><p class=c>hex runs on</p><p class=d>layer</p><p class=e>e</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden").map(({ value }) => value)).toEqual(["a", "b", "e"]);
  });

  it("keeps commas and parentheses inside a quoted string out of the media list", () => {
    const html = [
      `<style>@media (foo: "),screen,(") { .a { display: none } } @media (foo: "a,b"), screen { .b { display: none } }</style>`,
      "<p class=a>quoted</p><p class=b>screen after</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden").map(({ value }) => value)).toEqual(["screen after"]);
  });

  it("splits media queries and layer names at CSS whitespace, never at a no-break space", () => {
    const space = String.fromCodePoint(0xa0);
    const html = [
      `<style>@media not${space}print { .a { display: none } } @media screen${space} { .b { display: none } }`,
      `@layer a${space}b { .c { display: none } } @media not print and (min-width: 600px) { .d { display: none } }</style>`,
      "<p class=a>one word</p><p class=b>trailing</p><p class=c>layer</p><p class=d>condition</p>",
    ].join("\n");

    expect(ofKind(revealHtml(html), "hidden").map(({ value }) => value)).toEqual(["layer"]);
  });

  it("reads a layer name that opens with a hex escape", () => {
    const html = "<style>@layer \\66 oo { .a { display: none } }</style><p class=a>escaped foo</p>";

    expect(ofKind(revealHtml(html), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .a", value: "escaped foo" }),
    ]);
  });

  it("turns down a name of hex escapes that never ends well in one pass", () => {
    const name = `a${"\\abcdef".repeat(200)}!`;
    const html = `<style>@layer ${name} { .a { display: none } } @media ${name} { .a { display: none } }</style>`;

    const started = performance.now();
    revealHtml(`${html}<link rel=stylesheet media='${name}' href=a.css><p class=a>a</p>`);

    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("applies untitled sheets and the first titled set only", () => {
    const html = [
      "<link rel=stylesheet title=Light href=light.css><link rel=stylesheet title=Dark href=dark.css>",
      "<link rel=stylesheet href=base.css><style title=Dark>.y { display: none }</style>",
      "<style title=Light>.z { display: none }</style><p class=y>dark only</p><p class=z>light</p>",
    ].join("\n");
    const findings = revealHtml(html, { url: "https://example.com/" });

    expect(linkedStylesheets(html, { url: "https://example.com/" })).toEqual([
      "https://example.com/light.css",
      "https://example.com/base.css",
    ]);
    expect(ofKind(findings, "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .z", value: "light" }),
    ]);
  });

  it("applies nothing from inside a template until a script clones it", () => {
    const url = "https://example.com/";
    const html = [
      "<template><base href=https://cdn.example/><style title=Other>.a { display: none }</style>",
      "<link rel=stylesheet href=t.css><template></template><style>.b { display: none }</style></template>",
      "<template><svg></template><style title=Main>.c { display: none }</style>",
      "<link rel=stylesheet href=page.css>",
      "</svg><svg><template><style>.d { display: none }</style></template></svg>",
      "<svg/><template><style>.e { display: none }</style></template>",
      "<template/><style>.f { display: none }</style></template>",
      "<template><svg><template/></template><style>.g { display: none }</style>",
      "<p class=a>a</p><p class=b>b</p><p class=c>c</p><p class=d>d</p><p class=e>e</p>",
      "<p class=f>f</p><p class=g>g</p>",
    ].join("\n");
    const unstyled = [
      "</template><template><link rel=stylesheet href=t.css><style>@import 'i.css';</style></template>",
      "<span style='color:#fff'>white</span>",
    ].join("");

    expect(linkedStylesheets(html, { url })).toEqual(["https://example.com/page.css"]);
    expect(ofKind(revealHtml(html, { url }), "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .c", value: "c" }),
      expect.objectContaining({ reason: "display: none via .d", value: "d" }),
      expect.objectContaining({ reason: "display: none via .g", value: "g" }),
    ]);
    expect(linkedStylesheets(unstyled, { url })).toEqual([]);
    expect(ofKind(revealHtml(unstyled), "camouflage")).toEqual([
      expect.objectContaining({ value: "white" }),
    ]);
  });

  it("tracks templates nested far deeper than any page needs in one pass", () => {
    const deep = `${"<template><svg>".repeat(16_000)}${"</template>".repeat(16_000)}`;
    const html = `${deep}<style>.a { display: none }</style><p class=a>x</p>`;

    const started = performance.now();
    const findings = revealHtml(html);

    expect(performance.now() - started).toBeLessThan(3_000);
    expect(ofKind(findings, "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .a", value: "x" }),
    ]);
  });

  it("names the sheets a screen applies, each once, and ends an import cycle", () => {
    const html = [
      "<link rel=stylesheet href=a.css><link rel='alternate stylesheet' href=alt.css>",
      "<link rel=stylesheet media=print href=print.css><link rel=stylesheet href=a.css>",
      "<link rel=stylesheet href=off.css disabled><link rel=stylesheet type=text/less href=x.less>",
      "<link rel=stylesheet type='text/css; charset=utf-8' href=typed.css>",
      "<style>@import 'b.css' screen; @import url(p.css) print; @import 'l.css' layer(theme);",
      "@import url(s.css) supports(selector(:has(a))) screen; @import 'q.css' layer supports(display: grid) print;",
      "p {} @import 'late.css';</style>",
    ].join("\n");
    const stylesheets = {
      "https://example.com/a.css": "@import 'c.css';",
      "https://example.com/c.css": "@import 'a.css'; .x { display: none }",
    };

    expect(linkedStylesheets(html, { url: "https://example.com/" })).toEqual([
      "https://example.com/a.css",
      "https://example.com/typed.css",
      "https://example.com/b.css",
      "https://example.com/l.css",
      "https://example.com/s.css",
    ]);
    expect(linkedStylesheets(html, { url: "https://example.com/", stylesheets })).toEqual([
      "https://example.com/a.css",
      "https://example.com/c.css",
      "https://example.com/typed.css",
      "https://example.com/b.css",
      "https://example.com/l.css",
      "https://example.com/s.css",
    ]);
  });

  it("files a sheet that imports repeat a bounded number of times", () => {
    const stylesheets: Record<string, string> = {};
    for (let index = 0; index < 9; index += 1) {
      stylesheets[`https://example.com/${index}.css`] = `@import '${index + 1}.css';`.repeat(100);
    }
    stylesheets["https://example.com/9.css"] = ".secret { display: none }";
    const html = "<link rel=stylesheet href=0.css><p class=secret>key</p>";

    const started = performance.now();
    const findings = revealHtml(html, { url: "https://example.com/", stylesheets });

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(ofKind(findings, "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .secret", value: "key" }),
    ]);
  });

  it("spells out invisible characters and what they carry", () => {
    const html = [
      `<p>zero${ZWSP}width</p>`,
      `<p>a${tagged("hi there")}b</p>`,
      `<p>x${selectors("key")}y</p>`,
      `<p>&#8203;encoded</p>`,
    ].join("\n");

    const invisible = ofKind(revealHtml(html), "invisible");

    expect(invisible.map(({ line, codePoints }) => [line, codePoints?.[0]])).toEqual([
      [1, "U+200B"],
      [2, "U+E0068"],
      [3, "U+E015B"],
      [4, "U+200B"],
    ]);
    expect(invisible[0]?.value).toBe("zero⟨U+200B⟩width");
    expect(invisible[1]?.reason).toBe('tag characters spell "hi there"');
    expect(invisible[2]?.reason).toBe('variation selectors carry "key"');
  });

  it("decodes a numeric reference without its semicolon, as browsers do", () => {
    const invisible = ofKind(revealHtml("<p>key&#8203word and &#x200Cmore</p>"), "invisible");

    expect(invisible.map(({ codePoints }) => codePoints?.[0])).toEqual(["U+200B", "U+200C"]);
  });

  it("decodes a legacy name without its semicolon in text, not before a letter in an attribute", () => {
    const invisible = ofKind(revealHtml("<p data-k='a&shyb'>x&shyword</p>"), "invisible");

    expect(invisible.map(({ element, codePoints }) => [element, codePoints?.[0]])).toEqual([
      ["p", "U+00AD"],
    ]);
    expect(invisible[0]?.value).toBe("x⟨U+00AD⟩word");
  });

  it("decodes the named aliases of a zero width space", () => {
    const invisible = ofKind(
      revealHtml("<p>a&NegativeMediumSpace;b&NegativeVeryThinSpace;c</p>"),
      "invisible",
    );

    expect(invisible.map(({ codePoints }) => codePoints?.[0])).toEqual(["U+200B", "U+200B"]);
  });

  it("reports a byte order mark anywhere but the opening of the source", () => {
    const invisible = ofKind(revealHtml(`<p>x</p><p>${BOM}secret</p>`), "invisible");

    expect(invisible.map(({ codePoints }) => codePoints?.[0])).toEqual(["U+FEFF"]);
  });

  it("leaves the joiners text needs and an opening byte order mark alone", () => {
    const html = `${BOM}<p>family 👨${ZWJ}👩${ZWJ}👧 and می${ZWNJ}خواهم</p>`;

    expect(ofKind(revealHtml(html), "invisible")).toEqual([]);
  });

  it("counts a repeated attribute once and skips the ones pages use openly", () => {
    const html = [
      "<div data-key='abc' foo='bar' aria-label='x' onclick='go()' v-if='y' :class='z'>",
      "<span data-v-1>a</span><span data-v-1>b</span><span data-v-1>c</span>",
      "<svg viewBox='0 0 1 1'><path d='M0 0' fill='red'/></svg>",
      "</div>",
    ].join("\n");

    const attributes = ofKind(revealHtml(html), "attribute");

    expect(attributes).toEqual([
      { kind: "attribute", line: 1, element: "div", name: "data-key", value: "abc" },
      {
        kind: "attribute",
        line: 1,
        element: "div",
        name: "foo",
        reason: "nonstandard",
        value: "bar",
      },
      { kind: "attribute", line: 2, element: "span", name: "data-v-1", count: 3 },
    ]);
  });

  it("resolves links and scripts against the page and its base", () => {
    const html = [
      "<head><base href='https://cdn.example.net/assets/'>",
      "<meta property='og:title' content='Title'><meta charset=utf-8>",
      "<link rel='icon' href='favicon.ico'><link rel='stylesheet' href='/site.css'>",
      "<script src='app.js'></script><script type='text/template'>  <b>{{x}}</b> </script>",
      "<style>p { color: red }</style></head>",
    ].join("\n");

    const findings = revealHtml(html, { url: "https://example.com/page" });

    expect(ofKind(findings, "meta")).toEqual([
      { kind: "meta", line: 2, name: "og:title", value: "Title" },
      { kind: "meta", line: 2, name: "charset", value: "utf-8" },
    ]);
    expect(ofKind(findings, "link")).toEqual([
      { kind: "link", line: 1, name: "base", value: "https://cdn.example.net/assets/" },
      { kind: "link", line: 3, name: "icon", value: "https://cdn.example.net/assets/favicon.ico" },
    ]);
    expect(ofKind(findings, "script")).toEqual([
      {
        kind: "script",
        line: 4,
        element: "script",
        value: "https://cdn.example.net/assets/app.js",
      },
      {
        kind: "script",
        line: 4,
        element: "script",
        reason: "type=text/template",
        value: "<b>{{x}}</b>",
        size: 12,
      },
    ]);
    expect(ofKind(findings, "style")).toEqual([
      { kind: "style", line: 3, name: "stylesheet", value: "https://cdn.example.net/site.css" },
      { kind: "style", line: 5, element: "style", value: "p { color: red }", size: 16 },
    ]);
  });

  it.each([
    ["an unclosed tag", "<a ".repeat(60_000)],
    ["a deep stack", `<p><table>${"<div>".repeat(50_000)}${"</x>".repeat(50_000)}`],
    [
      "thousands of rules",
      `<style>${Array.from({ length: 10_000 }, (_, i) => `.c${i}{color:red}`).join("")}</style>${"<p class=c1>x</p>".repeat(10_000)}`,
    ],
    ["an unclosed rgb()", `<p style="background:${"rgb(".repeat(60_000)}">x</p>`],
    ["unclosed CSS comments", `<style>${"/*".repeat(60_000)}</style>`],
  ])("stays linear on %s", (_label, html) => {
    const started = performance.now();
    revealHtml(html);

    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("keeps a processing instruction that is not the XML declaration as a comment", () => {
    const html = '<?xml version="1.0"?><?xml-stylesheet href="a.xsl"?><p>x</p>';

    expect(ofKind(revealHtml(html), "comment").map(({ value }) => value)).toEqual([
      'xml-stylesheet href="a.xsl"?',
    ]);
  });

  it("reads comments a browser keeps, and markup that breaks off", () => {
    const findings = revealHtml("<!--a--><!-->b<?php echo 1 ?><![CDATA[c]]></><div title='open");

    expect(ofKind(findings, "comment").map(({ value }) => value)).toEqual([
      "a",
      "",
      "php echo 1 ?",
      "[CDATA[c]]",
    ]);
  });
});

/* One answer of the test server. */
interface Reply {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Buffer;
  /* Never answer, like a server that stalls. */
  readonly hang?: boolean;
  /* Answer this many milliseconds late. */
  readonly delay?: number;
}

const html = { "Content-Type": "text/html" };
const css = { "Content-Type": "text/css; charset=utf-8" };

describe("revealUrl", () => {
  /* What a path answers on its first, second and later hits; the last reply repeats. */
  const routes = new Map<string, readonly Reply[]>();
  const hits = new Map<string, number>();
  /* Requests open right now, and the most that were open at once. */
  const load = { open: 0, peak: 0 };
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    const hit = (hits.get(path) ?? 0) + 1;
    hits.set(path, hit);
    const replies = routes.get(path) ?? [{ status: 404 }];
    const reply = replies[Math.min(hit, replies.length) - 1] ?? { status: 404 };
    if (reply.hang === true) return;
    load.open += 1;
    load.peak = Math.max(load.peak, load.open);
    setTimeout(() => {
      load.open -= 1;
      response.writeHead(reply.status, reply.headers).end(reply.body);
    }, reply.delay ?? 0);
  });
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    routes.clear();
    hits.clear();
    load.peak = 0;
  });

  /* Every name resolves to this machine, so a URL with the test server's port reaches it. */
  function resolveHere(): void {
    vi.mocked(lookup).mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
  }

  it("reads a Wayback capture as archived, without the toolbar", async () => {
    resolveHere();
    const archived = "/web/20260418153806id_/https://gsmg.io/theseedisplanted";
    routes.set(archived, [{ status: 200, headers: html, body: gsmg }]);
    const port = new URL(base).port;

    const result = await revealUrl(
      `http://web.archive.org:${port}/web/20260418153806/https://gsmg.io/theseedisplanted`,
      { allowPrivateNetwork: true },
    );

    expect(hits.get(archived)).toBe(1);
    expect(result).toMatchObject({
      source: `http://web.archive.org:${port}${archived}`,
      archive: "wayback",
      bytes: 1_585,
    });
    expect(ofKind(result.findings, "comment")[0]?.value).toBe(
      "Nice to see you around! Good luck little bunny hunter ;)",
    );
    expect(ofKind(result.findings, "link")).toEqual([]);
    expect(ofKind(result.findings, "script")[0]?.value).toMatch(
      /^https:\/\/static\.cloudflareinsights\.com\//u,
    );
  });

  it("reads a capture's stylesheets from the same capture", async () => {
    resolveHere();
    const stamp = "/web/20260418153806id_";
    routes.set(`${stamp}/https://example.com/`, [
      { status: 200, headers: html, body: "<link rel=stylesheet href=/s.css><p class=x>old</p>" },
    ]);
    routes.set(`${stamp}/https://example.com/s.css`, [
      { status: 200, headers: css, body: ".x { display: none }" },
    ]);
    const port = new URL(base).port;

    const result = await revealUrl(
      `http://web.archive.org:${port}/web/20260418153806/https://example.com/`,
      { allowPrivateNetwork: true },
    );

    expect(result.stylesheets).toEqual(["https://example.com/s.css"]);
    expect(ofKind(result.findings, "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .x", value: "old" }),
    ]);
  });

  it("drops a capture's stylesheet that redirects out to the live site", async () => {
    resolveHere();
    const port = new URL(base).port;
    const stamp = "/web/20260418153806id_";
    routes.set(`${stamp}/https://example.com/`, [
      { status: 200, headers: html, body: "<link rel=stylesheet href=s.css><p class=x>old</p>" },
    ]);
    routes.set(`${stamp}/https://example.com/s.css`, [
      { status: 302, headers: { Location: `http://example.com:${port}/s.css` } },
    ]);
    routes.set("/s.css", [{ status: 200, headers: css, body: ".x { display: none }" }]);

    const result = await revealUrl(
      `http://web.archive.org:${port}/web/20260418153806/https://example.com/`,
      { allowPrivateNetwork: true },
    );

    expect(hits.get("/s.css")).toBe(1);
    expect(result.stylesheets).toBeUndefined();
    expect(ofKind(result.findings, "hidden")).toEqual([]);
  });

  it("resolves a capture that redirects against the page it lands on", async () => {
    resolveHere();
    const stamp = "/web/20260418153806id_";
    routes.set(`${stamp}/https://example.com/`, [
      { status: 302, headers: { Location: "/web/20260418160000id_/https://example.com/blog/" } },
    ]);
    routes.set("/web/20260418160000id_/https://example.com/blog/", [
      { status: 200, headers: html, body: "<link rel=stylesheet href=s.css><p class=x>old</p>" },
    ]);
    routes.set("/web/20260418160000id_/https://example.com/blog/s.css", [
      { status: 200, headers: css, body: ".x { display: none }" },
    ]);
    const port = new URL(base).port;

    const result = await revealUrl(
      `http://web.archive.org:${port}/web/20260418153806/https://example.com/`,
      { allowPrivateNetwork: true },
    );

    expect(result.stylesheets).toEqual(["https://example.com/blog/s.css"]);
    expect(ofKind(result.findings, "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .x", value: "old" }),
    ]);
  });

  it("refuses a host that resolves to the machine itself", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "::1", family: 6 }] as never);

    await expect(revealUrl("http://localhost:3000/")).rejects.toThrow(
      "localhost resolves to ::1, a private network address; reveal reads public pages only",
    );
  });

  it("checks the address the connection actually uses, not an earlier answer", async () => {
    resolveHere();
    routes.set("/", [{ status: 200, headers: html, body: "<!-- inside -->" }]);

    await expect(revealUrl(`http://rebind.test:${new URL(base).port}/`)).rejects.toThrow(
      "rebind.test resolves to 127.0.0.1, a private network address; reveal reads public pages only",
    );
    expect(hits.get("/")).toBeUndefined();
  });

  it("vets every connection, never a pooled socket from an earlier reveal", async () => {
    resolveHere();
    routes.set("/", [{ status: 200, headers: html, body: "<!-- inside -->" }]);
    const url = `http://pool.test:${new URL(base).port}/`;

    await revealUrl(url, { allowPrivateNetwork: true });

    await expect(revealUrl(url)).rejects.toThrow(PrivateAddressError);
    expect(hits.get("/")).toBe(1);
  });

  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.8/",
    "http://192.168.1.1/",
    "http://2130706433/",
    "http://[64:ff9b:1::a00:8]/",
  ])("refuses %s before any request", async (url) => {
    await expect(revealUrl(url)).rejects.toThrow(PrivateAddressError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "  ",
    "example.com",
    "ftp://example.com/",
    "javascript:alert(1)",
    "data:text/html,x",
  ])("refuses %j as a page URL", async (url) => {
    await expect(revealUrl(url)).rejects.toThrow(InvalidPageUrlError);
  });

  it("decodes the charset the page declares", async () => {
    const latin = Buffer.concat([
      Buffer.from("<meta charset=windows-1252><!-- caf"),
      Buffer.from([0xe9]),
      Buffer.from(" -->"),
    ]);
    routes.set("/latin", [{ status: 200, headers: html, body: latin }]);

    const result = await revealUrl(`${base}/latin`, { allowPrivateNetwork: true });

    expect(ofKind(result.findings, "comment")[0]?.value).toBe("café");
  });

  it("scans the start of a page longer than maxBytes", async () => {
    const page = `<!-- first -->${"x".repeat(5_000)}<!-- past the limit -->`;
    routes.set("/long", [{ status: 200, headers: html, body: page }]);

    const result = await revealUrl(`${base}/long`, { allowPrivateNetwork: true, maxBytes: 1_000 });

    expect(result).toMatchObject({ bytes: 1_000, partial: true });
    expect(ofKind(result.findings, "comment").map(({ value }) => value)).toEqual(["first"]);
  });

  it("calls a page exactly maxBytes long whole", async () => {
    routes.set("/exact", [{ status: 200, headers: html, body: `<!--${"x".repeat(993)}-->` }]);

    const result = await revealUrl(`${base}/exact`, { allowPrivateNetwork: true, maxBytes: 1_000 });

    expect(result.bytes).toBe(1_000);
    expect(result.partial).toBeUndefined();
  });

  it("follows a redirect and tries again after a 503", async () => {
    routes.set("/moved", [{ status: 301, headers: { Location: "/flaky" } }]);
    routes.set("/flaky", [
      { status: 503, headers: html, body: "<title>Down</title>" },
      { status: 200, headers: html, body: "<!--up-->" },
    ]);

    const result = await revealUrl(`${base}/moved`, { allowPrivateNetwork: true });

    expect(result.source).toBe(`${base}/flaky`);
    expect(hits.get("/flaky")).toBe(2);
    expect(ofKind(result.findings, "comment")[0]?.value).toBe("up");
  });

  it("names the page's title when the server answers with an error", async () => {
    routes.set("/gone", [
      { status: 404, headers: html, body: "<title>Not Found</title><p>long page</p>" },
    ]);

    const failure = revealUrl(`${base}/gone`, { allowPrivateNetwork: true });

    await expect(failure).rejects.toThrow(HTTPError);
    await expect(failure).rejects.toThrow(
      /^HTTP 404: http:\/\/127\.0\.0\.1:\d+\/gone: Not Found$/u,
    );
  });

  it("refuses a page that is not markup or text", async () => {
    routes.set("/image", [
      { status: 200, headers: { "Content-Type": "image/png" }, body: Buffer.alloc(64) },
    ]);

    await expect(revealUrl(`${base}/image`, { allowPrivateNetwork: true })).rejects.toThrow(
      UnreadablePageError,
    );
  });

  it.each(["application/xml", "image/svg+xml", "application/xhtml+xml"])(
    "reads %s as text, not HTML",
    async (type) => {
      routes.set("/feed", [
        {
          status: 200,
          headers: { "Content-Type": type },
          body: `<root><![CDATA[shown]]><!-- note --><a/>key${ZWSP}word</root>`,
        },
      ]);

      const result = await revealUrl(`${base}/feed`, { allowPrivateNetwork: true });

      expect(result.findings.map(({ kind }) => kind)).toEqual(["invisible"]);
    },
  );

  it("reads an untyped body that opens with an element as HTML", async () => {
    routes.set("/untyped", [{ status: 200, body: "<div hidden>secret</div>" }]);

    const result = await revealUrl(`${base}/untyped`, { allowPrivateNetwork: true });

    expect(ofKind(result.findings, "hidden")).toEqual([
      expect.objectContaining({ value: "secret" }),
    ]);
  });

  it("applies linked and imported stylesheets and skips the ones a browser would drop", async () => {
    const page = [
      "<link rel=stylesheet href=/site.css><link rel=stylesheet href=/gone.css>",
      "<link rel=stylesheet href=/page.css>",
      "<body><p class=secret>key</p><span class=quiet>white on white</span>",
    ].join("\n");
    routes.set("/", [{ status: 200, headers: html, body: page }]);
    routes.set("/site.css", [
      { status: 200, headers: css, body: "@import 'theme.css'; .secret { display: none }" },
    ]);
    routes.set("/theme.css", [
      { status: 200, headers: css, body: "body { background: #fff } .quiet { color: #fff }" },
    ]);
    routes.set("/page.css", [{ status: 200, headers: html, body: ".quiet { color: #000 }" }]);

    const result = await revealUrl(`${base}/`, { allowPrivateNetwork: true });

    expect(result.stylesheets).toEqual([`${base}/site.css`, `${base}/theme.css`]);
    expect(ofKind(result.findings, "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .secret", value: "key" }),
    ]);
    expect(ofKind(result.findings, "camouflage")).toEqual([
      expect.objectContaining({ value: "white on white" }),
    ]);
  });

  it("loads stylesheets no more at once than concurrency allows", async () => {
    const links = ["a", "b", "c"].map((name) => `<link rel=stylesheet href=/${name}.css>`);
    routes.set("/", [{ status: 200, headers: html, body: links.join("") }]);
    for (const name of ["a", "b", "c"]) {
      routes.set(`/${name}.css`, [{ status: 200, headers: css, body: "p {}", delay: 30 }]);
    }

    const result = await revealUrl(`${base}/`, { allowPrivateNetwork: true, concurrency: 1 });

    expect(result.stylesheets).toHaveLength(3);
    expect(load.peak).toBe(1);
  });

  it("resolves a redirected stylesheet's imports against where it landed", async () => {
    const page = "<link rel=stylesheet href=/style.css><p class=secret>key</p>";
    routes.set("/", [{ status: 200, headers: html, body: page }]);
    routes.set("/style.css", [{ status: 302, headers: { Location: "/assets/v2/style.css" } }]);
    routes.set("/assets/v2/style.css", [
      { status: 200, headers: css, body: "@import 'theme.css';" },
    ]);
    routes.set("/assets/v2/theme.css", [
      { status: 200, headers: css, body: ".secret { display: none }" },
    ]);

    const result = await revealUrl(`${base}/`, { allowPrivateNetwork: true });

    expect(result.stylesheets).toEqual([`${base}/style.css`, `${base}/assets/v2/theme.css`]);
    expect(ofKind(result.findings, "hidden")).toEqual([
      expect.objectContaining({ reason: "display: none via .secret", value: "key" }),
    ]);
  });

  it("reads at most ten stylesheets for one page", async () => {
    const links = Array.from(
      { length: 12 },
      (_, index) => `<link rel=stylesheet href=/${index}.css>`,
    );
    routes.set("/", [{ status: 200, headers: html, body: links.join("") }]);
    for (let index = 0; index < 12; index += 1) {
      routes.set(`/${index}.css`, [
        { status: 200, headers: css, body: `@import '${index}-more.css';` },
      ]);
    }

    const result = await revealUrl(`${base}/`, { allowPrivateNetwork: true });

    expect(result.stylesheets).toHaveLength(10);
    expect(hits.get("/10.css")).toBeUndefined();
    expect(hits.get("/0-more.css")).toBeUndefined();
  });

  it("stops at the caller's abort while a stylesheet stalls", async () => {
    routes.set("/", [{ status: 200, headers: html, body: "<link rel=stylesheet href=/slow.css>" }]);
    routes.set("/slow.css", [{ status: 200, hang: true }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("enough")), 200);

    await expect(
      revealUrl(`${base}/`, { allowPrivateNetwork: true, signal: controller.signal }),
    ).rejects.toThrow("enough");
    expect(hits.get("/slow.css")).toBe(1);
  });

  it("looks for invisible characters in a text file without parsing it as HTML", async () => {
    routes.set("/notes.txt", [
      {
        status: 200,
        headers: { "Content-Type": "text/plain" },
        body: `<!-- not a comment -->\nkey${ZWSP}word`,
      },
    ]);

    const result = await revealUrl(`${base}/notes.txt`, { allowPrivateNetwork: true });

    expect(result.findings).toEqual([
      expect.objectContaining({ kind: "invisible", line: 2, codePoints: ["U+200B"] }),
    ]);
  });
});

describe("web_reveal", () => {
  const reveal = webTools()[3];

  /* What the tool shows for a page, without the network. */
  function answer(page: string, maxChars = 20_000): ReturnType<typeof revealAnswer> {
    const findings = revealHtml(page, { url: "https://gsmg.io/theseedisplanted" });
    const result = {
      url: "https://gsmg.io/theseedisplanted",
      source: "https://gsmg.io/theseedisplanted",
      contentType: "text/html",
      bytes: new TextEncoder().encode(page).length,
      findings,
    };
    return revealAnswer(result, maxChars);
  }

  it("lists the findings by kind under a header", () => {
    const { text, result } = answer(gsmg);

    expect(text).toContain(
      "[reveal] https://gsmg.io/theseedisplanted\ntext/html · 1,585 bytes\nFound 1 comment, 1 hidden element, 3 form fields, 1 attribute, 6 meta tags, 1 script\n",
    );
    expect(text).toContain(
      "Comments\n  line 13 in body: Nice to see you around! Good luck little bunny hunter ;)",
    );
    expect(text).toContain("Hidden elements\n  line 23 div (display: none): (no text)");
    expect(text).toContain(
      "  line 25 input password (type=password, inside hidden div at line 23)",
    );
    expect(Value.Check(reveal.output as TSchema, { result })).toBe(true);
  });

  it("stops at maxChars and says what it left out", () => {
    const page = Array.from({ length: 50 }, (_, index) => `<!-- comment ${index} -->`).join("\n");

    const { text, result } = answer(page, 400);

    expect(Array.from(text).length).toBeLessThanOrEqual(400 + 120);
    expect(result.findings.length + (result.omitted ?? 0)).toBe(50);
    expect(text).toContain(
      `[truncated: left out ${result.omitted} comments; raise maxChars above 400 to list them]`,
    );
  });

  it("cuts a first finding too long for the answer instead of showing nothing", () => {
    const { result } = answer(`<!-- ${"a".repeat(5_000)} -->`, 1_000);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.size).toBe(5_000);
    expect(result.findings[0]?.value?.length).toBeLessThan(1_000);
  });

  it("counts a value in code points, so emoji that fit stay whole", () => {
    const emoji = "🐰".repeat(300);

    const { text, result } = answer(`<!-- ${emoji} -->`, 500);

    expect(result.findings[0]?.value).toBe(emoji);
    expect(result.truncated).toBeUndefined();
    expect(text).toContain(emoji);
  });

  it("keeps terminal controls from the page out of the answer", () => {
    const escape = String.fromCodePoint(0x1b);
    const override = String.fromCodePoint(0x202e);

    const { text } = answer(`<!-- ${escape}[31mred${override}reversed -->`);

    expect(text.includes(escape) || text.includes(override)).toBe(false);
    expect(text).toContain("red⟨U+202E⟩reversed");
  });

  it("refuses a private address before the page is read", async () => {
    expect(reveal.name).toBe("web_reveal");
    await expect(reveal.execute({ url: "http://169.254.169.254/" }, {})).rejects.toThrow(
      "169.254.169.254 is a private network address; reveal reads public pages only",
    );
  });
});
