import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
  extends: ["docus"],
  /** The repo root is its own pnpm workspace; Nuxt must not treat it as this site's. */
  workspaceDir: fileURLToPath(new URL("./", import.meta.url)),
  devtools: { enabled: false },
  telemetry: false,
  site: {
    url: "https://web.agntn.dev",
    name: "@agntn/web",
  },
  llms: {
    domain: "https://web.agntn.dev",
  },
  icon: {
    clientBundle: {
      icons: [
        "lucide:arrow-right",
        "lucide:arrow-up-right",
        "lucide:book-open",
        "lucide:book-text",
        "lucide:bot",
        "lucide:check",
        "lucide:chevron-left",
        "lucide:chevron-right",
        "lucide:compass",
        "lucide:copy",
        "lucide:external-link",
        "lucide:file-text",
        "lucide:fish",
        "lucide:flame",
        "lucide:git-fork",
        "lucide:globe",
        "lucide:image",
        "lucide:layers",
        "lucide:library",
        "lucide:link",
        "lucide:loader-circle",
        "lucide:plus",
        "lucide:scan-search",
        "lucide:search",
        "lucide:shield-alert",
        "lucide:sparkles",
        "lucide:terminal",
        "lucide:x",
        "simple-icons:brave",
        "simple-icons:github",
        "simple-icons:mojeek",
        "simple-icons:npm",
        "simple-icons:searxng",
        "vscode-icons:file-type-js",
        "vscode-icons:file-type-typescript",
        "vscode-icons:file-type-json",
        "vscode-icons:file-type-shell",
      ],
    },
  },
  colorMode: {
    preference: "dark",
  },
  /** Docus ships an MCP endpoint that needs the Cloudflare Agents SDK on Workers. The docs do not need it. */
  mcp: {
    enabled: false,
  },
  nitro: {
    preset: "cloudflare_module",
    compatibilityDate: "2026-09-03",
    prerender: {
      crawlLinks: true,
      routes: ["/", "/sitemap.xml", "/robots.txt", "/llms.txt", "/llms-full.txt"],
      ignore: ["/api"],
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
  compatibilityDate: "2026-09-03",
  /** In production the response cache lives in KV, so it survives isolates. */
  $production: {
    nitro: {
      storage: {
        cache: {
          driver: "cloudflare-kv-binding",
          binding: "CACHE",
        },
      },
    },
  },
  /** Fonts live in public/fonts and app/assets/fonts.css, which is the only place nuxt-og-image reads them from. */
  css: ["~/assets/fonts.css"],
  fonts: {
    families: [
      { name: "Space Grotesk", provider: "local", weights: [400, 500, 600] },
      { name: "Space Mono", provider: "local", weights: [400, 700] },
    ],
  },
  content: {
    database: {
      type: "d1",
      bindingName: "DB",
    },
    build: {
      markdown: {
        highlight: {
          theme: {
            default: "github-light",
            light: "github-light",
            dark: "poimandres",
          },
        },
      },
    },
  },
});
