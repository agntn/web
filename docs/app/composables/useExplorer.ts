import {
  DEFAULT_FIELDS,
  OPERATIONS,
  READ_BOUNDS,
  explorerQuery,
  type ExplorerFields,
  type FanoutAnswer,
  type Operation,
  type ProvidersAnswer,
  type ReadAnswer,
  type SearchAnswer,
} from "../utils/explorer";
import { withScheme } from "../utils/format";

interface Answers {
  search?: SearchAnswer;
  fanout?: FanoutAnswer;
  read?: ReadAnswer;
  providers?: ProvidersAnswer;
}

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const data = error as {
      statusCode?: number;
      statusMessage?: string;
      data?: { statusMessage?: string };
      message?: string;
    };
    const message = data.data?.statusMessage ?? data.statusMessage ?? data.message;
    if (message) {
      return data.statusCode ? `${data.statusCode}: ${message}` : message;
    }
  }
  return String(error);
}

/**
 * The explorer's state: the form, the answer of the last run for each operation and the flags.
 * Every run writes its state into the query, so every answer is a link.
 *
 * @returns {object} The form fields, the answers, the flags and `run`.
 */
export function useExplorer() {
  const router = useRouter();
  const route = useRoute();

  const fields = reactive<ExplorerFields>({ ...DEFAULT_FIELDS });
  /** The fields of the run whose answer is on screen, so editing the form never relabels it. */
  const asked = ref<ExplorerFields>({ ...DEFAULT_FIELDS });
  const answers = reactive<Answers>({});
  const loading = ref(false);
  const error = ref("");
  /** Only the newest run writes: a slow answer to the previous query never lands under the next one. */
  let sequence = 0;

  /** Asks the worker; the caller decides whether the answer is still the newest one. */
  async function fetchAnswer(run: Readonly<ExplorerFields>): Promise<Answers> {
    switch (run.operation) {
      case "search":
        return {
          search: await $fetch<SearchAnswer>("/api/search", {
            query: { q: run.query.trim(), provider: run.provider, maxResults: 10 },
            retry: 0,
          }),
        };
      case "fanout":
        return {
          fanout: await $fetch<FanoutAnswer>("/api/all", {
            query: { q: run.query.trim(), maxResults: 10 },
            retry: 0,
          }),
        };
      case "read":
        return {
          read: await $fetch<ReadAnswer>("/api/read", {
            query: { url: run.url, provider: run.reader, maxChars: run.maxChars },
            retry: 0,
          }),
        };
      default:
        return { providers: answers.providers ?? (await $fetch<ProvidersAnswer>("/api/providers", { retry: 0 })) };
    }
  }

  async function run(operation: Operation = fields.operation) {
    const ticket = ++sequence;
    fields.operation = operation;
    if (operation === "read") fields.url = withScheme(fields.url);
    const current = { ...fields };
    asked.value = current;
    error.value = "";
    /** The previous answer to this operation belongs to another run; the provider matrix does not change. */
    if (operation !== "providers") answers[operation] = undefined;
    await router.replace({ query: explorerQuery(current) });
    /** The stripped prerender address is not rewritten by a replace to an identical route. */
    if (import.meta.client && window.location.pathname + window.location.search !== route.fullPath) {
      window.history.replaceState(window.history.state, "", route.fullPath);
    }
    loading.value = true;
    try {
      const answer = await fetchAnswer(current);
      if (ticket === sequence) Object.assign(answers, answer);
    } catch (failure) {
      if (ticket === sequence) error.value = errorText(failure);
    } finally {
      if (ticket === sequence) loading.value = false;
    }
  }

  /**
   * A prerendered page hydrates with an empty `route.query` and the router restores it only after
   * mount, so the deep link is read from the address bar itself, which always has it.
   */
  onMounted(() => {
    const query = new URLSearchParams(window.location.search);
    const operation = OPERATIONS.find((entry) => entry.key === query.get("op"))?.key ?? "search";
    const q = query.get("q");
    const url = query.get("url");
    const provider = query.get("provider");
    const maxChars = Number(query.get("maxChars"));
    if (q) fields.query = q;
    if (url) fields.url = url;
    if (provider) {
      if (operation === "read") fields.reader = provider;
      else fields.provider = provider;
    }
    if ((READ_BOUNDS as readonly number[]).includes(maxChars)) fields.maxChars = maxChars;
    void run(operation);
  });

  return { fields, asked, answers, loading, error, run };
}
