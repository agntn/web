/** Parts that make a key secret, case and punctuation aside, like `access_token`. */
const SENSITIVE_KEY_PARTS = [
  "token",
  "key",
  "secret",
  "pass",
  "pwd",
  "auth",
  "sig",
  "session",
  "credential",
  "url",
];
const REDACTED = encodeURIComponent("[REDACTED]");
const PERCENT_LAYERS = 3;
const PERCENT_RUN = /(?:%[\da-f]{2})+/gi;
const KEY_IN_TEXT = /(?<![\w.%-])[\w.%-]+=/g;
const VALUE_END = /[\s&#]/g;
const USERINFO_IN_TEXT =
  /(?<![a-z0-9+.-])(https?:[\\/]*|[a-z][a-z0-9+.-]*:[\\/]+)([^\s\\/@?#:]+)(:[^\s\\/@?#]*)?@/gi;

/**
 * Strip credentials out of a URL before an error message shows it to anyone.
 * @param url - URL as requested, or as a response or provider reported it.
 * @returns {string} The URL with secrets as `[REDACTED]`, or the input when it doesn't parse.
 */
export function sanitizeUrl(url: string): string {
  try {
    const directRedaction = redactUrlComponents(url);
    return redactSecretsIn(redactEncodedPathUrls(directRedaction.url).url);
  } catch {
    return redactSecretsIn(url);
  }
}

/**
 * Redact each sensitive `key=value` and `scheme:user:pass@` in text, whatever URL holds them.
 * Up to three layers of percent-encoding are looked through; base64 or JSON in a value are not.
 * @param text - URL or message, already redacted by URL structure or not.
 * @param depth - Percent-decoding layers left to look through.
 * @returns {string} The text with those secrets as `[REDACTED]`; running it twice changes nothing.
 */
function redactSecretsIn(text: string, depth = PERCENT_LAYERS): string {
  const plain = redactLiteralSecrets(text);
  if (depth === 0 || !plain.includes("%")) return plain;

  const decoded = plain.replaceAll(PERCENT_RUN, decodePercentRun);
  if (decoded === plain) return plain;
  const revealed = redactSecretsIn(decoded, depth - 1);
  return revealed === decoded ? plain : revealed;
}

function decodePercentRun(run: string): string {
  try {
    return decodeURIComponent(run);
  } catch {
    return run;
  }
}

function redactLiteralSecrets(text: string): string {
  return redactPairsIn(text).replaceAll(
    USERINFO_IN_TEXT,
    (_match, scheme: string, _user: string, password?: string) =>
      `${scheme}[REDACTED]${password === undefined ? "" : ":[REDACTED]"}@`,
  );
}

/**
 * Redact the value after each sensitive key, skipping keys inside a value already redacted.
 * @param text - Text that may hold `key=value` pairs anywhere.
 * @returns {string} The text with each sensitive value up to whitespace, `&` or `#` redacted.
 */
function redactPairsIn(text: string): string {
  let result = "";
  let copied = 0;
  for (const match of text.matchAll(KEY_IN_TEXT)) {
    const valueStart = match.index + match[0].length;
    if (match.index < copied || !isSensitiveKey(decodedKey(match[0].slice(0, -1)))) continue;
    VALUE_END.lastIndex = valueStart;
    const valueEnd = VALUE_END.exec(text)?.index ?? text.length;
    const value = text.slice(valueStart, valueEnd);
    result += `${text.slice(copied, valueStart)}${value === "[REDACTED]" ? value : REDACTED}`;
    copied = valueEnd;
  }
  return `${result}${text.slice(copied)}`;
}

function redactUrlComponents(url: string): { url: string; changed: boolean } {
  const userInfoRedacted = redactCredentials(url);
  const queryRedacted = redactSensitiveQueryParams(userInfoRedacted.url);
  const fragmentRedacted = redactSensitiveFragmentParams(queryRedacted.url);

  return {
    url: fragmentRedacted.url,
    changed: userInfoRedacted.changed || queryRedacted.changed || fragmentRedacted.changed,
  };
}

/**
 * Redact userinfo the parser sees, by the original spelling when `://` shows where it is.
 * @param url - URL to redact.
 * @returns {{ url: string; changed: boolean }} The URL and whether it carried credentials.
 */
function redactCredentials(url: string): { url: string; changed: boolean } {
  const parsed = new URL(url);
  const hasPassword = parsed.password.length > 0;
  const hasUserInfo = parsed.username.length > 0 || hasPassword;
  const spelled = redactUserInfo(url, hasUserInfo, hasPassword);
  if (spelled.changed || !hasUserInfo) return spelled;

  parsed.username = "[REDACTED]";
  if (hasPassword) parsed.password = "[REDACTED]";
  return { url: parsed.href, changed: true };
}

function redactEncodedPathUrls(url: string): { url: string; changed: boolean } {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) {
    return { url, changed: false };
  }

  const pathStart = url.indexOf("/", schemeEnd + 3);
  if (pathStart === -1) {
    return { url, changed: false };
  }

  const queryStart = url.indexOf("?", pathStart);
  const fragmentStart = url.indexOf("#", pathStart);
  const pathEndCandidates = [queryStart, fragmentStart].filter((index) => index !== -1);
  const pathEnd = pathEndCandidates.length > 0 ? Math.min(...pathEndCandidates) : url.length;
  const path = url.slice(pathStart, pathEnd);
  let changed = false;

  const redactedPath = path
    .split("/")
    .map((segment) => {
      if (!segment.includes("%")) {
        return segment;
      }

      try {
        const decoded = decodeURIComponent(segment);
        const redacted = redactUrlComponents(decoded);
        if (!redacted.changed) {
          return segment;
        }

        changed = true;
        return encodeURIComponent(redacted.url);
      } catch {
        return segment;
      }
    })
    .join("/");

  if (!changed) {
    return { url, changed: false };
  }

  return {
    url: `${url.slice(0, pathStart)}${redactedPath}${url.slice(pathEnd)}`,
    changed: true,
  };
}

function redactUserInfo(
  url: string,
  hasUserInfo: boolean,
  hasPassword: boolean,
): { url: string; changed: boolean } {
  if (!hasUserInfo) {
    return { url, changed: false };
  }

  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) {
    return { url, changed: false };
  }

  const authorityStart = schemeEnd + 3;
  const pathIndex = url.indexOf("/", authorityStart);
  const queryIndex = url.indexOf("?", authorityStart);
  const fragmentIndex = url.indexOf("#", authorityStart);

  const authorityEndCandidates = [pathIndex, queryIndex, fragmentIndex].filter(
    (index) => index !== -1,
  );
  const authorityEnd =
    authorityEndCandidates.length > 0 ? Math.min(...authorityEndCandidates) : url.length;

  const authority = url.slice(authorityStart, authorityEnd);
  const atIndex = authority.lastIndexOf("@");
  if (atIndex === -1) {
    return { url, changed: false };
  }

  const redactedUserInfo = hasPassword ? "[REDACTED]:[REDACTED]" : "[REDACTED]";
  const redactedAuthority = `${redactedUserInfo}@${authority.slice(atIndex + 1)}`;

  return {
    url: `${url.slice(0, authorityStart)}${redactedAuthority}${url.slice(authorityEnd)}`,
    changed: true,
  };
}

function redactSensitiveQueryParams(url: string): { url: string; changed: boolean } {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) {
    return { url, changed: false };
  }

  const fragmentStart = url.indexOf("#", queryStart);
  const queryEnd = fragmentStart === -1 ? url.length : fragmentStart;
  const query = redactPairs(url.slice(queryStart + 1, queryEnd), "&");
  if (!query.changed) {
    return { url, changed: false };
  }

  return {
    url: `${url.slice(0, queryStart + 1)}${query.text}${url.slice(queryEnd)}`,
    changed: true,
  };
}

