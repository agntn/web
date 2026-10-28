/** Drops the `text/markdown` alternate `useSeo` adds, on a page with no twin to point agents at. */
export function useNoMarkdownTwin(): void {
  const stop = injectHead().hooks?.hook("tags:resolve", (ctx) => {
    ctx.tags = ctx.tags.filter((tag) => !(tag.tag === "link" && tag.props.type === "text/markdown"));
  });
  onScopeDispose(() => stop?.());
}
