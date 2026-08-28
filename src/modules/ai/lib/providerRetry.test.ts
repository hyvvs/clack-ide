import { describe, expect, it, vi } from "vitest";
import {
  AGENT_PROVIDER_MAX_RETRIES,
  createProviderRetryTracker,
  isRetryableProviderAttempt,
} from "./providerRetry";

function providerError(statusCode: number) {
  return {
    name: "AI_APICallError",
    message: `Request failed with status ${statusCode}`,
    statusCode,
    isRetryable: statusCode === 429 || statusCode >= 500,
  };
}

describe("provider retry lifecycle", () => {
  it("treats rate limits and provider 5xx responses as retryable attempts", () => {
    expect(isRetryableProviderAttempt(providerError(429))).toBe(true);
    expect(isRetryableProviderAttempt(providerError(503))).toBe(true);
    expect(isRetryableProviderAttempt(providerError(400))).toBe(false);
    expect(
      isRetryableProviderAttempt({
        name: "AI_InvalidToolInputError",
        toolName: "edit",
        message: "Invalid input for tool edit: Type validation failed",
      }),
    ).toBe(false);
  });

  it("reports retry-pending attempts and clears the state after recovery", () => {
    const onRetry = vi.fn();
    const onRecovered = vi.fn();
    const tracker = createProviderRetryTracker({ onRetry, onRecovered });
    const error = providerError(429);

    expect(tracker.failed(error)).toBe(true);
    expect(onRetry).toHaveBeenCalledWith({
      error,
      retryNumber: 1,
      maxRetries: AGENT_PROVIDER_MAX_RETRIES,
    });

    tracker.succeeded();

    expect(onRecovered).toHaveBeenCalledOnce();
  });

  it("does not announce another retry after the configured attempts exhaust", () => {
    const onRetry = vi.fn();
    const tracker = createProviderRetryTracker({
      onRetry,
      onRecovered: vi.fn(),
    });
    const error = providerError(503);

    expect(tracker.failed(error)).toBe(true);
    expect(tracker.failed(error)).toBe(true);
    expect(tracker.failed(error)).toBe(false);
    expect(onRetry).toHaveBeenCalledTimes(AGENT_PROVIDER_MAX_RETRIES);
  });
});
