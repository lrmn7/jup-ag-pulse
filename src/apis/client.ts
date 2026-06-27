import { requireJupiterApiKey } from "../config.js";

export type JupiterApiName = "Price" | "Tokens" | "Swap" | "Trigger" | "Portfolio";

export interface JupiterRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  jwt?: string;
  timeoutMs?: number;
  retry?: boolean;
}

export class JupiterApiError extends Error {
  readonly api: JupiterApiName;
  readonly status: number | undefined;
  readonly code: string | number | undefined;
  readonly retryable: boolean;

  constructor(
    message: string,
    details: {
      api: JupiterApiName;
      status?: number;
      code?: string | number;
      retryable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: details.cause });
    this.name = "JupiterApiError";
    this.api = details.api;
    this.status = details.status;
    this.code = details.code;
    this.retryable = details.retryable ?? false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDetails(value: unknown): { message?: string; code?: string | number } {
  if (!isRecord(value)) return {};
  const message = typeof value.message === "string"
    ? value.message
    : typeof value.error === "string"
      ? value.error
      : undefined;
  const code = typeof value.code === "string" || typeof value.code === "number"
    ? value.code
    : undefined;
  return {
    ...(message === undefined ? {} : { message }),
    ...(code === undefined ? {} : { code }),
  };
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = (await response.text()).slice(0, 500);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function wait(attempt: number): Promise<void> {
  const delayMs = 100 * 2 ** attempt + Math.floor(Math.random() * 50);
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export async function jupiterRequest<T>(
  api: JupiterApiName,
  url: string,
  options: JupiterRequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const canRetry = method === "GET" && options.retry !== false;
  const maxAttempts = canRetry ? 3 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "x-api-key": requireJupiterApiKey(),
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.jwt ? { Authorization: `Bearer ${options.jwt}` } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
      });

      if (response.ok) {
        return await response.json() as T;
      }

      const body = await responseBody(response);
      const details = errorDetails(body);
      const retryable = canRetry && retryableStatus(response.status);
      const error = new JupiterApiError(
        `${api} API request failed (${response.status})${details.message ? `: ${details.message}` : ""}`,
        {
          api,
          status: response.status,
          retryable,
          ...(details.code === undefined ? {} : { code: details.code }),
        },
      );

      if (!retryable || attempt === maxAttempts - 1) throw error;
    } catch (error) {
      if (error instanceof JupiterApiError) {
        if (!error.retryable || attempt === maxAttempts - 1) throw error;
      } else {
        const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
        if (!canRetry || attempt === maxAttempts - 1) {
          throw new JupiterApiError(
            timedOut ? `${api} API request timed out.` : `${api} API network request failed.`,
            { api, retryable: canRetry, cause: error },
          );
        }
      }
    }

    await wait(attempt);
  }

  throw new JupiterApiError(`${api} API request failed after retries.`, { api });
}