/**
 * Redact the same keys in a fragment, where OAuth hands out tokens and a hash router keeps a query.
 * @param url - URL whose query is already redacted.
 * @returns {{ url: string; changed: boolean }} The URL and whether its fragment changed.
 */
function redactSensitiveFragmentParams(url: string): { url: string; changed: boolean } {
  const fragmentStart = url.indexOf("#");
  if (fragmentStart === -1) {
    return { url, changed: false };
  }

  const fragment = redactPairs(url.slice(fragmentStart + 1), "&?");
  if (!fragment.changed) {
    return { url, changed: false };
  }

  return { url: `${url.slice(0, fragmentStart + 1)}${fragment.text}`, changed: true };
}

/**
 * Replace the value of every sensitive `key=value` pair in a query or fragment.
 * @param text - Pairs without the leading `?` or `#`.
 * @param separators - Characters that end a pair.
 * @returns {{ text: string; changed: boolean }} The pairs and whether any value was redacted.
 */
function redactPairs(text: string, separators: string): { text: string; changed: boolean } {
  let changed = false;
  let redacted = "";
  let segmentStart = 0;

  for (let index = 0; index <= text.length; index += 1) {
    const isEnd = index === text.length;
    const char = text.charAt(index);
    if (!isEnd && !separators.includes(char)) {
      continue;
    }

    const segment = text.slice(segmentStart, index);
    const safe = redactSegment(segment);
    changed ||= safe !== segment;
    redacted += isEnd ? safe : `${safe}${char}`;
    segmentStart = index + 1;
  }

  return { text: redacted, changed };
}

