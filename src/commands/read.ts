import { defineCommand } from "citty";
import { consola } from "consola";
import { sanitizeTerminalContent, sanitizeTerminalText } from "../tui.ts";
import { providerApiKeyEnvVar } from "../core/providers.ts";
import {
  AuthError,
  EmptyUrlError,
  InvalidReadContinuationError,
  ReadNotSupportedError,
  StaleReadContinuationError,
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
      description: "Read provider to use; omit or pass auto for fallback",
    },
    format: {
      type: "string",
      description: "Response format: markdown, text, or html",
    },
    "max-tokens": {
      type: "string",
      description: "Maximum tokens to return when the provider supports it",
    },
    "max-chars": {
      type: "string",
      description: "Maximum page content characters to return",
    },
    continuation: {
      type: "string",
      description: "Opaque token returned by a truncated read",
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
        const response = await read.readUrlDetailed(parsed.urls[0], parsed.options);
        writeReadDetailedResult(response, args.json);
        return;
      }

      const outcomes = await batch.readBatchDetailed(parsed.urls, parsed.options);
      writeReadBatch(outcomes, args.json);
      if (outcomes.some((outcome) => "error" in outcome)) process.exitCode = 1;
    } catch (error) {
      handleReadError(error, read.readProviderNames);
    }
  },
});

type ReadCommandArgs = {
  readonly _: readonly string[];
  readonly url: string;
  readonly provider?: string;
  readonly format?: string;
  readonly "max-tokens"?: string;
  readonly "max-chars"?: string;
  readonly continuation?: string;
  readonly json: boolean;
};

type ParsedReadArguments = {
  readonly urls: readonly string[];
  readonly options: {
    readonly provider?: string;
    readonly format?: "markdown" | "text" | "html";
    readonly maxTokens?: number;
    readonly maxChars?: number;
    readonly continuation?: string;
  };
};

function parseReadArguments(args: ReadCommandArgs, maxBatchItems: number): ParsedReadArguments {
  const urls = args._.length > 0 ? args._ : [args.url];
  if (urls.some((url) => !url.trim())) return exitWithError("Read URL cannot be empty.");
  if (urls.length > maxBatchItems) {
    return exitWithError(`Cannot read more than ${maxBatchItems} URLs at once.`);
  }
  if (urls.length > 1 && args.continuation !== undefined) {
    return exitWithError("--continuation is only supported for a single URL.");
  }
  const format = parseFormat(args.format);
  if (!format.ok) return exitWithError(format.message);
  const maxTokens = parseOptionalPositiveInt(args["max-tokens"], "--max-tokens");
  if (!maxTokens.ok) return exitWithError(maxTokens.message);
  const maxChars = parseOptionalPositiveInt(args["max-chars"], "--max-chars");
  if (!maxChars.ok) return exitWithError(maxChars.message);
  return {
    urls,
    options: {
      ...parseProviderOption(args.provider),
      format: format.value,
      maxTokens: maxTokens.value,
      maxChars: maxChars.value,
      continuation: args.continuation,
    },
  };
}

function parseProviderOption(input: string | undefined): { readonly provider?: string } {
  const provider = input?.trim();
  return !provider || provider === "auto" ? {} : { provider };
}

type ReadDetailedResultView = {
  readonly result: Readonly<
    Pick<
      import("../core/types.ts").ReadResult,
      "url" | "title" | "description" | "content" | "truncated" | "continuation"
    >
  >;
  readonly requestedProvider: string;
  readonly provider: string;
  readonly attempts: readonly string[];
};

function writeReadDetailedResult(response: ReadDetailedResultView, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }
  consola.log(
    `[provider=${sanitizeHeaderText(response.provider)} requested=${sanitizeHeaderText(response.requestedProvider)}] read ${sanitizeHeaderText(response.result.url)}`,
  );
  writeReadResult(response.result, false);
}

function writeReadResult(
  result: Readonly<
    Pick<
      import("../core/types.ts").ReadResult,
      "url" | "title" | "description" | "content" | "truncated" | "continuation"
    >
  >,
  json: boolean,
): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.title)
    consola.log(`\x1B[1m\x1B[36m${sanitizeTerminalText(result.title, 2048)}\x1B[0m`);
  consola.log(`  ${sanitizeTerminalText(result.url, 2048)}`);
  if (result.description) {
    consola.log(`  \x1B[90m${sanitizeTerminalText(result.description, 160)}\x1B[0m`);
  }
  consola.log("");
  consola.log(sanitizeTerminalContent(result.content));
  if (result.truncated && result.continuation) {
    consola.log("");
    consola.log(`[truncated; continuation=${sanitizeHeaderText(result.continuation)}]`);
  }
}

type ReadBatchItemView =
  | { readonly url: string; readonly error: string }
  | {
      readonly url: string;
      readonly requestedProvider: string;
      readonly provider: string;
      readonly attempts: readonly string[];
      readonly result: Readonly<
        Pick<
          import("../core/types.ts").ReadResult,
          "url" | "title" | "description" | "content" | "truncated" | "continuation"
        >
      >;
    };

function writeReadBatch(outcomes: readonly ReadBatchItemView[], json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
    return;
  }

  for (const [index, outcome] of outcomes.entries()) {
    if ("error" in outcome) {
      consola.log(`[${index + 1}] ${sanitizeHeaderText(outcome.url)}`);
      consola.error(`  ${sanitizeTerminalText(outcome.error)}`);
    } else {
      consola.log(
        `[${index + 1}] [provider=${sanitizeHeaderText(outcome.provider)} requested=${sanitizeHeaderText(outcome.requestedProvider)}] ${sanitizeHeaderText(outcome.url)}`,
      );
      writeReadResult(outcome.result, false);
    }
    if (index < outcomes.length - 1) consola.log("");
  }
}

function handleReadError(error: unknown, readProviderNames: readonly string[]): never {
  if (error instanceof EmptyUrlError) return exitWithError("Read URL cannot be empty.");
  if (error instanceof AuthError) {
    const envVar = providerApiKeyEnvVar(error.provider);
    if (envVar !== null) consola.info(`Set the ${envVar} environment variable.`);
    return exitWithError(`Authentication failed for provider "${error.provider}".`);
  }
  if (error instanceof UnknownProviderError) {
    consola.info(`Read-capable providers: ${readProviderNames.join(", ")}`);
    return exitWithError(`Unknown provider: ${error.provider}`);
  }
  if (
    error instanceof ReadNotSupportedError ||
    error instanceof InvalidReadContinuationError ||
    error instanceof StaleReadContinuationError
  ) {
    return exitWithError(error.message);
  }
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
  if (!Number.isSafeInteger(value) || value < 1) {
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

function sanitizeHeaderText(text: string): string {
  return sanitizeTerminalText(text, 160);
}
