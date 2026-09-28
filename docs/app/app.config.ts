export default defineAppConfig({
  docus: {
    colorMode: "dark",
  },
  seo: {
    title: "@agntn/web",
    description:
      "One TypeScript interface over Brave, Exa, Tavily, Firecrawl, Jina, SearXNG and seven more: query in, normalized results out.",
  },
  header: {
    title: "@agntn/web",
  },
  /** Sections as tabs under the header, so the sidebar holds one section. */
  navigation: {
    sub: "header",
  },
  github: {
    url: "https://github.com/agntn/web",
    branch: "main",
    rootDir: "docs",
  },
  /** Docus adds the repository link itself, a GitHub social next to it is the same icon twice. */
  socials: {
    npm: "https://www.npmjs.com/package/@agntn/web",
  },
  ui: {
    colors: {
      primary: "amber",
      neutral: "slate",
    },
    /**
     * Buttons in the instrument grammar, by variant, so a page writes <UButton> and gets the look
     * from app.css: primary solid and neutral outline are boxed actions with the glyph in its own
     * cell, neutral subtle the small control of an instrument (`square` for a step button), and
     * the site's own `chip` variant a chip, primary for the picked one. Docus renders its search
     * field as neutral soft and its own buttons as neutral ghost and link, so those stay default.
     */
    button: {
      slots: {
        base: "h-9 rounded-lg px-3.5 text-sm leading-none font-medium cursor-pointer transition-colors",
      },
      variants: {
        variant: {
          chip: "",
        },
      },
      compoundVariants: [
        {
          color: "primary",
          variant: "solid",
          class: "web-action web-action-primary ring-0",
        },
        {
          color: "neutral",
          variant: "outline",
          class: "web-action ring-0",
        },
        {
          color: "neutral",
          variant: "subtle",
          class: "web-control ring-0",
        },
        {
          color: "neutral",
          variant: "subtle",
          square: true,
          class: "web-control-square",
        },
        {
          color: "neutral",
          variant: "chip",
          class: "web-chip",
        },
        {
          color: "primary",
          variant: "chip",
          class: "web-chip web-chip-on",
        },
      ],
    },
    /** Status words as boxed mono capitals: neutral quiet, subtle bright, primary the accent, error red. */
    badge: {
      slots: {
        base: "web-badge",
      },
      compoundVariants: [
        { color: "neutral", variant: "subtle", class: "web-badge-bright ring-0" },
        { color: "neutral", variant: "outline", class: "ring-0" },
        { color: "primary", variant: "outline", class: "web-badge-accent ring-0" },
        { color: "error", variant: "outline", class: "web-badge-error ring-0" },
      ],
    },
    /** Tabs as mono capitals on a quiet rule, the active one over an accent segment. */
    tabs: {
      compoundVariants: [
        {
          variant: "link",
          class: {
            list: "web-tabs-list",
            trigger: "web-tabs-trigger",
            indicator: "web-tabs-indicator",
          },
        },
      ],
    },
    /** A field with variant none sits inside a readout row: the row is its frame, the value is mono. */
    input: {
      compoundVariants: [
        { variant: "none", class: { base: "web-field", leadingIcon: "web-field-icon" } },
      ],
    },
    selectMenu: {
      slots: {
        content: "web-menu rounded-none ring-0 shadow-none bg-transparent",
        group: "web-menu-group",
        item: "web-menu-item",
        itemLeadingIcon: "web-field-icon",
        input: "web-menu-input",
      },
      compoundVariants: [
        {
          variant: "none",
          class: {
            base: "web-field",
            leadingIcon: "web-field-icon",
            trailingIcon: "web-field-icon",
          },
        },
      ],
    },
    /** A failed read: a red edge and the message in mono, no box. */
    alert: {
      compoundVariants: [
        {
          color: "error",
          variant: "outline",
          class: {
            root: "web-alert ring-0",
            title: "web-alert-title",
            icon: "web-alert-icon",
          },
        },
      ],
    },
    /** A tooltip is a console label: flat, clipped corner, mono, and it wraps, because it carries full addresses. */
    tooltip: {
      slots: {
        content:
          "web-tooltip h-auto max-w-[min(32rem,calc(100vw-2rem))] rounded-none bg-transparent shadow-none ring-0 px-3 py-1.5 data-[state=delayed-open]:animate-none data-[state=closed]:animate-none",
        text: "whitespace-normal text-highlighted [overflow-wrap:anywhere]",
      },
    },
    /** The site header, the search field and the keys in the instrument grammar; the look lives in app.css. */
    header: {
      slots: {
        root: "web-site-header",
      },
    },
    contentSearchButton: {
      slots: {
        base: "web-search",
      },
    },
    /** The search modal and its palette in the instrument grammar; the look lives in app.css (portalled). */
    contentSearch: {
      slots: {
        modal: "web-search-modal",
      },
    },
    commandPalette: {
      slots: {
        root: "web-palette",
        input: "web-palette-input",
        close: "web-palette-close",
        group: "web-palette-group",
        label: "web-palette-label",
        item: "web-palette-item",
        itemLeadingIcon: "web-palette-icon",
        itemLabel: "web-palette-text",
        itemLabelBase: "web-palette-name",
        itemDescription: "web-palette-about",
        empty: "web-palette-empty",
      },
    },
    kbd: {
      base: "web-kbd",
    },
    pageHeader: {
      slots: {
        root: "web-page-header py-8 border-b-0",
        headline: "web-eyebrow mb-3",
        title: "text-3xl sm:text-4xl font-medium tracking-tight text-highlighted",
        description: "text-base leading-7 text-muted",
      },
    },
    /**
     * The layouts with a right aside get one track per panel instead of the ten column grid: the toc
     * takes a fixed 13.75rem, a little wider than Nuxt UI's, and the text keeps 52rem on a large
     * screen, the width the rosters need before they stack.
     */
    page: {
      compoundVariants: [
        {
          left: true,
          right: true,
          class: {
            root: "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_min(13.75rem,20%)]",
            left: "lg:col-span-1",
            center: "lg:col-span-1",
            right: "lg:col-span-1",
          },
        },
        {
          left: false,
          right: true,
          class: {
            root: "lg:grid-cols-[minmax(0,1fr)_min(13.75rem,20%)]",
            center: "lg:col-span-1",
            right: "lg:col-span-1",
          },
        },
      ],
    },
    /** Nuxt UI truncates TOC entries; headings here are sentences, so let them wrap. */
    contentToc: {
      slots: {
        linkText: "whitespace-normal",
      },
    },
    prose: {
      callout: {
        slots: {
          base: "rounded-xl px-4 py-3.5",
        },
      },
      /** Inline code in the instrument grammar; the look lives in `.web-code` in app.css. */
      code: {
        base: "web-code",
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
