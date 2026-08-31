import { getSearchFilterCapabilities } from "./registry.ts";
import { searchFilterNames, type SearchFilterName, type SearchRequestOptions } from "./types.ts";

/** Requested filters that a named provider ignores or has not declared. */
export interface SearchFilterReport {
  readonly provider: string;
  readonly ignoredFilters: readonly SearchFilterName[];
  readonly undeclaredFilters: readonly SearchFilterName[];
}

/**
 * Compare concrete search options with the provider's registered capabilities.
 * @param provider - Effective provider name.
 * @param options - Search options requested by the caller.
 * @returns {SearchFilterReport} Filters the provider ignores or has not declared.
 */
export function searchFilterReport(
  provider: string,
  options?: Readonly<SearchRequestOptions>,
): SearchFilterReport {
  const requested = searchFilterNames.filter((filter) => isRequested(filter, options));
  const capabilities = getSearchFilterCapabilities(provider);
  if (!capabilities) {
    return { provider, ignoredFilters: [], undeclaredFilters: requested };
  }

  const ignoredFilters = requested.filter((filter) => {
    if (!capabilities.filters.includes(filter)) return true;
    if (filter !== "category" || !capabilities.categories) return false;
    return !capabilities.categories.includes(options?.category ?? "");
  });
  return { provider, ignoredFilters, undeclaredFilters: [] };
}

/**
 * Check whether a report contains a filter the caller needs to know about.
 * @param report - Effective provider filter report.
 * @returns {boolean} Whether the report contains ignored or undeclared filters.
 */
export function hasSearchFilterWarning(report: Readonly<SearchFilterReport>): boolean {
  return report.ignoredFilters.length > 0 || report.undeclaredFilters.length > 0;
}

function isRequested(filter: SearchFilterName, options?: Readonly<SearchRequestOptions>): boolean {
  const value = options?.[filter];
  return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.length > 0;
}
