import { createHash } from "node:crypto";

/**
 * Seal continuation state into a compact token: every field as base64url, then one tag.
 * The tag binds the fields to the request they continue and catches corruption; it is
 * not an authorization signature. An agent copies the token back verbatim, so every
 * character here is paid twice.
 * @param domain - Token kind and format version, part of the tag.
 * @param fields - State the next call needs back.
 * @param request - Serialized request the token belongs to.
 * @returns {string} Dot-separated fields followed by the tag.
 */
export function sealContinuation(
  domain: string,
  fields: readonly string[],
  request: string,
): string {
  const encoded = fields.map((field) => Buffer.from(field).toString("base64url"));
  return [...encoded, continuationTag(domain, fields, request)].join(".");
}

/**
 * Open a token from {@link sealContinuation}.
 * @param domain - Token kind and format version it was sealed with.
 * @param token - Token as the caller passed it.
 * @param fieldCount - Number of fields the token must carry.
 * @param request - Serialized request being continued.
 * @returns {string[] | undefined} The fields, or `undefined` when the token is malformed,
 * altered, or belongs to another request.
 */
export function openContinuation(
  domain: string,
  token: string,
  fieldCount: number,
  request: string,
): string[] | undefined {
  const parts = token.split(".");
  const tag = parts.pop();
  if (parts.length !== fieldCount) return undefined;
  const fields = parts.map((part) => Buffer.from(part, "base64url").toString("utf8"));
  const canonical = fields.every(
    (field, index) => Buffer.from(field).toString("base64url") === parts[index],
  );
  if (!canonical || tag !== continuationTag(domain, fields, request)) return undefined;
  return fields;
}

/**
 * Hash a value to 128 bits, enough to tell requests and page contents apart.
 * @param value - Value to fingerprint.
 * @returns {string} Base64url digest, 22 characters.
 */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest().subarray(0, 16).toString("base64url");
}

function continuationTag(domain: string, fields: readonly string[], request: string): string {
  return fingerprint(`${domain}\0${JSON.stringify([...fields, request])}`);
}
