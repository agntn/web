import { defineTool, type ToolDefinition } from "@agntn/tools";

import { webToolTitle } from "./tool-titles.ts";
import { webInputSchemas, webOutputSchemas } from "./tool-schemas.ts";

type Operations = typeof import("./tool-operations.ts");

let operations: Promise<Operations> | undefined;

/**
 * The executors and the provider graph load on the first call, so registering a tool loads neither.
 * @returns {Promise<Operations>} The cached executor module.
 */
function loadOperations(): Promise<Operations> {
  operations ??= import("./tool-operations.ts");
  return operations;
}

let tools: ReturnType<typeof defineTools> | undefined;
let commands: readonly ToolDefinition[] | undefined;

/**
 * The web tools every surface gets: MCP, Pi, OMP, the AI SDK and the CLI.
 * @returns {readonly ToolDefinition[]} Every tool from search to providers, built once.
 */
export function webTools(): ReturnType<typeof defineTools> {
  tools ??= defineTools();
  return tools;
}

/**
 * Commands only the CLI gets: `search` and `read` take several words as one batch.
 * @returns {readonly ToolDefinition[]} The two commands, built once.
 */
export function webCommands(): readonly ToolDefinition[] {
  commands ??= defineCommands();
  return commands;
}

const reading = { effect: "read", openWorld: true } as const;

function defineTools() {
  const input = webInputSchemas();
  const output = webOutputSchemas();
  return [
    defineTool({
      name: "web_search",
      title: webToolTitle("web_search"),
      description:
        'Search the web using multiple search engines (Brave, Context.dev, Exa, Firecrawl, Jina, Marginalia, Mojeek, OpenAI Codex, Tavily, TinyFish, SerpAPI, SerpBase, SearXNG). Pass one query or a batch of queries; each batch item returns its own results or error. Use provider "all" to query all available providers in parallel and get deduplicated results. Responses report filters the selected provider ignored. Single searches may continue with an opaque token bound to its provider.',
      snippet:
        "Search the web with web_search. Pass a query array for independent batch results, or use provider=all to query every configured provider in parallel.",
      guidelines: [
        "Use web_search when the user explicitly asks for fresh web information, news, references, or links.",
        "Prefer a single provider when the user names one; use provider=all when freshness or coverage matters and at least two providers are configured.",
        "Use web_providers when selecting a provider by rich result fields, filters, or result limits.",
        "Request summaries or full text deliberately because generated and extracted content can increase cost and context size.",
        "Pass maxResults conservatively (5-10) unless the user asks for more.",
        "Use a returned search continuation only with the same single query, provider, and options; an unknown state means the next page must be probed.",
        "Forward domain, source, category, and date filters when the user gives concrete values.",
      ],
      ...reading,
      input: input.search,
      output: output.search,
      cli: { positional: ["query"] },
      execute: async (args, { signal, host }) =>
        (await loadOperations()).search(args, signal, host),
    }),
    defineTool({
      name: "web_image_search",
      title: webToolTitle("web_image_search"),
      description:
        "Find public pages containing or resembling an image available by URL. Returns matched page and image URLs with dimensions and rank metadata.",
      snippet: "Find pages containing or resembling a public image URL with web_image_search.",
      guidelines: [
        "Use web_image_search for reverse image lookup. Use web_search for text queries and web_read for page content.",
      ],
      ...reading,
      input: input.searchImage,
      output: output.searchImage,
      cli: {
        command: "search-image",
        aliases: ["image-search"],
        positional: ["url"],
        plain: ["url"],
      },
      execute: async (args, { signal }) => (await loadOperations()).searchImage(args, signal),
    }),
    defineTool({
      name: "web_read",
      title: webToolTitle("web_read"),
      description:
        "Read one URL or a batch of URLs into normalized content using Jina, Context.dev, Firecrawl, TinyFish, Tavily, or Exa. Automatic reads report every provider attempt and failure after fallback.",
      snippet:
        "Read one URL with web_read, or pass a URL array when several pages are needed independently.",
      guidelines: [
        "Use web_read after search when the user needs the contents of a specific URL.",
        "Use web_search for query-to-URL search; use web_read for URL-to-content reading.",
      ],
      ...reading,
      input: input.read,
      output: output.read,
      cli: { positional: ["url"] },
      execute: async (args, { signal }) => (await loadOperations()).read(args, signal),
    }),
    defineTool({
      name: "web_reveal",
      title: webToolTitle("web_reveal"),
      description:
        "List what a page hides from its reader: HTML comments, hidden elements with their text and form fields, text in its background's color, invisible Unicode, data-* and nonstandard attributes, meta and link tags, scripts and styles. Reads the page's own HTML and the stylesheets it links, with no provider in between; a Wayback Machine capture is read as archived, without the toolbar.",
      snippet:
        "Reveal what a page hides, such as source comments and hidden form fields, with web_reveal.",
      guidelines: [
        "Use web_reveal when a page may hold more than its text shows: a puzzle, a CTF, a clue left in the source. Use web_read for the text itself.",
        "web_reveal reads public HTTP and HTTPS pages only and refuses loopback and private network addresses.",
      ],
      ...reading,
      input: input.reveal,
      output: output.reveal,
      cli: {
        description:
          "List what a page hides from its reader: comments, hidden elements, invisible text",
        positional: ["url"],
        plain: ["url"],
      },
      execute: async (args, { signal }) => (await loadOperations()).reveal(args, signal),
    }),
    defineTool({
      name: "web_providers",
      title: webToolTitle("web_providers"),
      description:
        "List registered web providers, their complete operation capabilities, configuration and reachability, and the running build.",
      snippet: "List configured web providers.",
      guidelines: [
        "Use web_providers before web_search if provider availability, limits, fields, or option support is unclear.",
      ],
      effect: "read",
      input: input.providers,
      output: output.providers,
      execute: async (_args, { signal, host }) => (await loadOperations()).providers(signal, host),
    }),
  ] as const;
}

function defineCommands(): ToolDefinition[] {
  const input = webInputSchemas();
  return [
    defineTool({
      name: "web_search",
      title: webToolTitle("web_search"),
      description:
        "Search the web through one provider, the automatic order, or every provider at once. Two or more quoted queries search as a batch.",
      ...reading,
      input: input.searchCommand,
      cli: { rest: "queries", plain: ["queries"] },
      execute: async ({ queries, ...args }, { signal }) =>
        (await loadOperations()).search(
          { ...args, query: queries.length === 1 ? queries[0] : queries },
          signal,
        ),
    }),
    defineTool({
      name: "web_read",
      title: webToolTitle("web_read"),
      description:
        "Read a URL into normalized content, whole unless --max-chars cuts it. Two or more URLs read as a batch.",
      ...reading,
      input: input.readCommand,
      cli: { rest: "urls", plain: ["urls"] },
      async execute({ urls, cache, ...args }, { signal }) {
        const answer = await (
          await loadOperations()
        ).read(
          {
            ...args,
            url: urls.length === 1 ? urls[0] : urls,
            noCache: cache === false || undefined,
          },
          signal,
          false,
        );
        const result = answer.details.result;
        if (
          Array.isArray(result) &&
          result.some(
            (outcome) => typeof outcome === "object" && outcome !== null && "error" in outcome,
          )
        ) {
          process.exitCode = 1;
        }
        return answer;
      },
    }),
  ];
}
