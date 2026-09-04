import { readUrlDetailed } from "@agntn/web";

/** One page as `readUrlDetailed` returns it, with the reader that answered and the readers tried before it. */
export interface ReadAnswer {
  url: string;
  title: string;
  description: string;
  content: string;
  /** Code points in `content`. */
  chars: number;
  truncated: boolean;
  requestedProvider: string;
  provider: string;
  attempts: readonly string[];
  failures: WireFailure[];
  fetchedAt: string;
}

/** Read through `readUrlDetailed`; without a provider the library starts with Jina and falls back. */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const url = readUrlParam(query);
  const provider = readProvider(query);
  const maxChars = readInt(query, "maxChars", 200, LIMITS.maxChars) ?? 2000;
  const params = { url, provider: provider ?? "auto", maxChars };
  try {
    return await cachedAnswer<ReadAnswer>(
      event,
      "read",
      params,
      TTL.read,
      async () => {
        const answer = await readUrlDetailed(url, { provider, maxChars, format: "markdown", ...budget() });
        const { result } = answer;
        return {
          url: result.url,
          title: result.title ?? "",
          description: result.description ?? "",
          content: result.content,
          chars: [...result.content].length,
          truncated: Boolean(result.truncated),
          requestedProvider: answer.requestedProvider,
          provider: answer.provider,
          attempts: answer.attempts,
          failures: slimFailures(answer.failures),
          fetchedAt: new Date().toISOString(),
        };
      },
      (answer) => answer.failures.length > 0,
    );
  } catch (error) {
    return toHttpError(error);
  }
});
