/** Optional search inputs a caller may fill with a blank placeholder. */
interface BlankableSearchOptions {
  readonly provider?: string;
  readonly continuation?: string;
  readonly category?: string;
  readonly startPublishedDate?: string;
  readonly endPublishedDate?: string;
}

/** Optional read inputs a caller may fill with a blank placeholder. */
interface BlankableReadOptions {
  readonly continuation?: string;
  readonly format?: string;
  readonly targetSelector?: string;
  readonly removeSelector?: string;
}

/**
 * Reads an optional text input, treating a blank value as an omitted one.
 *
 * Agents fill every property of a flat tool schema, so `continuation: ""`
 * arrives where a caller writing the options by hand leaves the field out.
 * Without this, the empty string reaches the continuation decoder and the
 * date validator as a value and fails there.
 * @param value - Optional text as the caller supplied it.
 * @returns {string | undefined} The value, or undefined when it is blank.
 */
export function optionalText(value?: string): string | undefined {
  return value?.trim() ? value : undefined;
}

/**
 * Unsets the blank optional text inputs of one search request.
 *
 * Blank inputs are dropped rather than set to undefined, because providers
 * read the option keys they are handed.
 * @param options - Search options as the caller supplied them.
 * @returns {TOptions | undefined} Options without their blank text inputs.
 */
export function normalizeSearchOptions<TOptions extends BlankableSearchOptions>(
  options?: TOptions,
): TOptions | undefined {
  if (options === undefined) return options;
  const { provider, continuation, category, startPublishedDate, endPublishedDate, ...rest } =
    options;
  if (!isBlank(provider, continuation, category, startPublishedDate, endPublishedDate)) {
    return options;
  }
  return {
    ...rest,
    ...(optionalText(provider) === undefined ? {} : { provider }),
    ...(optionalText(continuation) === undefined ? {} : { continuation }),
    ...(optionalText(category) === undefined ? {} : { category }),
    ...(optionalText(startPublishedDate) === undefined ? {} : { startPublishedDate }),
    ...(optionalText(endPublishedDate) === undefined ? {} : { endPublishedDate }),
  } as TOptions;
}

/**
 * Unsets the blank optional text inputs of one read request.
 * @param options - Read options as the caller supplied them.
 * @returns {TOptions | undefined} Options without their blank text inputs.
 */
export function normalizeReadOptions<TOptions extends BlankableReadOptions>(
  options?: TOptions,
): TOptions | undefined {
  if (options === undefined) return options;
  const { continuation, format, targetSelector, removeSelector, ...rest } = options;
  if (!isBlank(continuation, format, targetSelector, removeSelector)) return options;
  return {
    ...rest,
    ...(optionalText(continuation) === undefined ? {} : { continuation }),
    ...(optionalText(format) === undefined ? {} : { format }),
    ...(optionalText(targetSelector) === undefined ? {} : { targetSelector }),
    ...(optionalText(removeSelector) === undefined ? {} : { removeSelector }),
  } as TOptions;
}

/**
 * Whether any supplied input is present but blank, so the options need a copy.
 * @param values - Optional text inputs of one request.
 * @returns {boolean} Whether at least one input is blank.
 */
function isBlank(...values: readonly (string | undefined)[]): boolean {
  return values.some((value) => value !== undefined && optionalText(value) === undefined);
}
