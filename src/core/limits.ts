/** Bounds the tool schemas read, free of imports so registering a tool loads no core. */

/** Maximum number of network operations accepted by one agent-tool batch. */
export const MAX_BATCH_ITEMS = 10;

/** Most results one agent call asks a provider for. */
export const MAX_AGENT_RESULTS = 20;

export const MAX_SEARCH_CONTINUATION_LENGTH = 4_096;

/** Longest read continuation token a caller can hand back. */
export const MAX_READ_CONTINUATION_LENGTH = 1_024;

/** Default portable content limit used by agent surfaces. */
export const DEFAULT_AGENT_READ_MAX_CHARS = 20_000;

/** Largest portable content page accepted by agent surfaces. */
export const MAX_AGENT_READ_CHARS = 200_000;
