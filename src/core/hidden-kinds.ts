/** What a reveal reports, unseen first; import-free so the schemas skip the scanner. */
export const hiddenKinds = [
  "comment",
  "hidden",
  "field",
  "camouflage",
  "invisible",
  "attribute",
  "meta",
  "link",
  "script",
  "style",
] as const;

/** One kind of finding a reveal reports. */
export type HiddenKind = (typeof hiddenKinds)[number];
