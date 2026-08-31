import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import {
  AuthError,
  EmptyUrlError,
  ReadNotSupportedError,
  UnknownProviderError,
} from "../../src/core/errors.ts";

const mockLog = vi.fn<(message: unknown) => void>();
const mockInfo = vi.fn<(message: unknown) => void>();
const mockError = vi.fn<(message: unknown) => void>();
const mockReadUrlDetailed =
  vi.fn<(url: string, options: Readonly<Record<string, unknown>>) => Promise<unknown>>();
const mockReadBatchDetailed =
  vi.fn<
    (
      urls: readonly string[],
      options: Readonly<Record<string, unknown>>,
    ) => Promise<readonly unknown[]>
  >();

vi.mock("consola", () => ({
  consola: {
    log: (message: unknown) => mockLog(message),
    info: (message: unknown) => mockInfo(message),
    error: (message: unknown) => mockError(message),
  },
}));

vi.mock("../../src/core/read.ts", () => ({
  readProviderNames: ["jina"],
  readUrlDetailed: (url: string, options: Readonly<Record<string, unknown>>) =>
    mockReadUrlDetailed(url, options),
}));

vi.mock("../../src/core/batch.ts", () => ({
  MAX_BATCH_ITEMS: 10,
  readBatchDetailed: (urls: readonly string[], options: Readonly<Record<string, unknown>>) =>
    mockReadBatchDetailed(urls, options),
}));

vi.mock("../../src/core/registry.ts", () => ({
  providers: vi.fn(() => ["jina"]),
}));

vi.mock("../../src/providers/index.ts", () => ({}));

import readCommand from "../../src/commands/read.ts";

type ReadRunInput = Parameters<NonNullable<typeof readCommand.run>>[0];
type ReadRunArgs = {
  readonly _: readonly string[];
  readonly url: string;
  readonly provider?: string;
  readonly format?: string;
  readonly "max-tokens"?: string;
  readonly json: boolean;
  [key: string]: string | number | boolean | readonly string[] | undefined;
};

const defaultArgs: ReadRunArgs = {
  _: [],
  url: "https://example.com",
  provider: undefined,
  json: false,
};

function makeArgs(overrides: Readonly<Partial<ReadRunArgs>> = {}): ReadRunArgs {
  return { ...defaultArgs, ...overrides };
}

function runRead(overrides: Readonly<Partial<ReadRunArgs>> = {}) {
  const context = {
    args: makeArgs(overrides),
    rawArgs: [],
    cmd: readCommand,
  } satisfies ReadRunInput;
  if (!readCommand.run) throw new Error("readCommand.run is not defined");
  return Promise.resolve(readCommand.run(context) as unknown);
}

