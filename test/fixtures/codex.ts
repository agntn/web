export function completedEvents() {
  return [
    { type: "response.created", response: { id: "resp-test", model: "gpt-5.5" } },
    {
      type: "response.output_item.done",
      item: {
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          sources: [
            { url: "https://example.com/", title: "Example" },
            { url: "https://other.example/page", title: "Other source" },
          ],
        },
      },
    },
    {
      type: "response.output_item.done",
      item: {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "Generated answer with a citation. https://invented.example/",
            annotations: [{ type: "url_citation", url: "https://example.com/", title: "Example" }],
          },
        ],
      },
    },
    {
      type: "response.completed",
      response: {
        id: "resp-test",
        model: "gpt-5.5",
        status: "completed",
        usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
      },
    },
  ];
}

export function sse(events: readonly unknown[], separator = "\n"): Response {
  const text = events
    .map((event) => `data: ${JSON.stringify(event)}${separator}${separator}`)
    .join("");
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, offset + 17));
        offset = Math.min(bytes.length, offset + 17);
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
