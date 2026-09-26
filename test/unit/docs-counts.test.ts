import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { builtinProviders } from "../../src/core/providers.ts";

/**
 * Text that speaks for the whole catalog and cannot compute its counts. The landing and the OG
 * image derive theirs from `docs/app/utils/providers.ts`, so only these can drift.
 */
const CATALOG_PROSE = [
  "README.md",
  "docs/app/app.config.ts",
  "docs/content/index.md",
  "docs/content/1.guide/1.index.md",
  "docs/content/2.providers/0.index.md",
];

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * A count as the prose writes it. Kept local because a root test cannot import `docs/app`: its
 * tsconfig points into `docs/.nuxt`, which only a docs install generates.
 *
 * @param count - A whole number from 0 through 99.
 * @returns {string} The English word, lowercase.
 */
function spellOut(count: number): string {
  if (count < 20) return ONES[count]!;
  const ones = count % 10;
  const tens = TENS[(count - ones) / 10]!;
  return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
}

const numberWords = new Set(Array.from({ length: 100 }, (_, count) => spellOut(count)));

/**
 * A count word or a number as `spellOut` writes it.
 *
 * @param token - A word or one or two digits taken from the prose.
 * @returns {string | null} The count word, or null when the token is not a count.
 */
function asCount(token: string): string | null {
  const word = /^\d{1,2}$/u.test(token) ? spellOut(Number(token)) : token.toLowerCase();
  return numberWords.has(word) ? word : null;
}

describe.each(CATALOG_PROSE)("%s", (file) => {
  const text = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const total = builtinProviders.length;

  it("counts every built-in provider", () => {
    const counts = [
      // "thirteen providers", "Thirteen search APIs", "13 backends"
      ...text.matchAll(
        /\b([A-Za-z]+(?:-[A-Za-z]+)?|\d{1,2}) (?:built-in providers|providers|search APIs|backends|adapters)\b/gu,
      ),
      // Rhetoric around the total, "wrapped thirteen different ways": no other count here reaches eleven.
      ...text.matchAll(/\b(eleven|twelve|[a-z]+teen|[a-z]+ty(?:-[a-z]+)?)\b/giu),
    ]
      .map((match) => asCount(match[1]!))
      .filter((count) => count !== null);

    expect(counts.filter((count) => count !== spellOut(total))).toEqual([]);
  });

  it("counts the providers a named list leaves out", () => {
    // "Brave, Exa, Tavily, Firecrawl, Jina, SearXNG and seven more"
    const lists = [...text.matchAll(/((?:[A-Za-z.]+, )+[A-Za-z.]+) and ([a-z-]+) more\b/gu)].map(
      (match) => ({ list: match[0], named: match[1]!.split(", ").length, rest: match[2]! }),
    );

    expect(
      lists.filter(({ named, rest }) => rest !== spellOut(total - named)).map(({ list }) => list),
    ).toEqual([]);
  });
});
