import type { ObservedFetchMeta } from "../lib/diagnostics/network";

export interface ImageRequestPayload
  extends Pick<
    ObservedFetchMeta,
    | "operationId"
    | "requestId"
    | "endpointFamily"
    | "providerId"
    | "providerName"
    | "model"
    | "timeoutMs"
    | "attempt"
    | "maxRetries"
    | "retryBackoffMs"
    | "templateName"
    | "taskId"
    | "pollAttempt"
    | "pollStatus"
  > {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ImageRequestResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}
