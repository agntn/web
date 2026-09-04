/** `2024-01-20T14:25:10.000Z` → `2024-01-20`. */
export function dateOnly(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

/** Keeps the start and the end of a long value: `https://exam…/page`. */
export function shortValue(value: string, max = 40): string {
  if (value.length <= max) {
    return value;
  }
  const head = Math.ceil((max - 1) * 0.6);
  const tail = max - 1 - head;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Cuts a text at `max` code points with an ellipsis. */
export function clip(value: string, max: number): string {
  const points = [...value];
  return points.length > max ? `${points.slice(0, max - 1).join("").trimEnd()}…` : value;
}

/** Strips the scheme and a trailing slash for display: `https://nitro.build/deploy/` → `nitro.build/deploy`. */
export function bareUrl(url: string): string {
  return url.replace(/^https?:\/\//u, "").replace(/\/$/u, "");
}

/** The host of a URL, or the input when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return url;
  }
}

/** Adds `https://` when the scheme is missing, the way the explorer accepts bare hosts. */
export function withScheme(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Strips the markup and entities some providers leave in snippets; the page shows text, never markup. */
export function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/gu, "")
    .replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/gu, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/gu, " ")
    .trim();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Host and path for display, without the scheme or the query: `nitro.build/deploy/providers/cloudflare`. */
export function hostPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./u, "")}${parsed.pathname.replace(/\/$/u, "")}`;
  } catch {
    return url;
  }
}