describe("read command", () => {
  let exitSpy: MockInstance<typeof process.exit>;
  let writeSpy: MockInstance<typeof process.stdout.write>;
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    mockLog.mockReset();
    mockInfo.mockReset();
    mockError.mockReset();
    mockReadUrlDetailed.mockReset();
    mockReadBatchDetailed.mockReset();
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    mockReadUrlDetailed.mockResolvedValue({
      result: {
        url: "https://example.com",
        title: "Example",
        description: "Example description",
        content: "Example content",
      },
      requestedProvider: "auto",
      provider: "jina",
      attempts: ["jina"],
    });
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: string | number | null) => {
      throw new Error("__EXIT__");
    });
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    exitSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("leaves an omitted provider in automatic mode", async () => {
    await runRead({ provider: undefined });

    expect(mockReadUrlDetailed).toHaveBeenCalledWith("https://example.com", {
      format: undefined,
      maxTokens: undefined,
    });
  });

  it("passes format and max tokens", async () => {
    await runRead({ format: "text", "max-tokens": "500" });

    expect(mockReadUrlDetailed).toHaveBeenCalledWith("https://example.com", {
      format: "text",
      maxTokens: 500,
    });
  });

  it("outputs effective provider provenance in JSON", async () => {
    await runRead({ json: true });

    expect(writeSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(String(writeSpy.mock.calls[0][0])) as {
      readonly result: { readonly content: string };
      readonly requestedProvider: string;
      readonly provider: string;
      readonly attempts: readonly string[];
    };
    expect(parsed).toMatchObject({
      result: { content: "Example content" },
      requestedProvider: "auto",
      provider: "jina",
      attempts: ["jina"],
    });
  });

  it("shows requested and effective providers in human output", async () => {
    await runRead();

    expect(mockLog).toHaveBeenNthCalledWith(
      1,
      "[provider=jina requested=auto] read https://example.com",
    );
  });

  it("keeps provider provenance on one terminal safe header line", async () => {
    mockReadUrlDetailed.mockResolvedValueOnce({
      result: { url: "https://example.com/\nforged", content: "page" },
      requestedProvider: "custom\nprovider",
      provider: "reader\x1B[31mname",
      attempts: ["reader"],
    });

    await runRead({ provider: "custom\nprovider" });

    expect(mockLog).toHaveBeenNthCalledWith(
      1,
      "[provider=readername requested=custom provider] read https://example.com/ forged",
    );
  });

  it("keeps ordered batch JSON and exits non-zero after a partial failure", async () => {
    const urls = ["https://example.com/one", "https://example.com/two"];
    const outcomes = [
      {
        url: urls[0],
        result: { url: urls[0], content: "First page" },
        requestedProvider: "auto",
        provider: "context",
        attempts: ["jina", "context"],
      },
      { url: urls[1], error: "second read failed" },
    ];
    mockReadBatchDetailed.mockResolvedValueOnce(outcomes);

    await runCommand(readCommand, { rawArgs: [...urls, "--json"] });

    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
    expect(mockReadBatchDetailed).toHaveBeenCalledWith(urls, {
      format: undefined,
      maxTokens: undefined,
    });
    expect(writeSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(writeSpy.mock.calls[0][0]))).toEqual(outcomes);
    expect(process.exitCode).toBe(1);
  });

  it("keeps a successful batch at exit zero", async () => {
    const urls = ["https://example.com/one", "https://example.com/two"];
    mockReadBatchDetailed.mockResolvedValueOnce(
      urls.map((url) => ({
        url,
        result: { url, content: "Page" },
        requestedProvider: "auto",
        provider: "jina",
        attempts: ["jina"],
      })),
    );

    await runCommand(readCommand, { rawArgs: urls });

    expect(mockReadBatchDetailed).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
  });

  it("rejects more than ten URLs before reading any of them", async () => {
    const urls = Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`);

    await expect(runCommand(readCommand, { rawArgs: urls })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith("Cannot read more than 10 URLs at once.");
    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
    expect(mockReadBatchDetailed).not.toHaveBeenCalled();
  });

  it("strips terminal control sequences from human output", async () => {
    mockReadUrlDetailed.mockResolvedValueOnce({
      result: {
        url: "https://example.com",
        title: "Example \x1B[31mTitle\x1B[0m",
        description: "Description \x1B]0;bad\x07ok",
        content: "Zażółć \x1B[31mred\x1B[0m \x01world",
      },
      requestedProvider: "auto",
      provider: "jina",
      attempts: ["jina"],
    });

    await runRead();

    const contentLine = String(mockLog.mock.calls.at(-1)?.[0]);
    expect(contentLine).not.toContain("\x1B");
    expect(contentLine).not.toContain("\x01");
    expect(contentLine).toBe("Zażółć red world");
  });

  it("exits with a helpful message for empty URL", async () => {
    await expect(runRead({ url: "   " })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith("Read URL cannot be empty.");
    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with a helpful message for invalid format", async () => {
    await expect(runRead({ format: "pdf" })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith(
      "Invalid --format value. Expected markdown, text, or html.",
    );
    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
  });

  it("exits with a helpful message for invalid max tokens", async () => {
    await expect(runRead({ "max-tokens": "0" })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith(
      "Invalid --max-tokens value. Expected a positive integer.",
    );
    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
  });

  it("handles EmptyUrlError from core", async () => {
    mockReadUrlDetailed.mockRejectedValueOnce(new EmptyUrlError());

    await expect(runRead()).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith("Read URL cannot be empty.");
  });

  it("attributes automatic reader authentication errors to the effective provider", async () => {
    mockReadUrlDetailed.mockRejectedValueOnce(new AuthError("unauthorized", "jina"));

    await expect(runRead()).rejects.toThrow("__EXIT__");

    expect(mockInfo).toHaveBeenCalledWith("Set the JINA_API_KEY environment variable.");
    expect(mockError).toHaveBeenCalledWith('Authentication failed for provider "jina".');
  });

  it("handles ReadNotSupportedError from core", async () => {
    mockReadUrlDetailed.mockRejectedValueOnce(new ReadNotSupportedError("brave"));

    await expect(runRead({ provider: "brave" })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith("Provider does not support read: brave");
  });

  it("shows read-capable providers for unknown read providers", async () => {
    mockReadUrlDetailed.mockRejectedValueOnce(new UnknownProviderError("missing"));

    await expect(runRead({ provider: "missing" })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith("Unknown provider: missing");
    expect(mockInfo).toHaveBeenCalledWith("Read-capable providers: jina");
  });
});
