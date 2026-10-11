import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerOmpTools, type OmpRenderers } from "@agntn/tools/omp";

import type {
  RenderedToolResult,
  RenderOptions,
  StatusTheme,
  WebToolName,
} from "../../../src/tui.ts";

type TuiModule = typeof import("../../../src/tui.ts");
type ToolsModule = typeof import("../../../src/tools.ts");

/**
 * The tool definitions: checkout source, otherwise the package build. Both imports stay literal,
 * because OMP resolves the bare imports of a module only when it can see the specifier.
 * @returns {Promise<ToolsModule>} The module with `webTools`.
 */
function loadTools(): Promise<ToolsModule> {
  return existsSync(fileURLToPath(new URL("../../../src/tools.ts", import.meta.url)))
    ? import("../../../src/tools.ts")
    : import("@agntn/web/tools");
}

function statusRenderers(name: WebToolName, tui: Readonly<TuiModule>): OmpRenderers {
  return {
    renderCall(args, options, theme) {
      return tui.createViewportText((width) =>
        tui.renderWebToolCall(
          name,
          args,
          { ...(options as RenderOptions), viewportWidth: width },
          theme as StatusTheme,
        ),
      );
    },
    renderResult(result, options, theme) {
      const rendered = result as RenderedToolResult;
      return tui.createViewportText((width) =>
        tui.renderWebToolResult(
          name,
          rendered,
          rendered.isError === true,
          { ...(options as RenderOptions), viewportWidth: width },
          theme as StatusTheme,
        ),
      );
    },
  };
}

/**
 * Registers the web tools; OMP validates the same schemas MCP, Pi and the AI SDK do.
 * @param pi - OMP extension API.
 */
export default async function webOmpExtension(pi: ExtensionAPI): Promise<void> {
  const [tui, { webTools }] = await Promise.all([
    import("../../../src/tui.ts") as Promise<TuiModule>,
    loadTools(),
  ]);
  pi.setLabel("Web");
  const tools = webTools();
  registerOmpTools(pi, tools, {
    Text: pi.pi.Text,
    renderers: Object.fromEntries(
      tools.map((tool) => [tool.name, statusRenderers(tool.name as WebToolName, tui)]),
    ),
  });
}
