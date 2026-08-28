import { wrapLanguageModel, type LanguageModel } from "ai";
import { normalizeAiError } from "./errors";

export const AGENT_PROVIDER_MAX_RETRIES = 2;

export type ProviderRetryEvent = {
  error: unknown;
  retryNumber: number;
  maxRetries: number;
};

type ProviderRetryCallbacks = {
  onRetry: (event: ProviderRetryEvent) => void;
  onRecovered: () => void;
};

export function isRetryableProviderAttempt(error: unknown): boolean {
  const normalized = normalizeAiError(error);
  return (
    normalized.retryable &&
    normalized.kind !== "tool" &&
    normalized.kind !== "cancelled" &&
    normalized.kind !== "interrupted"
  );
}

export function createProviderRetryTracker(
  callbacks: ProviderRetryCallbacks,
  maxRetries = AGENT_PROVIDER_MAX_RETRIES,
) {
  let consecutiveFailures = 0;
  let retryPending = false;

  return {
    failed(error: unknown): boolean {
      consecutiveFailures += 1;
      if (
        consecutiveFailures > maxRetries ||
        !isRetryableProviderAttempt(error)
      ) {
        return false;
      }
      retryPending = true;
      callbacks.onRetry({
        error,
        retryNumber: consecutiveFailures,
        maxRetries,
      });
      return true;
    },
    succeeded(): void {
      consecutiveFailures = 0;
      if (!retryPending) return;
      retryPending = false;
      callbacks.onRecovered();
    },
  };
}

export function withProviderRetryTracking(
  model: LanguageModel,
  callbacks: ProviderRetryCallbacks,
  maxRetries = AGENT_PROVIDER_MAX_RETRIES,
): LanguageModel {
  if (typeof model === "string" || model.specificationVersion !== "v3") {
    return model;
  }
  const tracker = createProviderRetryTracker(callbacks, maxRetries);
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      async wrapStream({ doStream }) {
        try {
          const result = await doStream();
          tracker.succeeded();
          return result;
        } catch (error) {
          tracker.failed(error);
          throw error;
        }
      },
    },
  });
}
