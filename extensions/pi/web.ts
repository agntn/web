import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTools, type PiRenderers } from "@agntn/tools/pi";

import type { RenderedToolResult, RenderOptions, StatusTheme, WebToolName } from "../../src/tui.ts";
import type { ProviderStatus, SearchResult } from "../../src/index.ts";

type TuiModule = typeof import("../../src/tui.ts");
type WebModule = typeof import("../../src/index.ts");
type ToolsModule = typeof import("../../src/tools.ts");

const DEFAULT_MAX_RESULTS = 10;

const sourceModuleUrl = new URL("../../src/index.ts", import.meta.url);
const distributionModuleUrl = new URL("../../dist/index.mjs", import.meta.url);
let webModulePromise: Promise<WebModule> | undefined;

/** @returns {string} Live source in a checkout, otherwise the built distribution module. */
export function resolveWebModuleUrl(): string {
  return existsSync(fileURLToPath(sourceModuleUrl))
    ? sourceModuleUrl.href
    : distributionModuleUrl.href;
}

/** @returns {Promise<WebModule>} The cached module from the resolved live runtime. */
function loadWeb(): Promise<WebModule> {
  webModulePromise ??= import(resolveWebModuleUrl()) as Promise<WebModule>;
  return webModulePromise;
}

/**
 * The tool definitions: checkout source, otherwise the package build. Both imports stay literal,
 * because OMP resolves the bare imports of a module only when it can see the specifier.
 * @returns {Promise<ToolsModule>} The module with `webTools`.
 */
function loadTools(): Promise<ToolsModule> {
  return existsSync(fileURLToPath(new URL("../../src/tools.ts", import.meta.url)))
    ? import("../../src/tools.ts")
    : import("@agntn/web/tools");
}

function statusRenderers(name: WebToolName, tui: Readonly<TuiModule>): PiRenderers {
  return {
    renderCall(args, theme, context) {
      return tui.createViewportText((width) =>
        tui.renderWebToolCall(
          name,
          args,
          { ...(context as RenderOptions), viewportWidth: width },
          theme as StatusTheme,
        ),
      );
    },
    renderResult(result, options, theme, context) {
      return tui.createViewportText((width) =>
        tui.renderWebToolResult(
          name,
          result as RenderedToolResult,
          (context as { isError?: boolean } | undefined)?.isError === true,
          { ...options, viewportWidth: width },
          theme as StatusTheme,
        ),
      );
    },
  };
}

/**
 * Registers the web tools and the `/web` commands; terminal code and schemas load only now.
 * @param pi - Pi extension API.
 */
export default async function webExtension(pi: ExtensionAPI): Promise<void> {
  const [tui, { webTools }] = await Promise.all([
    import("../../src/tui.ts") as Promise<TuiModule>,
    loadTools(),
  ]);
  const tools = webTools();
  registerPiTools(pi, tools, {
    renderers: Object.fromEntries(
      tools.map((tool) => [tool.name, statusRenderers(tool.name as WebToolName, tui)]),
    ),
  });

  pi.registerCommand("web", {
    description: "Search the web: /web [query]",
    handler: async (args, ctx) => {
      const web = await loadWeb();
      await web.withCodexHostAuth(
        ctx.modelRegistry,
        async () => {
          if (ctx.hasUI) await runWebCommand(args, ctx.ui, tui);
        },
        ctx.sessionManager?.getSessionId(),
      );
    },
  });

  pi.registerCommand("web-providers", {
    description: "List configured web providers",
    handler: async (_args, ctx) => {
      const web = await loadWeb();
      const statuses = await web.withCodexHostAuth(
        ctx.modelRegistry,
        () => web.listProvidersAsync(),
        ctx.sessionManager?.getSessionId(),
      );
      if (!ctx.hasUI) return;
      ctx.ui.notify(statuses.map((status) => providerLine(status, tui)).join("\n"), "info");
    },
  });
}

type CommandHandler = NonNullable<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>;
type CommandUi = Readonly<
  Pick<Parameters<CommandHandler>[1]["ui"], "input" | "select" | "notify" | "pasteToEditor">
>;

type CommandSearchResult = {
  readonly provider: string;
  readonly results: readonly SearchResult[];
};

async function runWebCommand(args: string, ui: CommandUi, tui: Readonly<TuiModule>): Promise<void> {
  const enteredQuery = args.trim() || (await ui.input("Search the web", "Enter a search query"));
  const query = enteredQuery?.trim();
  if (!query) return;

  const found = await searchForCommand(query, ui);
  if (!found || found.results.length === 0) return;
  const labels = found.results.map((result, index) => compactResult(result, index, tui));
  const selected = await ui.select(`web (${found.provider}) - ${query}`, labels);
  if (!selected) return;
  const picked = found.results[labels.indexOf(selected)];
  if (!picked) return;
  ui.pasteToEditor(picked.url);
  ui.notify(`Pasted ${picked.url}`, "info");
}

async function searchForCommand(
  query: string,
  ui: CommandUi,
): Promise<CommandSearchResult | undefined> {
  const web = await loadWeb();
  try {
    const response = await web.searchWithFallback(query, { maxResults: DEFAULT_MAX_RESULTS });
    if (response.results.length === 0) {
      ui.notify(`No results for "${query}" via ${response.provider}.`, "warning");
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      error instanceof web.NoProviderConfiguredError ||
      error instanceof web.NoProviderAvailableError
    ) {
      ui.notify(`No reachable web providers. ${message}`, "warning");
      return undefined;
    }
    ui.notify(`web search failed: ${message}`, "error");
    return undefined;
  }
}

/**
 * One provider: ✓ configured and reachable (or never probed), ⚠ the probe failed, · not configured.
 * @param status - The provider status.
 * @param tui - Shared terminal presentation.
 * @returns {string} The symbol, name, key variable and capabilities on one line.
 */
function providerLine(status: Readonly<ProviderStatus>, tui: Readonly<TuiModule>): string {
  const symbol = !status.configured ? "·" : status.reachable === false ? "⚠" : "✓";
  const env = status.envVar ? ` (${status.envVar})` : "";
  const unreachable = status.configured && status.reachable === false ? " - unreachable" : "";
  return `${symbol} ${status.name}${env}${unreachable} ${tui.formatProviderCapabilities(status)}`;
}

function compactResult(
  result: Readonly<Pick<SearchResult, "title" | "url" | "snippet">>,
  index: number,
  tui: Readonly<TuiModule>,
): string {
  const title = tui.sanitizeTerminalText(result.title || "(no title)", 300);
  const url = tui.sanitizeTerminalText(result.url, 500);
  const snippet = result.snippet ? ` - ${tui.sanitizeTerminalText(result.snippet, 120)}` : "";
  return `${index + 1}. ${title}\n   ${url}${snippet}`;
}
