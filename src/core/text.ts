/**
 * Longest `snippet` an adapter hands on. Brave and SerpAPI write about 150 to 540 characters,
 * while Tavily joins several page passages and Firecrawl can send a whole page.
 */
export const SNIPPET_MAX_CHARACTERS = 500;

/**
 * Cut text to a length, the ellipsis included, without splitting a surrogate pair.
 * @param text - Text to bound.
 * @param max - Longest result in UTF-16 code units.
 * @returns {string} The text as it is when it fits, otherwise its start and `…`.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;

  const end = max - 1;
  const splitsPair = (text.codePointAt(end - 1) ?? 0) > 0xffff;
  return `${text.slice(0, splitsPair ? end - 1 : end)}…`;
}

/**
 * Bound a provider's result excerpt to {@link SNIPPET_MAX_CHARACTERS}.
 * @param text - Excerpt as the provider sent it.
 * @returns {string} Excerpt an agent can scan next to nine others.
 */
export function snippet(text: string): string {
  return clip(text, SNIPPET_MAX_CHARACTERS);
}
