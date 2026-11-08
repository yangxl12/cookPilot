export const TASK_TIMEOUT_MS = 60_000;
export const SEARCH_TIMEOUT_MS = 3_500;

export class TaskTimeoutError extends Error {
  constructor() {
    super('本次请求已超过 60 秒，请重试');
    this.name = 'TaskTimeoutError';
  }
}

/** One deadline for search, generation and all content repairs. */
export function startTaskBudget(controller: AbortController, timeoutMs = TASK_TIMEOUT_MS) {
  const timer = setTimeout(() => controller.abort(new TaskTimeoutError()), timeoutMs);
  return () => clearTimeout(timer);
}
