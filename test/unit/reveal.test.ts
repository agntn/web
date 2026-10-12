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
import { revealHtml, revealUrl, type HiddenFinding } from "../../src/core/reveal.ts";
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

  it("shows only the first summary of closed details", () => {
    const html = "<details><summary>a</summary><summary>b</summary>c</details>";

    const hidden = ofKind(revealHtml(html), "hidden");

    expect(hidden).toEqual([expect.objectContaining({ reason: "closed details", value: "bc" })]);
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

  it("assumes no default colors once a stylesheet is linked", () => {
    const html = "<link rel=stylesheet href=a.css><span style='color:#fff'>maybe dark</span>";

    expect(ofKind(revealHtml(html), "camouflage")).toEqual([]);
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
}

const html = { "Content-Type": "text/html" };

describe("revealUrl", () => {
  /* What a path answers on its first, second and later hits; the last reply repeats. */
  const routes = new Map<string, readonly Reply[]>();
  const hits = new Map<string, number>();
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    const hit = (hits.get(path) ?? 0) + 1;
    hits.set(path, hit);
    const replies = routes.get(path) ?? [{ status: 404 }];
    const reply = replies[Math.min(hit, replies.length) - 1] ?? { status: 404 };
    response.writeHead(reply.status, reply.headers).end(reply.body);
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

  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.8/",
    "http://192.168.1.1/",
    "http://2130706433/",
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
