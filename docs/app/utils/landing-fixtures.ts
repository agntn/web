import type { SearchPagination, SearchResult } from "@agntn/web";

/**
 * Answers recorded through the library on 2026-09-04, so the landing has content
 * before the docs worker answers and when it cannot. Every panel labels a recorded answer
 * as a sample and swaps to a live one as soon as it arrives.
 *
 * Regenerate with the library (see docs/AGENTS.md); do not edit by hand.
 */

export type SampleResult = Pick<SearchResult, "url" | "title" | "snippet" | "score" | "publishedDate" | "author" | "favicon" | "text" | "highlights" | "summary">;

export interface SampleFanoutResult extends SampleResult {
  readonly providers: readonly string[];
}

export interface SampleRead {
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly requestedProvider: string;
  readonly provider: string;
  readonly attempts: readonly string[];
  readonly failures: readonly { readonly provider: string; readonly message: string }[];
}

export interface SearchSample {
  readonly query: string;
  /** Provider of the single search panel. */
  readonly provider: string;
  readonly results: readonly SampleResult[];
  readonly pagination: SearchPagination["status"];
  readonly ignoredFilters: readonly string[];
  readonly fanout: {
    readonly results: readonly SampleFanoutResult[];
    readonly successfulProviders: readonly string[];
    readonly errors: readonly { readonly provider: string; readonly message: string }[];
    readonly total: number;
  };
  readonly read: SampleRead;
  /** Whether the answer came from the docs worker in this session. */
  readonly live: boolean;
}

