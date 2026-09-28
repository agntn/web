import { resolve } from "node:path";
import { createSourceBuildId } from "../src/build-id.ts";
import { webTheme } from "./shiki-theme";

/** Bundled from the checkout's sources: a deploy needs neither dist/ nor the root node_modules. */
const librarySource = resolve(import.meta.dirname, "../src");

export default defineNuxtConfig({
  extends: ["docus"],
  /** The repo root is its own pnpm workspace; Nuxt must not treat it as this site's. */
  workspaceDir: import.meta.dirname,
  alias: {
    "@agntn/web": resolve(librarySource, "index.ts"),
  },
  devtools: { enabled: false },
  telemetry: false,
  site: {
    url: "https://web.agntn.dev",
    name: "@agntn/web",
  },
  llms: {
    domain: "https://web.agntn.dev",
  },
  /** Docus pages define their own OG images; the alt text is the one thing they leave unset. */
  ogImage: {
    defaults: {
      alt: "@agntn/web: one query, every engine",
    },
  },
  icon: {
    clientBundle: {
      icons: [
        "lucide:arrow-down",
        "lucide:arrow-left",
        "lucide:arrow-right",
        "lucide:arrow-up",
        "lucide:arrow-up-right",
        "lucide:book-open",
        "lucide:book-text",
        "lucide:bot",
        "lucide:check",
        "lucide:check-circle",
        "lucide:chevron-down",
        "lucide:chevron-left",
        "lucide:chevron-right",
        "lucide:chevrons-up-down",
        "lucide:circle-alert",
        "lucide:circle-x",
        "lucide:compass",
        "lucide:copy",
        "lucide:expand",
        "lucide:external-link",
        "lucide:file-text",
        "lucide:fish",
        "lucide:flame",
        "lucide:git-fork",
        "lucide:globe",
        "lucide:image",
        "lucide:info",
        "lucide:layers",
        "lucide:library",
        "lucide:lightbulb",
        "lucide:link",
        "lucide:loader-circle",
        "lucide:notebook-text",
        "lucide:plus",
        "lucide:scan-search",
        "lucide:search",
        "lucide:shuffle",
        "lucide:sparkles",
        "lucide:terminal",
        "lucide:triangle-alert",
        "lucide:x",
        "simple-icons:anthropic",
        "simple-icons:brave",
        "simple-icons:cursor",
        "simple-icons:github",
        "simple-icons:markdown",
        "simple-icons:mojeek",
        "simple-icons:npm",
        "simple-icons:openai",
        "simple-icons:searxng",
        "vscode-icons:file-type-js",
        "vscode-icons:file-type-json",
        "vscode-icons:file-type-shell",
        "vscode-icons:file-type-typescript",
      ],
    },
  },
  colorMode: {
    preference: "dark",
  },
  app: {
    head: {
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
      meta: [
        { name: "theme-color", content: "#0b0d10" },
        { name: "apple-mobile-web-app-title", content: "web" },
      ],
    },
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
    /** Vite+ Pack defines this for dist/; the sources otherwise hash the package root at load time, which the bundle cannot reach. */
    replace: {
      __AGNTN_WEB_BUILD_ID__: JSON.stringify(createSourceBuildId(resolve(librarySource, ".."))),
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
      { name: "Figtree", provider: "local", weights: [400, 500] },
      { name: "Fira Code", provider: "local", weights: [400, 500] },
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
            default: webTheme,
            light: webTheme,
            dark: webTheme,
          },
        },
      },
    },
  },
});
