import type { ExecutionOptions } from "./types.ts";

export const DEFAULT_CONCURRENCY = 3;
export const MAX_CONCURRENCY = 10;

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const executionBudget = Symbol("executionBudget");

type BudgetedExecutionOptions = ExecutionOptions & {
  readonly [executionBudget]: ExecutionBudget;
};

type DeadlineController = {
  readonly signal: Readonly<AbortSignal>;
  abort(reason?: unknown): void;
};

/**
 * Creates one signal and concurrency budget for an operation and all nested work.
 * @param options - Public execution controls or an existing internal budget.
 * @returns {TOptions & BudgetedExecutionOptions} Options carrying the shared internal budget.
 */
export function withExecutionBudget<TOptions extends ExecutionOptions>(
  options?: Readonly<TOptions>,
): TOptions & BudgetedExecutionOptions {
  const existing = (options as Readonly<BudgetedExecutionOptions> | undefined)?.[executionBudget];
  if (existing) {
    return {
      ...options,
      signal: existing.signal,
      deadline: undefined,
      [executionBudget]: existing,
    } as TOptions & BudgetedExecutionOptions;
  }

  const signal = operationSignal(options);
  const budget = new ExecutionBudget(normalizedConcurrency(options?.concurrency), signal);
  return { ...options, signal, deadline: undefined, [executionBudget]: budget } as TOptions &
    BudgetedExecutionOptions;
}

/**
 * Creates a signal that observes the caller and one absolute operation deadline.
 * @param options - Caller cancellation, deadline, and concurrency controls.
 * @returns {Readonly<AbortSignal> | undefined} Caller or composed deadline signal.
 */
export function operationSignal(
  options?: Readonly<ExecutionOptions>,
): Readonly<AbortSignal> | undefined {
  const existing = (options as Readonly<BudgetedExecutionOptions> | undefined)?.[executionBudget];
  if (existing) return existing.signal;
  normalizedConcurrency(options?.concurrency);

  const timeoutSignal = deadlineSignal(options?.deadline);
  if (!timeoutSignal) return options?.signal;
  return options?.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
}

/**
 * Removes scheduler-only state before options cross a provider boundary.
 * @param options - Internal operation options.
 * @returns {TOptions} Provider-visible options with only the effective signal retained.
 */
export function providerRequestOptions<TOptions extends ExecutionOptions>(
  options: Readonly<TOptions>,
): TOptions {
  const {
    [executionBudget]: _budget,
    deadline: _deadline,
    concurrency: _concurrency,
    signal,
    ...requestOptions
  } = options as Readonly<TOptions & Partial<BudgetedExecutionOptions>>;
  return {
    ...requestOptions,
    ...(signal === undefined ? {} : { signal }),
  } as TOptions;
}

/**
 * Throws before another unit of network work starts after cancellation or timeout.
 * @param signal - Effective operation signal.
 */
export function throwIfAborted(signal?: Readonly<AbortSignal>): void {
  signal?.throwIfAborted();
}

/**
 * Runs ordered work through the operation's shared concurrency budget.
 * @param items - Ordered work inputs.
 * @param worker - Function that performs one bounded unit of work.
 * @param options - Execution controls or an existing internal budget.
 * @returns {Promise<PromiseSettledResult<TResult>[]>} Settled outcomes in input order.
 */
export async function settleWithConcurrency<T, TResult>(
  items: readonly T[],
  worker: (item: T, index: number, signal?: Readonly<AbortSignal>) => Promise<TResult>,
  options?: Readonly<ExecutionOptions>,
): Promise<PromiseSettledResult<TResult>[]> {
  const budgeted = withExecutionBudget(options);
  return Promise.allSettled(
    items.map((item, index) =>
      budgeted[executionBudget].run(() => worker(item, index, budgeted.signal)),
    ),
  );
}

class ExecutionBudget {
  readonly signal: Readonly<AbortSignal> | undefined;
  readonly #concurrency: number;
  readonly #queue: Array<{
    run: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];
  #active = 0;
  #listeningForAbort = false;

  constructor(concurrency: number, signal?: Readonly<AbortSignal>) {
    this.#concurrency = concurrency;
    this.signal = signal;
  }

  run<TResult>(task: () => Promise<TResult>): Promise<TResult> {
    try {
      throwIfAborted(this.signal);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise<TResult>((resolve, reject) => {
      this.#queue.push({
        run: task,
        resolve: (value) => resolve(value as TResult),
        reject,
      });
      this.#listenForAbort();
      this.#drain();
    });
  }

  #drain(): void {
    if (this.signal?.aborted) {
      this.#rejectQueued(this.signal.reason);
      return;
    }

    while (this.#active < this.#concurrency) {
      const queued = this.#queue.shift();
      if (!queued) break;
      this.#active += 1;
      void Promise.resolve()
        .then(() => {
          throwIfAborted(this.signal);
          return queued.run();
        })
        .then(queued.resolve, queued.reject)
        .finally(() => {
          this.#active -= 1;
          this.#drain();
        });
    }
    if (this.#queue.length === 0) this.#stopListeningForAbort();
  }

  #listenForAbort(): void {
    if (!this.signal || this.#listeningForAbort) return;
    this.signal.addEventListener("abort", this.#onAbort, { once: true });
    this.#listeningForAbort = true;
  }

  #stopListeningForAbort(): void {
    if (!this.signal || !this.#listeningForAbort) return;
    this.signal.removeEventListener("abort", this.#onAbort);
    this.#listeningForAbort = false;
  }

  readonly #onAbort = (): void => {
    this.#listeningForAbort = false;
    this.#rejectQueued(this.signal?.reason);
  };

  #rejectQueued(reason: unknown): void {
    let queued = this.#queue.shift();
    while (queued) {
      queued.reject(reason ?? new DOMException("The operation was aborted", "AbortError"));
      queued = this.#queue.shift();
    }
    this.#stopListeningForAbort();
  }
}

function deadlineSignal(deadline?: number): AbortSignal | undefined {
  if (deadline === undefined) return undefined;
  if (!Number.isFinite(deadline)) throw new RangeError("deadline must be a finite Unix timestamp");

  const controller = new AbortController();
  scheduleDeadline(controller, deadline);
  return controller.signal;
}

function scheduleDeadline(controller: Readonly<DeadlineController>, deadline: number): void {
  const remaining = Math.ceil(deadline - Date.now());
  if (remaining <= 0) {
    controller.abort(new DOMException("The operation deadline was exceeded", "TimeoutError"));
    return;
  }
  const timer = setTimeout(
    () => scheduleDeadline(controller, deadline),
    Math.min(remaining, MAX_TIMER_DELAY_MS),
  );
  timer.unref();
}

function normalizedConcurrency(concurrency = DEFAULT_CONCURRENCY): number {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new RangeError(`concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
  }
  return concurrency;
}