/**
 * Redact one `key=value` pair when its key names a secret.
 * @param segment - One pair, raw.
 * @returns {string} The pair, with `[REDACTED]` for a sensitive value.
 */
function redactSegment(segment: string): string {
  const separatorIndex = segment.indexOf("=");
  if (separatorIndex === -1) {
    return segment;
  }

  const rawKey = segment.slice(0, separatorIndex);
  if (!isSensitiveKey(decodedKey(rawKey))) {
    return segment;
  }

  return `${rawKey}=${REDACTED}`;
}

function isSensitiveKey(key: string): boolean {
  const name = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_PARTS.some((part) => name.includes(part));
}

function decodedKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey);
  } catch {
    return rawKey;
  }
}

/** WHATWG ends a URL only at ASCII whitespace, so a `'` or a NBSP can come before its secret. */
const URL_IN_TEXT = /https?:\/\/[^\t\n\f\r ]+/gi;
const URL_SCHEME = /https?:\/\//gi;
const URL_TRAILER = `"'\`<>()[]{},.;:!?`;

/**
 * Redact every URL a message quotes, whole and again from each scheme on, so a comma between two
 * URLs hides neither one's secrets.
 * @param text - Message that may quote URLs.
 * @returns {string} The text with each quoted URL passed through {@link sanitizeUrl}.
 */
export function sanitizeUrlsIn(text: string): string {
  return redactSecretsIn(sanitizeQuotedUrls(text));
}

function sanitizeQuotedUrls(text: string): string {
  return text.replaceAll(URL_IN_TEXT, (token) => {
    const whole = sanitizeQuoted(token);
    const starts = Array.from(whole.matchAll(URL_SCHEME), (match) => match.index);
    const head = whole.slice(0, starts[0] ?? whole.length);
    const urls = starts.map((start, index) =>
      sanitizeQuoted(whole.slice(start, starts[index + 1])),
    );
    return `${head}${urls.join("")}`;
  });
}

/**
 * Redact one URL token, keeping its closing punctuation unless a redacted value may own it.
 * @param token - Text that starts with a URL scheme.
 * @returns {string} The token with its URL passed through {@link sanitizeUrl}.
 */
function sanitizeQuoted(token: string): string {
  const end = trailerStart(token);
  const safe = sanitizeUrl(token.slice(0, end));
  return safe.endsWith(REDACTED) ? safe : `${safe}${token.slice(end)}`;
}

/**
 * Where the quote marks and punctuation that close a URL token begin.
 * @param token - Text from `http` up to the next whitespace.
 * @returns {number} Index of the first trailing character, or the token length.
 */
function trailerStart(token: string): number {
  let end = token.length;
  while (end > 0 && URL_TRAILER.includes(token.charAt(end - 1))) end -= 1;
  return end;
}
