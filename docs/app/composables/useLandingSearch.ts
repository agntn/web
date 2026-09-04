import { LANDING_SAMPLES, type SearchSample } from "../utils/landing-fixtures";

interface SearchAnswer {
  provider: string;
  results: SearchSample["results"];
  pagination: SearchSample["pagination"];
  ignoredFilters: readonly string[];
}

interface FanoutAnswer {
  results: SearchSample["fanout"]["results"];
  successfulProviders: string[];
  errors: SearchSample["fanout"]["errors"];
}

interface ReadAnswer {
  url: string;
  title: string;
  content: string;
  truncated: boolean;
  requestedProvider: string;
  provider: string;
  attempts: readonly string[];
  failures: SearchSample["read"]["failures"];
}

/** One clock for every landing panel; each recorded sample is swapped for the worker's answer once. */
export function useLandingSearch() {
  const samples = ref<SearchSample[]>([...LANDING_SAMPLES]);
  const tick = ref(0);
  const paused = ref(false);
  const index = computed(() => tick.value % samples.value.length);
  const current = computed(() => samples.value[index.value]!);

  const refreshed = new Set<string>();
  let timer: number | undefined;

  async function refresh(sample: SearchSample) {
    if (refreshed.has(sample.query)) {
      return;
    }
    refreshed.add(sample.query);
    const position = () => samples.value.findIndex((row) => row.query === sample.query);
    const settled = await Promise.allSettled([
      $fetch<SearchAnswer>("/api/search", { query: { q: sample.query, provider: sample.provider, maxResults: 5 }, retry: 0 }),
      $fetch<FanoutAnswer>("/api/all", { query: { q: sample.query, maxResults: 6 }, retry: 0 }),
      $fetch<ReadAnswer>("/api/read", { query: { url: sample.read.url, maxChars: 900 }, retry: 0 }),
    ]);
    const [search, fanout, read] = settled;
    const at = position();
    if (at === -1) {
      return;
    }
    /* A panel whose answer failed keeps its recorded sample; the others go live. */
    if (search.status === "rejected" && fanout.status === "rejected" && read.status === "rejected") {
      return;
    }
    const base = samples.value[at]!;
    samples.value[at] = {
      ...base,
      ...(search.status === "fulfilled"
        ? {
            provider: search.value.provider,
            results: search.value.results,
            pagination: search.value.pagination,
            ignoredFilters: search.value.ignoredFilters,
          }
        : {}),
      ...(fanout.status === "fulfilled"
        ? {
            fanout: {
              results: fanout.value.results,
              successfulProviders: fanout.value.successfulProviders,
              errors: fanout.value.errors,
              total: fanout.value.results.length,
            },
          }
        : {}),
      ...(read.status === "fulfilled" ? { read: read.value } : {}),
      live: true,
    };
  }

  function step(delta: number) {
    tick.value = Math.max(0, tick.value + delta);
    void refresh(current.value);
  }

  function stopWalk() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }

  function startWalk() {
    stopWalk();
    if (!import.meta.client || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    timer = window.setInterval(() => {
      if (!paused.value && !document.hidden) {
        step(1);
      }
    }, 4200);
  }

  onMounted(() => {
    void refresh(current.value);
    startWalk();
  });

  onUnmounted(stopWalk);

  return { samples, tick, index, paused, current, step };
}