export const LANDING_SAMPLES: readonly SearchSample[] = [
  {
    "query": "TypeScript 7 native compiler",
    "provider": "brave",
    "results": [
      {
        "url": "https://www.infoq.com/news/2026/08/typescript-7-released/",
        "title": "Microsoft Releases TypeScript 7.0 with a Native Go Compiler, Delivering 10x Faster Builds - InfoQ",
        "snippet": "Microsoft has released TypeScript 7.0, <strong>the first stable version of the language to ship its long-in-development native compiler</strong>, a faithful port of the toolset from TypeScript into Go that the team says…",
        "favicon": "https://imgs.search.brave.com/G6IT14wSYNsaoomudWi9ALGTP48RLa7EdIiSbTIY6jA/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZGJhMDI3NTkx/NjQ2MmE4YmI4N2Ni/OGEwMTE5NzI5NzU5/OTY4MzU1NzY4ZDMw/ODU5NzNhZDA0MWI1/MjRkNTQ0NC93d3cu/aW5mb3EuY29tLw"
      },
      {
        "url": "https://www.developersdigest.tech/blog/typescript-7-native-compiler-migration-guide",
        "title": "TypeScript 7.0 Native Compiler: What Breaks, What Gets 10x Faster, and How to Migrate - Developers Digest",
        "snippet": "A practical migration guide for TypeScript 7.0&#x27;s Go-based native compiler. Verified perf numbers, the full breaking-changes list, real npm commands for...",
        "favicon": "https://imgs.search.brave.com/P1gDi7A_EcKCwJnMGwTtQCONmo_iDZQ-hVZbMmSPcs4/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvMmU2ZWU3YTMw/MDA2ZWU5OWJlNGJj/MGQ2MDUwYzRmMTdj/ODNiMjM5ZjgyMmJk/ZjE4N2IwNGVmMzAy/MjhkYTk5Mi93d3cu/ZGV2ZWxvcGVyc2Rp/Z2VzdC50ZWNoLw"
      },
      {
        "url": "https://www.prisma.io/blog/typescript-7-native-compiler-faster-type-checking",
        "title": "TypeScript 7 Native Compiler: 3x Faster Type Checks in a Real Monorepo",
        "snippet": "<strong>TypeScript 7 ships the compiler as a native Go port</strong>. We migrated a large TypeScript monorepo to it: whole-repo type checking went from ~74s to ~24s with no memory tuning. Here are the numbers, the exact…",
        "favicon": "https://imgs.search.brave.com/I-jd6urhzxDeJweFcLQQS8i4DAGcL2uijL91tjcjF3k/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZWNkZmVlYmUy/NmE0MzkxMmVhNDBh/OGQzN2UwNWRmNWQw/YWQ5NmQyNDU0ZDI4/OTRiOWEwZjY0NjBh/YWUyNGIzMi93d3cu/cHJpc21hLmlvLw"
      },
      {
        "url": "https://believemy.com/en/r/typescript-7-native-go-compiler",
        "title": "TypeScript 7: The Native Compiler 10x Faster",
        "snippet": "TypeScript 7 is <strong>the first major version to ship a native compiler written in Go</strong>, delivering speed gains of 8x to 12x on full builds. Concretely, a project like VS Code goes from 125 seconds to about 10…",
        "favicon": "https://imgs.search.brave.com/nwdPtShJq4bzVcUh0_n_dOl3m_YwRbxXxHXvlkz8SZs/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvMzM2Y2JlMTE5/MWMzYTAwMTYzNTgz/YjVkNTNhY2U1MGRj/NzhkMTgzNDYyMGI5/OWJhNmMyYmMwNzI4/ZDRjMmFiYy9iZWxp/ZXZlbXkuY29tLw"
      },
      {
        "url": "https://pas7.com.ua/blog/en/typescript-7-native-compiler-2026",
        "title": "TypeScript 7.0: the native compiler, benchmarks, and what it changes for the web | PAS7 STUDIO",
        "snippet": "<strong>TypeScript 7.0 is a production native release, not another preview build</strong>. The official announcement reports over 80% fewer failed language-server commands and over 60% fewer server crashes compared with…",
        "favicon": "https://imgs.search.brave.com/YYnFOdqi0akkYQlncXBfwdoRtyIAb_eRCJICsHX4HNA/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZWFkMjg0Yjhi/YzdkZmMxMzJlNDA1/YjIyYWNlZDVkZGQy/N2VhMTBhZTlhMTNi/NTc5MTIxZmYxOTEw/Mjg2MDNiOC9wYXM3/LmNvbS51YS8"
      }
    ],
    "pagination": "next",
    "ignoredFilters": [],
    "fanout": {
      "results": [
        {
          "url": "https://www.infoq.com/news/2026/08/typescript-7-released/",
          "title": "Microsoft Releases TypeScript 7.0 with a Native Go Compiler, Delivering 10x Faster Builds - InfoQ",
          "snippet": "Microsoft has released TypeScript 7.0, <strong>the first stable version of the language to ship its long-in-development native compiler</strong>, a faithful port of the toolset from TypeScript into Go that the team says…",
          "favicon": "https://imgs.search.brave.com/G6IT14wSYNsaoomudWi9ALGTP48RLa7EdIiSbTIY6jA/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZGJhMDI3NTkx/NjQ2MmE4YmI4N2Ni/OGEwMTE5NzI5NzU5/OTY4MzU1NzY4ZDMw/ODU5NzNhZDA0MWI1/MjRkNTQ0NC93d3cu/aW5mb3EuY29tLw",
          "providers": [
            "brave",
            "exa"
          ]
        },
        {
          "url": "https://www.developersdigest.tech/blog/typescript-7-native-compiler-migration-guide",
          "title": "TypeScript 7.0 Native Compiler: What Breaks, What Gets 10x Faster, and How to Migrate - Developers Digest",
          "snippet": "A practical migration guide for TypeScript 7.0&#x27;s Go-based native compiler. Verified perf numbers, the full breaking-changes list, real npm commands for...",
          "favicon": "https://imgs.search.brave.com/P1gDi7A_EcKCwJnMGwTtQCONmo_iDZQ-hVZbMmSPcs4/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvMmU2ZWU3YTMw/MDA2ZWU5OWJlNGJj/MGQ2MDUwYzRmMTdj/ODNiMjM5ZjgyMmJk/ZjE4N2IwNGVmMzAy/MjhkYTk5Mi93d3cu/ZGV2ZWxvcGVyc2Rp/Z2VzdC50ZWNoLw",
          "providers": [
            "brave",
            "firecrawl",
            "tavily",
            "tinyfish"
          ]
        },
        {
          "url": "https://www.prisma.io/blog/typescript-7-native-compiler-faster-type-checking",
          "title": "TypeScript 7 Native Compiler: 3x Faster Type Checks in a Real Monorepo",
          "snippet": "<strong>TypeScript 7 ships the compiler as a native Go port</strong>. We migrated a large TypeScript monorepo to it: whole-repo type checking went from ~74s to ~24s with no memory tuning. Here are the numbers, the exact…",
          "favicon": "https://imgs.search.brave.com/I-jd6urhzxDeJweFcLQQS8i4DAGcL2uijL91tjcjF3k/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZWNkZmVlYmUy/NmE0MzkxMmVhNDBh/OGQzN2UwNWRmNWQw/YWQ5NmQyNDU0ZDI4/OTRiOWEwZjY0NjBh/YWUyNGIzMi93d3cu/cHJpc21hLmlvLw",
          "providers": [
            "brave"
          ]
        },
        {
          "url": "https://believemy.com/en/r/typescript-7-native-go-compiler",
          "title": "TypeScript 7: The Native Compiler 10x Faster",
          "snippet": "TypeScript 7 is <strong>the first major version to ship a native compiler written in Go</strong>, delivering speed gains of 8x to 12x on full builds. Concretely, a project like VS Code goes from 125 seconds to about 10…",
          "favicon": "https://imgs.search.brave.com/nwdPtShJq4bzVcUh0_n_dOl3m_YwRbxXxHXvlkz8SZs/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvMzM2Y2JlMTE5/MWMzYTAwMTYzNTgz/YjVkNTNhY2U1MGRj/NzhkMTgzNDYyMGI5/OWJhNmMyYmMwNzI4/ZDRjMmFiYy9iZWxp/ZXZlbXkuY29tLw",
          "providers": [
            "brave"
          ]
        },
        {
          "url": "https://pas7.com.ua/blog/en/typescript-7-native-compiler-2026",
          "title": "TypeScript 7.0: the native compiler, benchmarks, and what it changes for the web | PAS7 STUDIO",
          "snippet": "<strong>TypeScript 7.0 is a production native release, not another preview build</strong>. The official announcement reports over 80% fewer failed language-server commands and over 60% fewer server crashes compared with…",
          "favicon": "https://imgs.search.brave.com/YYnFOdqi0akkYQlncXBfwdoRtyIAb_eRCJICsHX4HNA/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZWFkMjg0Yjhi/YzdkZmMxMzJlNDA1/YjIyYWNlZDVkZGQy/N2VhMTBhZTlhMTNi/NTc5MTIxZmYxOTEw/Mjg2MDNiOC9wYXM3/LmNvbS51YS8",
          "providers": [
            "brave"
          ]
        },
        {
          "url": "https://www.nazarboyko.com/articles/typescript-7-native-compiler-what-changes",
          "title": "TypeScript 7 Native Compiler Explained - Nazar Boyko",
          "snippet": "Microsoft announced the port in March 2025 with Anders Hejlsberg TypeScript&#x27;s lead architect fronting the effort and shipped it as TypeScript 7.0 on July 8, 2026. So when you read &quot;native TypeScript,&quot; exp…",
          "favicon": "https://imgs.search.brave.com/8GUao_dR9-_yxaGGKUnAsnbu0mPWeoHRGrCzzkBKTMk/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvMTdhMDQ3Y2Nm/MDM3YjU3NGE0M2Vk/YmI0MzA3OTIxNDcw/YTVkZTYwZGFiZjQ2/ZDFlNDhkZWI0YzQ1/ZWQzYzY3NS93d3cu/bmF6YXJib3lrby5j/b20v",
          "providers": [
            "brave"
          ]
        }
      ],
      "successfulProviders": [
        "brave",
        "exa",
        "firecrawl",
        "tavily",
        "tinyfish"
      ],
      "errors": [
        {
          "provider": "serpapi",
          "message": "Rate limited. Retry after 60s"
        },
        {
          "provider": "serpbase",
          "message": "SerpBase insufficient credits: insufficient credits"
        }
      ],
      "total": 6
    },
    "read": {
      "url": "https://www.infoq.com/news/2026/08/typescript-7-released/",
      "title": "Microsoft Releases TypeScript 7.0 with a Native Go Compiler, Delivering 10x Faster Builds",
      "content": "[BT](https://www.infoq.com/int/bt/ \"bt\")\n\n## InfoQ Software Architects' Newsletter\n\nA monthly overview of things you need to know as an architect or aspiring architect.\n\n[View an example](https://www.infoq.com/software-architects-newsletter#placeholderPastIssues)\n\nEnter your e-mail address \n\nSelect your country - [x] I consent to InfoQ.com handling my data as explained in this [Privacy Notice](https://www.infoq.com/privacy-notice). \n\n[We protect your privacy.](https://www.infoq.com/privacy-notice/)\n\nClose\n\nQCon San Francisco (Nov 16-20): What's next in AI? What's next in software? Learn from the teams already doing it.[Register Now](https://www.infoq.com/url/pb/0dff86f7-3e36-485f-ac4d-20fd0bfba8fc/)\n\nClose \n\nToggle Navigation \n\nFacilitating the Spread of Knowledge and Innovation in Professional Software Development\n\nEnglish edition \n\n*   [English edition](https://www.infoq.com/news/2026/",
      "truncated": true,
      "requestedProvider": "auto",
      "provider": "jina",
      "attempts": [
        "jina"
      ],
      "failures": []
    },
    "live": false
  },
  {
    "query": "Model Context Protocol tool result schema",
    "provider": "exa",
    "results": [
      {
        "url": "https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx",
        "title": "docs/specification/2026-07-28/server/tools.mdx",
        "snippet": "```json\n{\n  \"jsonrpc\": \"2\n...\n\"id\":\n...\n,\n  \"result\": {\n...\ncomplete\",\n    \"tools\": [\n...\n\"name\": \"\n...\n\"title\n...\n\",\n        \"description\": \"\n...\ncurrent weather information\n...\n\",\n        \"inputSchema\": {\n          \"t…",
        "highlights": [
          "```json\n{\n  \"jsonrpc\": \"2\n...\n\"id\":\n...\n,\n  \"result\": {\n...\ncomplete\",\n    \"tools\": [\n...\n\"name\": \"\n...\n\"title\n...\n\",\n        \"description\": \"\n...\ncurrent weather information\n...\n\",\n        \"inputSch…"
        ]
      },
      {
        "url": "https://modelcontextprotocol.io/specification/2025-06-18/server/tools",
        "title": "Tools",
        "snippet": "- `name`: Unique identifier for the tool\n- `title`: Optional human-readable name of the tool for display purposes.\n- `description`: Human-readable description of functionality\n- `inputSchema`: JSON Schema defining expec…",
        "publishedDate": "2025-06-18T00:00:00.000Z",
        "highlights": [
          "- `name`: Unique identifier for the tool\n- `title`: Optional human-readable name of the tool for display purposes.\n- `description`: Human-readable description of functionality\n- `inputSchema`: JSON S…"
        ]
      },
      {
        "url": "https://ts.sdk.modelcontextprotocol.io/v2/advanced/wire-schemas.html",
        "title": "Wire schemas | MCP TypeScript SDK",
        "snippet": "`@modelcontextprotocol/core` exports the wire schemas — the exact Zod constants the SDK validates protocol and OAuth payloads against — for code that holds raw JSON instead of SDK objects.\n...\n`CallToolResultSchema.safe…",
        "favicon": "https://ts.sdk.modelcontextprotocol.io/v2/favicon.svg",
        "highlights": [
          "`@modelcontextprotocol/core` exports the wire schemas — the exact Zod constants the SDK validates protocol and OAuth payloads against — for code that holds raw JSON instead of SDK objects.\n...\n`CallT…"
        ]
      },
      {
        "url": "https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.md",
        "title": "",
        "snippet": "`registerTool` takes a name, a config, and a handler. `inputSchema` is a Zod schema — the only schema you write.\n...\nserver.registerTool(\n    'search',\n    {\n        description: 'Search the product catalog',\n        in…",
        "highlights": [
          "`registerTool` takes a name, a config, and a handler. `inputSchema` is a Zod schema — the only schema you write.\n...\nserver.registerTool(\n    'search',\n    {\n        description: 'Search the product…"
        ]
      },
      {
        "url": "https://github.com/modelcontextprotocol/specification/blob/main/schema/2025-06-18/schema.ts",
        "title": "schema/2025-06-18/schema.ts",
        "snippet": "/* Tools */\n...\n/**\n * The server's response to a tools/list request from the client.\n *\n * @category `tools/list`\n */\n...\nexport interface ListToolsResult extends PaginatedResult {\n tools: Tool[];\n}\n...\n/**\n * The serv…",
        "highlights": [
          "/* Tools */\n...\n/**\n * The server's response to a tools/list request from the client.\n *\n * @category `tools/list`\n */\n...\nexport interface ListToolsResult extends PaginatedResult {\n tools: Tool[];\n}…"
        ]
      }
    ],
    "pagination": "unsupported",
    "ignoredFilters": [],
    "fanout": {
      "results": [
        {
          "url": "https://modelcontextprotocol.io/specification/draft/server/tools",
          "title": "Tools - Model Context Protocol",
          "snippet": "For backwards compatibility, a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block. structuredContent is server-produced result data and is unrelated to LLM “structured out…",
          "favicon": "https://imgs.search.brave.com/fUla7eyz7-xywwv6AJK4QtbFmMtyYgqwO09TeMWI2sg/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvYWVhZDc1YzI5/ZjIxYWY0ODlmMzMy/NDM4MTc1OWI2YzFk/OWEzYzQ4Mzg0NmQ5/YzE1NDc1NjU4OWNk/N2YzZTkyYi9tb2Rl/bGNvbnRleHRwcm90/b2NvbC5pby8",
          "providers": [
            "brave"
          ]
        },
        {
          "url": "https://modelcontextprotocol.info/docs/concepts/tools/",
          "title": "Tools – Model Context Protocol （MCP）",
          "snippet": "Tool errors should be reported within the result object, not as MCP protocol-level errors. This allows the LLM to see and potentially handle the error.",
          "favicon": "https://imgs.search.brave.com/H4ddoNgef9ogbVMDYX3sv_PUneX8MH_dOt6NAmMA4F4/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZjIzMzM1NzI0/MTUzYTM1ZGE0YmE3/NjE1MzFhZTRlMzhi/YmVlMTI0YWM3MWYw/NTAyODI4ZjE2YjRi/ZTcwY2U5Zi9tb2Rl/bGNvbnRleHRwcm90/b2NvbC5pbmZvLw",
          "providers": [
            "brave",
            "tinyfish"
          ]
        },
        {
          "url": "https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools",
          "title": "AI SDK Core: Model Context Protocol (MCP)",
          "snippet": "When MCP servers return structuredContent (per the MCP specification), you can define an outputSchema to get typed tool results: ... If the server doesn&#x27;t return structuredContent, the client falls back to parsing…",
          "favicon": "https://imgs.search.brave.com/SgkeI_2K9xJ5Wcw6FVh-mAVPLLFKY-3sEK4T_7ZiDkI/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvNWNlNTg0MTdh/YTkzYzBjMDIwODMw/NWM1YWUzMzk4NTg2/MGQ1YjY2YTYzOTQz/ZGE4MjlhMDY3Nzhl/NTZlYmM5NS9haS1z/ZGsuZGV2Lw",
          "providers": [
            "brave"
          ]
        },
        {
          "url": "https://obot.ai/resources/learning-center/mcp-tools/",
          "title": "Defining and Implementing MCP Tools: a Practical Guide | Obot AI",
          "snippet": "For example, a model might use an MCP tool to check a user’s calendar, retrieve market prices, or trigger a workflow in a business application using standardized protocol messages and well-described tool capabilities. T…",
          "favicon": "https://imgs.search.brave.com/_pBOn4jryFGOsE6iY2enCq1Bawm4a3EWf3CtwTQ_n_Y/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvOTM0NGRiOTNk/YTViZTdhYTczYzVh/ZjY3MTQyOTNjNGY3/MWQ2NDQ1Y2JlOWVj/ZDc1MWZhZmNhNGYz/NWEzMjQ4NS9vYm90/LmFpLw",
          "providers": [
            "brave"
          ]
        },
        {
          "url": "https://github.com/modelcontextprotocol/modelcontextprotocol",
          "title": "GitHub - modelcontextprotocol/modelcontextprotocol: Specification and documentation for the Model Context Protocol · Gi…",
          "snippet": "The schema is defined in TypeScript first, but made available as JSON Schema as well, for wider compatibility. The official MCP documentation is built using Mintlify and available at modelcontextprotocol.io. The Model C…",
          "favicon": "https://imgs.search.brave.com/xxsA4YxzaR0cl-DBsH9-lpv2gsif3KMYgM87p26bs_o/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvYWQyNWM1NjA5/ZjZmZjNlYzI2MDNk/N2VkNmJhYjE2MzZl/MDY5ZTMxMDUzZmY1/NmU3NWIzNWVmMjk0/NTBjMjJjZi9naXRo/dWIuY29tLw",
          "providers": [
            "brave",
            "firecrawl",
            "tinyfish"
          ]
        },
        {
          "url": "https://www.webfuse.com/mcp-cheat-sheet",
          "title": "MCP Cheat Sheet: Complete Model Context Protocol Reference (2026)",
          "snippet": "Defined security model - OAuth 2.0, TLS, sandboxing, consent flows · Rich context types - Tools, Resources, and Prompts in one protocol · Dynamic updates - servers notify hosts when capabilities change · Human-in-the-lo…",
          "favicon": "https://imgs.search.brave.com/HDOVwUmQCnrqUiud3Zl-u08qdXuvRbkY_sx4qeXXlGs/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvMTU3MTNlNDkz/NDBlNmMyM2E3Yzhj/ZGM3NGU1MDBiMWJl/NWU4NzdjMmI1YmEw/ZTJjZjM0MWZjYmRh/YzIwNWU5Yi93d3cu/d2ViZnVzZS5jb20v",
          "providers": [
            "brave"
          ]
        }
      ],
      "successfulProviders": [
        "brave",
        "exa",
        "firecrawl",
        "tavily",
        "tinyfish"
      ],
      "errors": [
        {
          "provider": "serpapi",
          "message": "Rate limited. Retry after 60s"
        },
        {
          "provider": "serpbase",
          "message": "SerpBase insufficient credits: insufficient credits"
        }
      ],
      "total": 6
    },
    "read": {
      "url": "https://modelcontextprotocol.io/specification/draft/server/tools",
      "title": "Tools - Model Context Protocol",
      "content": "The Model Context Protocol (MCP) allows servers to expose tools that can be invoked by language models. Tools enable models to interact with external systems, such as querying databases, calling APIs, or performing computations. Each tool is uniquely identified by a name and includes metadata describing its schema.\n\n## User Interaction Model\n\nTools in MCP are designed to be **model-controlled**, meaning that the language model can discover and invoke tools automatically based on its contextual understanding and the user’s prompts.However, implementations are free to expose tools through any interface pattern that suits their needs—the protocol itself does not mandate any specific user interaction model.\n\n## Capabilities\n\nServers that support tools **MUST** declare the `tools` capability:\n\n`listChanged` indicates whether the server will emit notifications when the list of available tools ",
      "truncated": true,
      "requestedProvider": "auto",
      "provider": "jina",
      "attempts": [
        "jina"
      ],
      "failures": []
    },
    "live": false
  },
  {
    "query": "Nitro cloudflare workers preset",
    "provider": "tavily",
    "results": [
      {
        "url": "https://nitro.build/deploy/providers/cloudflare",
        "title": "Cloudflare - Nitro",
        "snippet": "Nitro logoNitro\n\n# Cloudflare\n\nDeploy Nitro apps to Cloudflare.\n\n## Cloudflare Workers\n\nPreset: `cloudflare_module`\n\nRead more in Cloudflare Workers.\n\nIntegration with this provider is possible with zero configuration s…",
        "score": 0.888
      },
      {
        "url": "https://nitro-docs.pages.dev/deploy/providers/cloudflare",
        "title": "Cloudflare Workers",
        "snippet": "NitroJS LogoNitroJS Logo\n\nNitroJS LogoNitroJS Logo\n\n# Cloudflare\n\nDeploy Nitro apps to CloudFlare.\n\n## Cloudflare Workers\n\nPreset: `cloudflare` (switch to this preset)\n\nNote: This preset uses service-worker syntax for d…",
        "score": 0.889
      },
      {
        "url": "https://github.com/nitrojs/nitro/discussions/2876",
        "title": "Confused about which Cloudflare preset to use and basic ...",
        "snippet": "me. Wrangler Preset vs Nitro Present This is where it gets interesting: If I create worker for Nuxt based on CF's own recommended command `npm create cloudflare@latest my-nuxt-app -- --framework=nuxt --experimental`, I…",
        "score": 0.839
      },
      {
        "url": "https://github.com/nitrojs/nitro-cloudflare-dev",
        "title": "nitrojs/nitro-cloudflare-dev: Enable access to the ...",
        "snippet": "`getPlatformProxy`\n\nNote\n\nNitro plans to introduce a new method to allow native dev presets, meaning you can natively run miniflare as your development server without this module or a proxy in the future!\n\n## Usage\n\nFir…",
        "score": 0.561
      },
      {
        "url": "https://nuxt.com/deploy/cloudflare",
        "title": "Deploy Nuxt to Cloudflare",
        "snippet": "Terminal\n\n```\nnpx nuxi build --preset=cloudflare_pages npx  nuxi  build --preset=cloudflare_pages \n```\n\n1. Deploy, it will ask you to create a project for the first time:\n\nTerminal\n\n```\nnpx wrangler pages deploy dist/ n…",
        "score": 0.581
      }
    ],
    "pagination": "unsupported",
    "ignoredFilters": [],
    "fanout": {
      "results": [
        {
          "url": "https://nitro.build/deploy/providers/cloudflare",
          "title": "Cloudflare - Nitro",
          "snippet": "Cloudflare Workers is <strong>the new recommended preset for deployments</strong>.",
          "favicon": "https://imgs.search.brave.com/GDw_FesANlXT3hGg2mVS-7aTfue76lGBelQKN45OEkk/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvYWM5MWM0ZjY3/YmJmMDA2ODVjZWVi/ZTE5MDIwM2YzMGU2/N2M3ZjA2ODQzOGMx/ZWFhNDRhYmRiNzFj/YjFhNjhmYy9uaXRy/by5idWlsZC8",
          "providers": [
            "brave",
            "exa",
            "firecrawl",
            "tavily",
            "tinyfish"
          ]
        },
        {
          "url": "https://github.com/nitrojs/nitro/discussions/2876",
          "title": "Confused about which Cloudflare preset to use and basic setup for workers · nitrojs/nitro · Discussion #2876",
          "snippet": "When you create a new Nuxt app, ... usable presets: ... I want to use observability, cron, durable objects etc. in my app so I understand workers is the one for me. This is where it gets interesting: If I create worker…",
          "favicon": "https://imgs.search.brave.com/xxsA4YxzaR0cl-DBsH9-lpv2gsif3KMYgM87p26bs_o/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvYWQyNWM1NjA5/ZjZmZjNlYzI2MDNk/N2VkNmJhYjE2MzZl/MDY5ZTMxMDUzZmY1/NmU3NWIzNWVmMjk0/NTBjMjJjZi9naXRo/dWIuY29tLw",
          "providers": [
            "brave",
            "firecrawl",
            "tavily",
            "tinyfish"
          ]
        },
        {
          "url": "https://nitro-docs.pages.dev/deploy/providers/cloudflare/",
          "title": "Cloudflare Workers - Nitro",
          "snippet": "Login to your Cloudflare Workers account and obtain your account_id from the sidebar. ... name = &quot;playground&quot; main = &quot;./.output/server/index.mjs&quot; workers_dev = true compatibility_date = &quot;2022-09…",
          "favicon": "https://imgs.search.brave.com/dRhCiSSLNrZW2UMyY3ksqG4MlSfWVEvogloiJfN7v3Y/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvMmRjMmIyNGUx/NDg2NjA1ZjBiODAw/Mzc2OTJjMDhhMjg0/ZGYyMmM5ZTI3Y2Yz/MTY5N2YzMzMzNDNl/MmRkOWVlZS9uaXRy/by1kb2NzLnBhZ2Vz/LmRldi8",
          "providers": [
            "brave",
            "firecrawl",
            "tavily",
            "tinyfish"
          ]
        },
        {
          "url": "https://nitro.build/deploy",
          "title": "Deploy - Nitro",
          "snippet": "NITRO_PRESET=cloudflare_pages nitro build # or nitro build --preset cloudflare_pages",
          "favicon": "https://imgs.search.brave.com/GDw_FesANlXT3hGg2mVS-7aTfue76lGBelQKN45OEkk/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvYWM5MWM0ZjY3/YmJmMDA2ODVjZWVi/ZTE5MDIwM2YzMGU2/N2M3ZjA2ODQzOGMx/ZWFhNDRhYmRiNzFj/YjFhNjhmYy9uaXRy/by5idWlsZC8",
          "providers": [
            "brave"
          ]
        },
        {
          "url": "https://github.com/nitrojs/nitro/discussions/2214",
          "title": "Why is cloudflare module workers preset not recommended? · nitrojs/nitro · Discussion #2214",
          "snippet": "Workers Sites is practically unofficially deprecated in favour of Pages so that&#x27;s the reason why <strong>the module workers preset is not recommended</strong> (not because we specifically want people not to use wor…",
          "favicon": "https://imgs.search.brave.com/xxsA4YxzaR0cl-DBsH9-lpv2gsif3KMYgM87p26bs_o/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvYWQyNWM1NjA5/ZjZmZjNlYzI2MDNk/N2VkNmJhYjE2MzZl/MDY5ZTMxMDUzZmY1/NmU3NWIzNWVmMjk0/NTBjMjJjZi9naXRo/dWIuY29tLw",
          "providers": [
            "brave"
          ]
        },
        {
          "url": "https://deepwiki.com/huang-julien/nitro-opentelemetry/4.4-cloudflare-worker-preset",
          "title": "Cloudflare Worker Preset | huang-julien/nitro-opentelemetry | DeepWiki",
          "snippet": "The Cloudflare Worker preset implementation is <strong>minimal but critical, serving as a wrapper around the application&#x27;s main handler</strong>. ... runtime/presets/cf-worker.ts ├── import instrument from @microla…",
          "favicon": "https://imgs.search.brave.com/HJkhFaX_DbIorFWn0JxBTQ4cUEWc8_tIf0-UJ5OyYXM/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvYjA3YmY5YmI1/YjhkZTQ5NTA1ZTcx/MTVmNzZkZjE3NjM0/MzdiNDY3MzUxZjVh/MGU3ODJlZGVhYTk1/ZWRmOTU3ZC9kZWVw/d2lraS5jb20v",
          "providers": [
            "brave"
          ]
        }
      ],
      "successfulProviders": [
        "brave",
        "exa",
        "firecrawl",
        "tavily",
        "tinyfish"
      ],
      "errors": [
        {
          "provider": "serpapi",
          "message": "Rate limited. Retry after 60s"
        },
        {
          "provider": "serpbase",
          "message": "SerpBase insufficient credits: insufficient credits"
        }
      ],
      "total": 6
    },
    "read": {
      "url": "https://nitro.build/deploy/providers/cloudflare",
      "title": "Cloudflare - Nitro",
      "content": "## [#](https://nitro.build/deploy/providers/cloudflare#cloudflare-workers)Cloudflare Workers\n\n**Preset:**`cloudflare_module`\n\n[Read more in Cloudflare Workers.](https://developers.cloudflare.com/workers/)\n\nNote\n\nIntegration with this provider is possible with [zero configuration](https://nitro.build/deploy#zero-config-providers) supporting [workers builds (beta)](https://developers.cloudflare.com/workers/ci-cd/builds/).\n\nThe following shows an example `nitro.config.ts` file for deploying a Nitro app to Cloudflare Workers.\n\n### [#](https://nitro.build/deploy/providers/cloudflare#local-preview)Local Preview\n\nYou can use [Wrangler](https://github.com/cloudflare/workers-sdk/tree/main/packages/wrangler) to preview your app locally:\n\n### [#](https://nitro.build/deploy/providers/cloudflare#manual-deploy)Manual Deploy\n\nAfter building your application you can manually deploy it with Wrangler.\n\nFi",
      "truncated": true,
      "requestedProvider": "auto",
      "provider": "jina",
      "attempts": [
        "jina"
      ],
      "failures": []
    },
    "live": false
  },
  {
    "query": "Vercel AI SDK tool calling",
    "provider": "firecrawl",
    "results": [
      {
        "url": "https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling",
        "title": "AI SDK Core: Tool Calling",
        "snippet": "# [Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling#tool-calling)\n```ts\n1import { z } from 'zod';\n\n2import { generateText, tool, isStepCount } from 'ai';\n\n3\n\n4const result = await generateText({…"
      },
      {
        "url": "https://ai-sdk.dev/docs/foundations/tools",
        "title": "Foundations: Tools - AI SDK",
        "snippet": "# [Tools](https://ai-sdk.dev/docs/foundations/tools#tools)\n## [Types of Tools](https://ai-sdk.dev/docs/foundations/tools#types-of-tools)\n### [Provider-Executed Tools](https://ai-sdk.dev/docs/foundations/tools#provider-e…"
      },
      {
        "url": "https://vercel.com/academy/ai-sdk/tool-use",
        "title": "Tool Use | Vercel Academy",
        "snippet": "# [Tool Calling to Connect to External Data Sources](https://vercel.com/academy/ai-sdk/tool-use#tool-calling-to-connect-to-external-data-sources)\nTools let your AI call functions to fetch data, perform calculations, or…"
      },
      {
        "url": "https://ai-sdk.dev/",
        "title": "Vercel AI SDK",
        "snippet": "# Universal AI layer for building frameworks and agents\n```typescript\n1import { generateText } from 'ai';\n\n2\n\n3const { text } = await generateText({\n\n4  model: \"xai/grok-4.6\",\n\n5  prompt: 'Explain the concept of quantum…"
      },
      {
        "url": "https://www.aihero.dev/tool-calls-with-vercel-ai-sdk",
        "title": "Tool Calling With Vercel's AI SDK - AI Hero",
        "snippet": "# Tool Calling With Vercel's AI SDK\n```\nimport { tool } from \"ai\";\n\nconst logToConsoleTool = tool({});\n```\n\n```\nHello, world!\n```\n\nSuccess!\n\n## [Debugging](https://www.aihero.dev/tool-calls-with-vercel-ai-sdk#debugging)…"
      }
    ],
    "pagination": "unsupported",
    "ignoredFilters": [],
    "fanout": {
      "results": [
        {
          "url": "https://vercel.com/docs/ai-sdk",
          "title": "AI SDK",
          "snippet": "<strong>Let models interact with external systems · Streaming first. Stream text, objects, and UI to your frontend · Framework support. Works with React, Next.js, Vue, Svelte, and Node.js · At the center of the AI SDK i…",
          "favicon": "https://imgs.search.brave.com/BNSQrXn2bmeJXUV454rdF3_0T8nAzszmcKdxq9LZbwQ/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZDQ5YzljMTg4/MmJjMjJkYzEzMWZi/YmYyODM3ZjEyYzEw/MjY5OWFlM2I5YTY1/YmZhNTJlY2EwM2Iz/N2RhMWIxOC92ZXJj/ZWwuY29tLw",
          "providers": [
            "brave"
          ]
        },
        {
          "url": "https://vercel.com/academy/ai-sdk/tool-use",
          "title": "Tool Use | Vercel Academy",
          "snippet": "Model Generates Tool Call: <strong>Outputs structured request to call specific tool with inferred parameters</strong>. SDK Executes Tool: API route receives call, SDK invokes execute function.",
          "favicon": "https://imgs.search.brave.com/BNSQrXn2bmeJXUV454rdF3_0T8nAzszmcKdxq9LZbwQ/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZDQ5YzljMTg4/MmJjMjJkYzEzMWZi/YmYyODM3ZjEyYzEw/MjY5OWFlM2I5YTY1/YmZhNTJlY2EwM2Iz/N2RhMWIxOC92ZXJj/ZWwuY29tLw",
          "providers": [
            "brave",
            "exa",
            "firecrawl",
            "tavily",
            "tinyfish"
          ]
        },
        {
          "url": "https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling",
          "title": "AI SDK Core: Tool Calling",
          "snippet": "Tool Call Repair · Example: Use a model with structured outputs for repair · Example: Use the re-ask strategy for repair · Active Tools · Tool Order · Multi-modal Tool Results · Extracting Tools · MCP Tools · AI SDK Too…",
          "favicon": "https://imgs.search.brave.com/SgkeI_2K9xJ5Wcw6FVh-mAVPLLFKY-3sEK4T_7ZiDkI/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvNWNlNTg0MTdh/YTkzYzBjMDIwODMw/NWM1YWUzMzk4NTg2/MGQ1YjY2YTYzOTQz/ZGE4MjlhMDY3Nzhl/NTZlYmM5NS9haS1z/ZGsuZGV2Lw",
          "providers": [
            "brave",
            "exa",
            "firecrawl",
            "tavily",
            "tinyfish"
          ]
        },
        {
          "url": "https://www.aihero.dev/tool-calls-with-vercel-ai-sdk",
          "title": "Tool Calling With Vercel's AI SDK",
          "snippet": "The way they do that is by calling tools or functions that we provide them. And Vercel&#x27;s AI SDK has a first-class solution for that.",
          "favicon": "https://imgs.search.brave.com/tG7pNYkpnQafcc3IOrv0o5pef_nJEcQG9hMO6qgLpwo/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvMzc5NzkzZjQ0/MjBkMzQ3NTcwMWRi/YWYyMGMwNzdmODcy/YTg5YzAyNmZiOWZh/NmIwNjg4Y2I5Mjcx/YjNiNTliNy93d3cu/YWloZXJvLmRldi8",
          "providers": [
            "brave",
            "firecrawl",
            "tavily",
            "tinyfish"
          ]
        },
        {
          "url": "https://vercel.com/blog/ai-sdk-6",
          "title": "AI SDK 6 - Vercel",
          "snippet": "Previously, combining tool calling with structured output required chaining generateText and generateObject together. AI SDK 6 unifies generateObject and generateText to enable multi-step tool calling loops with structu…",
          "favicon": "https://imgs.search.brave.com/BNSQrXn2bmeJXUV454rdF3_0T8nAzszmcKdxq9LZbwQ/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZDQ5YzljMTg4/MmJjMjJkYzEzMWZi/YmYyODM3ZjEyYzEw/MjY5OWFlM2I5YTY1/YmZhNTJlY2EwM2Iz/N2RhMWIxOC92ZXJj/ZWwuY29tLw",
          "providers": [
            "brave"
          ]
        },
        {
          "url": "https://vercel.com/templates/next.js/ai-sdk-roundtrips",
          "title": "Automatic Tool Call Roundtrips with Vercel AI SDK - Vercel",
          "snippet": "A Next.js chatbot using the Vercel AI SDK&#x27;s streamText function to automatically handle multiple tool call roundtrips.",
          "favicon": "https://imgs.search.brave.com/BNSQrXn2bmeJXUV454rdF3_0T8nAzszmcKdxq9LZbwQ/rs:fit:32:32:1:0/g:ce/aHR0cDovL2Zhdmlj/b25zLnNlYXJjaC5i/cmF2ZS5jb20vaWNv/bnMvZDQ5YzljMTg4/MmJjMjJkYzEzMWZi/YmYyODM3ZjEyYzEw/MjY5OWFlM2I5YTY1/YmZhNTJlY2EwM2Iz/N2RhMWIxOC92ZXJj/ZWwuY29tLw",
          "providers": [
            "brave",
            "firecrawl",
            "tavily"
          ]
        }
      ],
      "successfulProviders": [
        "brave",
        "exa",
        "firecrawl",
        "tavily",
        "tinyfish"
      ],
      "errors": [
        {
          "provider": "serpapi",
          "message": "Rate limited. Retry after 60s"
        },
        {
          "provider": "serpbase",
          "message": "SerpBase insufficient credits: insufficient credits"
        }
      ],
      "total": 6
    },
    "read": {
      "url": "https://vercel.com/docs/ai-sdk",
      "title": "AI SDK",
      "content": "[Skip to content](https://vercel.com/docs/ai-sdk#geist-skip-nav)\n\n[](https://vercel.com/home)\n\nCopy Wordmark Copy Logo\n\nDownload Brand Assets Brand Guidelines\n\n[Docs](https://vercel.com/docs)\n\nBuild\n\n##### Build with AI\n\n*   [AI Gateway](https://vercel.com/docs/ai-gateway)\n*   [AI SDK](https://vercel.com/docs/ai-sdk)\n*   [Sandbox](https://vercel.com/docs/sandbox)\n*   [Container Registry](https://vercel.com/docs/container-registry)\n*   [Workflow](https://vercel.com/docs/workflows)\n*   [Vercel Agent](https://vercel.com/docs/agent)\n*   [v0↗](https://v0.app/)\n*   [Vercel MCP](https://vercel.com/docs/mcp)\n*   [AI Integrations](https://vercel.com/docs/agent-resources/integrations-for-models)\n\n##### Deploy & scale\n\n*   [Deployments](https://vercel.com/docs/deployments)\n*   [CLI](https://vercel.com/docs/cli)\n*   [Functions](https://vercel.com/docs/functions)\n*   [Delivery Network](https://vercel",
      "truncated": true,
      "requestedProvider": "auto",
      "provider": "jina",
      "attempts": [
        "jina"
      ],
      "failures": []
    },
    "live": false
  }
];
