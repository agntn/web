export default defineAppConfig({
  docus: {
    colorMode: "dark",
  },
  seo: {
    title: "@agntn/web",
    description:
      "One TypeScript interface over Brave, Exa, Tavily, Firecrawl, Jina, SearXNG and five more: query in, normalized results out.",
  },
  header: {
    title: "@agntn/web",
  },
  github: {
    url: "https://github.com/agntn/web",
    branch: "main",
    rootDir: "docs",
  },
  socials: {
    github: "https://github.com/agntn/web",
    npm: "https://www.npmjs.com/package/@agntn/web",
  },
  ui: {
    colors: {
      primary: "teal",
      neutral: "slate",
    },
    button: {
      slots: {
        base: "h-9 rounded-lg px-3.5 text-sm leading-none font-medium cursor-pointer transition-colors",
      },
      compoundVariants: [
        {
          color: "primary",
          variant: "solid",
          class: "web-primary-fill ring-0",
        },
        {
          color: "neutral",
          variant: "outline",
          class: "web-neutral-outline ring-0",
        },
      ],
    },
    pageHeader: {
      slots: {
        root: "py-8 border-b border-muted",
        headline: "web-eyebrow mb-3",
        title: "text-3xl sm:text-4xl font-medium tracking-tight text-highlighted",
        description: "text-base leading-7 text-muted",
      },
    },
    contentSurround: {
      slots: {
        link: "rounded-xl web-frame border-0 bg-default hover:bg-muted",
        linkLeadingIcon: "text-muted",
      },
    },
    prose: {
      callout: {
        slots: {
          base: "rounded-xl px-4 py-3.5",
        },
      },
      card: {
        slots: {
          base: "rounded-xl web-frame border-0 p-5 bg-default hover:bg-muted",
          icon: "size-5 mb-3 text-muted transition-colors group-hover:text-primary",
          title: "text-sm font-medium",
          description: "text-sm text-muted",
        },
      },
      cardGroup: {
        base: "grid grid-cols-1 sm:grid-cols-2 gap-3 my-5 *:my-0",
      },
      table: {
        slots: {
          root: "rounded-xl web-frame",
        },
      },
      pre: {
        slots: {
          header: "border-default bg-default",
          base: "border-default bg-muted",
        },
      },
    },
    pageHero: {
      slots: {
        title: "font-medium tracking-tight",
        description: "text-base leading-7 sm:text-lg",
      },
    },
  },
});
