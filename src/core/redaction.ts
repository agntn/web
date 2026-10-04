const SENSITIVE_PARAMS = ["api_key", "key", "token", "secret", "password", "apikey", "url"];
const SENSITIVE_PARAM_SET = new Set(SENSITIVE_PARAMS.map((param) => param.toLowerCase()));

/**
 * Strip credentials out of a URL before an error message shows it to anyone.
 * @param url - URL as requested, or as a response or provider reported it.
 * @returns {string} The URL with secrets as `[REDACTED]`, or the input when it doesn't parse.
 */
export function sanitizeUrl(url: string): string {
  try {
    const directRedaction = redactUrlComponents(url);
    return redactEncodedPathUrls(directRedaction.url).url;
  } catch {
    return url;
  }
}

function redactUrlComponents(url: string): { url: string; changed: boolean } {
  const parsed = new URL(url);
  const userInfoRedacted = redactUserInfo(
    url,
    parsed.username.length > 0 || parsed.password.length > 0,
    parsed.password.length > 0,
  );
  const queryRedacted = redactSensitiveQueryParams(userInfoRedacted.url);

  return {
    url: queryRedacted.url,
    changed: userInfoRedacted.changed || queryRedacted.changed,
  };
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
  const prefix = url.slice(0, queryStart + 1);
  const query = url.slice(queryStart + 1, queryEnd);
  const suffix = fragmentStart === -1 ? "" : url.slice(fragmentStart);

  let changed = false;
  let redactedQuery = "";
  let segmentStart = 0;

  for (let index = 0; index <= query.length; index += 1) {
    const isEnd = index === query.length;
    const char = query[index];
    if (!isEnd && char !== "&") {
      continue;
    }

    const segment = query.slice(segmentStart, index);
    redactedQuery += redactSegment(segment);
    if (!isEnd) {
      redactedQuery += char;
    }
    segmentStart = index + 1;
  }

  if (!changed) {
    return { url, changed: false };
  }

  return { url: `${prefix}${redactedQuery}${suffix}`, changed: true };

  function redactSegment(segment: string): string {
    if (!segment) {
      return segment;
    }

    const separatorIndex = segment.indexOf("=");
    const rawKey = separatorIndex === -1 ? segment : segment.slice(0, separatorIndex);

    let decodedKey = rawKey;
    try {
      decodedKey = decodeURIComponent(rawKey);
    } catch {
      decodedKey = rawKey;
    }

    if (!SENSITIVE_PARAM_SET.has(decodedKey.toLowerCase())) {
      return segment;
    }

    if (separatorIndex === -1) {
      return segment;
    }

    changed = true;
    return `${rawKey}=${encodeURIComponent("[REDACTED]")}`;
  }
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>`]+/g;

/**
 * Redact every URL a message quotes, the way ofetch repeats the request in its own.
 * @param text - Message that may quote URLs.
 * @returns {string} The text with each quoted URL passed through {@link sanitizeUrl}.
 */
export function sanitizeUrlsIn(text: string): string {
  return text.replaceAll(URL_IN_TEXT, (url) => sanitizeUrl(url));
}
