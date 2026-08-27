import { defineCommand } from "citty";
import { consola } from "consola";
import {
  AuthError,
  EmptyUrlError,
  ReadNotSupportedError,
  UnknownProviderError,
} from "../core/errors.ts";

export default defineCommand({
  meta: {
    name: "read",
    description: "Read one or more URLs using a provider",
  },
  args: {
    url: {
      type: "positional",
      description: "URL to read; pass more URLs for a batch",
      required: true,
    },
    provider: {
      type: "string",
      description: "Read provider to use",
      default: "jina",
    },
    format: {
      type: "string",
      description: "Response format: markdown, text, or html",
    },
    "max-tokens": {
      type: "string",
      description: "Maximum tokens to return",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  async run({ args }) {
    const read = await import("../core/read.ts");
    const batch = await import("../core/batch.ts");
    const parsed = parseReadArguments(args, batch.MAX_BATCH_ITEMS);
    try {
      await import("../providers/index.ts");
      if (parsed.urls.length === 1) {
        const result = await read.readUrl(parsed.urls[0], parsed.options);
        writeReadResult(result, args.json);
        return;
      }

      const outcomes = await batch.readBatch(parsed.urls, parsed.options);
      writeReadBatch(outcomes, args.json);
      if (outcomes.some((outcome) => "error" in outcome)) process.exitCode = 1;
    } catch (error) {
      handleReadError(error, parsed.options.provider ?? "jina", read.readProviderNames);
    }
  },
});

type ReadCommandArgs = {
  readonly _: readonly string[];
  readonly url: string;
  readonly provider?: string;
  readonly format?: string;
  readonly "max-tokens"?: string;
  readonly json: boolean;
};

type ParsedReadArguments = {
  readonly urls: readonly string[];
  readonly options: {
    readonly provider: string;
    readonly format?: "markdown" | "text" | "html";
    readonly maxTokens?: number;
  };
};

function parseReadArguments(args: ReadCommandArgs, maxBatchItems: number): ParsedReadArguments {
  const urls = args._.length > 0 ? args._ : [args.url];
  if (urls.some((url) => !url.trim())) return exitWithError("Read URL cannot be empty.");
  if (urls.length > maxBatchItems) {
    return exitWithError(`Cannot read more than ${maxBatchItems} URLs at once.`);
  }
  const format = parseFormat(args.format);
  if (!format.ok) return exitWithError(format.message);
  const maxTokens = parseOptionalPositiveInt(args["max-tokens"], "--max-tokens");
  if (!maxTokens.ok) return exitWithError(maxTokens.message);
  return {
    urls,
    options: {
      provider: args.provider || "jina",
      format: format.value,
      maxTokens: maxTokens.value,
    },
  };
}

function writeReadResult(
  result: Readonly<
    Pick<import("../core/types.ts").ReadResult, "url" | "title" | "description" | "content">
  >,
  json: boolean,
): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.title) consola.log(`\x1B[1m\x1B[36m${sanitizeTerminalText(result.title)}\x1B[0m`);
  consola.log(`  ${sanitizeTerminalText(result.url)}`);
  if (result.description) {
    consola.log(
      `  \x1B[90m${truncateSingleLine(sanitizeTerminalText(result.description), 160)}\x1B[0m`,
    );
  }
  consola.log("");
  consola.log(sanitizeTerminalText(result.content));
}

type ReadBatchItemView =
  | { readonly url: string; readonly error: string }
  | {
      readonly url: string;
      readonly result: Readonly<
        Pick<import("../core/types.ts").ReadResult, "url" | "title" | "description" | "content">
      >;
    };

function writeReadBatch(outcomes: readonly ReadBatchItemView[], json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
    return;
  }

  for (const [index, outcome] of outcomes.entries()) {
    consola.log(`[${index + 1}] ${sanitizeTerminalText(outcome.url)}`);
    if ("error" in outcome) {
      consola.error(`  ${sanitizeTerminalText(outcome.error)}`);
    } else {
      writeReadResult(outcome.result, false);
    }
    if (index < outcomes.length - 1) consola.log("");
  }
}

function handleReadError(
  error: unknown,
  provider: string,
  readProviderNames: readonly string[],
): never {
  if (error instanceof EmptyUrlError) return exitWithError("Read URL cannot be empty.");
  if (error instanceof AuthError) {
    consola.info(`Set the ${provider.toUpperCase()}_API_KEY environment variable.`);
    return exitWithError(`Authentication failed for provider "${provider}".`);
  }
  if (error instanceof UnknownProviderError) {
    consola.info(`Read-capable providers: ${readProviderNames.join(", ")}`);
    return exitWithError(`Unknown provider: ${provider}`);
  }
  if (error instanceof ReadNotSupportedError) return exitWithError(error.message);
  throw error;
}

function exitWithError(message: string): never {
  consola.error(message);
  process.exit(1);
}

type ParsedOptionalNumber =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

type ParsedFormat =
  | { ok: true; value: "markdown" | "text" | "html" | undefined }
  | { ok: false; message: string };

function parseOptionalPositiveInt(
  input: string | undefined,
  flagName: string,
): ParsedOptionalNumber {
  if (input === undefined || input === "") {
    return { ok: true, value: undefined };
  }
  if (!/^\d+$/.test(input)) {
    return { ok: false, message: `Invalid ${flagName} value. Expected a positive integer.` };
  }
  const value = Number.parseInt(input, 10);
  if (value < 1) {
    return { ok: false, message: `Invalid ${flagName} value. Expected a positive integer.` };
  }
  return { ok: true, value };
}

function parseFormat(input: string | undefined): ParsedFormat {
  if (input === undefined || input === "") {
    return { ok: true, value: undefined };
  }
  if (input === "markdown" || input === "text" || input === "html") {
    return { ok: true, value: input };
  }
  return { ok: false, message: "Invalid --format value. Expected markdown, text, or html." };
}

function truncateSingleLine(text: string, maxLength: number): string {
  const singleLine = text.replaceAll(/\s+/g, " ").trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}

function sanitizeTerminalText(text: string): string {
  let sanitized = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index) ?? -1;
    if (code === 27) {
      index = escapeSequenceEnd(text, index);
    } else if (isTerminalTextCode(code)) {
      sanitized += text[index];
    }
  }
  return sanitized;
}

function isTerminalTextCode(code: number): boolean {
  return (code > 8 && code < 11) || (code > 12 && code < 14) || (code > 31 && code !== 127);
}

function escapeSequenceEnd(text: string, escapeIndex: number): number {
  const marker = text.codePointAt(escapeIndex + 1) ?? -1;
  if (marker === 93) return operatingSystemCommandEnd(text, escapeIndex + 2);
  if (marker === 91) return controlSequenceEnd(text, escapeIndex + 2);

  let index = escapeIndex + 1;
  while (
    index < text.length &&
    (text.codePointAt(index) ?? -1) >= 32 &&
    (text.codePointAt(index) ?? -1) <= 47
  ) {
    index += 1;
  }
  return index;
}

function operatingSystemCommandEnd(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if ((text.codePointAt(index) ?? -1) === 7) return index;
    if ((text.codePointAt(index) ?? -1) === 27 && (text.codePointAt(index + 1) ?? -1) === 92)
      return index + 1;
  }
  return text.length - 1;
}

function controlSequenceEnd(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    const code = text.codePointAt(index) ?? -1;
    if (code >= 64 && code <= 126) return index;
  }
  return text.length - 1;
}
