/** Web tools with dedicated Pi and OMP presentation. */
export type WebToolName = "web_search" | "web_search_image" | "web_read" | "web_providers";

const PRESENTATION: Readonly<Record<WebToolName, { symbol: string; label: string }>> = {
  web_search: { symbol: "⌕", label: "Web Search" },
  web_search_image: { symbol: "▧", label: "Search by Image" },
  web_read: { symbol: "↗", label: "Web Read" },
  web_providers: { symbol: "◫", label: "Web Providers" },
};

/** Return the symbol and label used by native tool menus.
 *
 * Lives apart from `tui.ts` so the MCP server names its tools without loading the terminal
 * width tables.
 * @param name - Registered web tool name.
 * @returns {string} Stable symbol and label.
 */
export function webToolTitle(name: WebToolName): string {
  const item = PRESENTATION[name];
  return `${item.symbol} ${item.label}`;
}
