import {
  describeAiErrorShape,
  formatAiErrorDetails,
  normalizeAiError,
  normalizeAiStreamPartError,
  sanitizeAiErrorText,
  shouldPresentAiError,
} from "@/modules/ai/lib/errors";
import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";

function apiError(
  statusCode: number,
  responseBody: string,
  responseHeaders: Record<string, string> = {},
) {
  return {
    name: "AI_APICallError",
    message: `Request failed with status ${statusCode}`,
    url: "https://openrouter.ai/api/v1/chat/completions",
    statusCode,
    responseBody,
    responseHeaders,
    isRetryable: statusCode === 429 || statusCode >= 500,
  };
}

const OPENROUTER = {
  provider: "OpenRouter",
  model: "anthropic/claude-sonnet-4",
};

describe("normalizeAiError", () => {
  it("classifies 401 responses as authentication failures", () => {
    const error = normalizeAiError(
      apiError(
        401,
        JSON.stringify({
          error: {
            message: "Invalid API key sk-or-super-secret-value",
            code: "invalid_api_key",
          },
        }),
      ),
      OPENROUTER,
    );

    expect(error.kind).toBe("authentication");
    expect(error.title).toBe("Authentication error");
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe("invalid_api_key");
    expect(error.message).toContain("Check the configured API key");
    expect(formatAiErrorDetails(error)).not.toContain("super-secret-value");
  });

  it("distinguishes authorization and quota failures", () => {
    const forbidden = normalizeAiError(
      apiError(403, '{"error":{"message":"Policy denied this request"}}'),
      OPENROUTER,
    );
    const quota = normalizeAiError(
      apiError(402, '{"error":{"message":"Insufficient credits"}}'),
      OPENROUTER,
    );

    expect(forbidden.kind).toBe("authorization");
    expect(forbidden.title).toBe("Authorization error");
    expect(quota.kind).toBe("quota");
    expect(quota.title).toBe("Provider quota");
  });

  it("preserves rate-limit retry and request metadata", () => {
    const error = normalizeAiError(
      apiError(429, '{"error":{"message":"Slow down"}}', {
        "retry-after": "12",
        "x-request-id": "req_429",
      }),
      OPENROUTER,
    );

    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfter).toBe("12s");
    expect(error.requestId).toBe("req_429");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("Retry in 12s");
  });

  it("classifies a 404 response as a model error", () => {
    const error = normalizeAiError(
      apiError(
        404,
        '{"error":{"message":"Model does not exist","code":"model_not_found"}}',
      ),
      OPENROUTER,
    );

    expect(error.kind).toBe("model_not_found");
    expect(error.title).toBe("Model unavailable");
    expect(error.message).toContain('Model "anthropic/claude-sonnet-4"');
  });

  it("does not treat an unrelated 404 as a missing model", () => {
    const error = normalizeAiError(
      apiError(
        404,
        '{"error":{"message":"Route was not found","code":"not_found"}}',
      ),
      OPENROUTER,
    );

    expect(error.kind).toBe("bad_request");
    expect(error.statusCode).toBe(404);
    expect(error.errorCode).toBe("not_found");
  });

  it.each([
    500, 503,
  ])("classifies HTTP %i as provider unavailable", (status) => {
    const error = normalizeAiError(
      apiError(status, '{"error":{"message":"Upstream unavailable"}}'),
      OPENROUTER,
    );

    expect(error.kind).toBe("provider_unavailable");
    expect(error.statusCode).toBe(status);
    expect(error.title).toBe("Provider error");
  });

  it("classifies network failures without an HTTP response", () => {
    const error = normalizeAiError(
      Object.assign(new Error("fetch failed: DNS lookup ENOTFOUND"), {
        code: "ENOTFOUND",
      }),
      { provider: "OpenAI" },
    );

    expect(error.kind).toBe("network");
    expect(error.message).toContain("Could not reach OpenAI");
  });

  it("classifies timeout failures", () => {
    const error = normalizeAiError(
      new DOMException("The request timed out", "TimeoutError"),
      { provider: "Anthropic" },
    );

    expect(error.kind).toBe("timeout");
    expect(error.retryable).toBe(true);
  });

  it("shows a safe custom endpoint for connection refusal", () => {
    const error = normalizeAiError(
      Object.assign(new Error("Connection refused: ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
      {
        provider: "Local test",
        model: "test-model",
        endpoint:
          "http://admin:password@localhost:1234/v1?api_key=endpoint-secret",
      },
    );

    expect(error.kind).toBe("network");
    expect(error.endpoint).toBe("http://localhost:1234/v1");
    expect(error.message).toContain("http://localhost:1234/v1");
    expect(formatAiErrorDetails(error)).not.toContain("endpoint-secret");
    expect(formatAiErrorDetails(error)).not.toContain("password@");
  });

  it("keeps tool failures distinct from provider failures", () => {
    const error = normalizeAiError(new Error("File could not be read"), {
      kind: "tool",
      toolName: "read_file",
    });

    expect(error.kind).toBe("tool");
    expect(error.title).toBe("Tool failed: read_file");
    expect(error.message).toContain("File could not be read");
    expect(error.provider).toBeUndefined();
    expect(error.disposition).toBe("recoverable");
  });

  it("formats invalid tool input without exposing the rejected payload", () => {
    const hugeValue = `secret-prefix-${"x".repeat(4_000)}`;
    const source = {
      name: "AI_InvalidToolInputError",
      toolName: "edit",
      message: `Invalid input for tool edit: Type validation failed: Value: {"new_string":"${hugeValue}"}`,
      cause: {
        name: "ZodError",
        issues: [
          {
            path: ["new_string"],
            message: "Expected string",
          },
        ],
      },
    };

    const result = normalizeAiStreamPartError(source);

    expect(result.error.disposition).toBe("recoverable");
    expect(result.text).toContain(
      "Tool input did not match the expected schema.",
    );
    expect(result.text).toContain("new_string: Expected string");
    expect(result.text).not.toContain(hugeValue);
    expect(result.text.length).toBeLessThan(800);
  });

  it("only presents the terminal card for a failed logical run", () => {
    const recoverable = normalizeAiError(
      new Error("Invalid input for tool edit: Type validation failed"),
      { kind: "tool", toolName: "edit" },
    );
    const terminal = normalizeAiError(apiError(429, "Rate limited"), {
      ...OPENROUTER,
      disposition: "terminal",
    });

    expect(shouldPresentAiError(recoverable, "running")).toBe(false);
    expect(shouldPresentAiError(recoverable, "failed")).toBe(false);
    expect(shouldPresentAiError(terminal, "running")).toBe(false);
    expect(shouldPresentAiError(terminal, "completed")).toBe(false);
    expect(shouldPresentAiError(terminal, "failed")).toBe(true);
  });

  it("does not present cancellation as a failure card", () => {
    const error = normalizeAiError(
      new DOMException("Request aborted", "AbortError"),
    );

    expect(error.kind).toBe("cancelled");
    expect(shouldPresentAiError(error, "cancelled")).toBe(false);
  });

  it("does not present interrupted recovery as a provider error", () => {
    const error = normalizeAiError(new Error("Previous app session closed"), {
      kind: "interrupted",
    });

    expect(error.kind).toBe("interrupted");
    expect(shouldPresentAiError(error, "interrupted")).toBe(false);
  });

  it("redacts headers, key fields, provider keys, cookies, and tokens", () => {
    const raw = [
      "Authorization: Bearer bearer-secret-value",
      'apiKey="plain-secret-value"',
      '"access_token":"access-secret-value"',
      "Cookie: session=cookie-secret-value; private=second-cookie-secret",
      "key sk-ant-provider-secret",
    ].join("\n");
    const safe = sanitizeAiErrorText(raw);

    expect(safe).not.toContain("bearer-secret-value");
    expect(safe).not.toContain("plain-secret-value");
    expect(safe).not.toContain("access-secret-value");
    expect(safe).not.toContain("cookie-secret-value");
    expect(safe).not.toContain("second-cookie-secret");
    expect(safe).not.toContain("provider-secret");
    expect(safe).toContain("[REDACTED]");
  });

  it("uses a useful safe fallback for unknown errors", () => {
    const error = normalizeAiError(new Error("Unexpected decoder state 7"));

    expect(error.kind).toBe("unknown");
    expect(error.title).toBe("AI run failed");
    expect(error.message).toContain("Unexpected decoder state 7");
  });

  it("distinguishes response parsing failures as internal Clack errors", () => {
    const error = normalizeAiError({
      name: "AI_InvalidStreamPartError",
      message: "Invalid stream part received",
    });

    expect(error.kind).toBe("internal");
    expect(error.title).toBe("Clack error");
  });

  it("unwraps retry errors and retains the final provider response", () => {
    const lastError = apiError(
      503,
      '{"error":{"message":"Provider maintenance","code":"maintenance"}}',
      { "x-request-id": "req_retry" },
    );
    const error = normalizeAiError(
      {
        name: "AI_RetryError",
        message: "Failed after 3 attempts",
        lastError,
        errors: [lastError],
      },
      OPENROUTER,
    );

    expect(error.kind).toBe("provider_unavailable");
    expect(error.errorCode).toBe("maintenance");
    expect(error.requestId).toBe("req_retry");
    expect(error.details).toBe("Provider maintenance");
  });

  it("uses the installed SDK guards for RetryError and APICallError", () => {
    const apiCall = new APICallError({
      message: "Provider returned error",
      url: "https://openrouter.ai/api/v1/chat/completions",
      requestBodyValues: { model: "stealth/ox-alpha" },
      statusCode: 404,
      responseHeaders: {
        "x-request-id": "req_sdk",
        "retry-after": "7",
      },
      responseBody: JSON.stringify({
        error: {
          message: "No endpoints are available for model stealth/ox-alpha",
          code: "model_not_found",
        },
      }),
    });
    const error = normalizeAiError(
      new RetryError({
        message: "Failed after 3 attempts",
        reason: "errorNotRetryable",
        errors: [apiCall],
      }),
      { provider: "OpenRouter", model: "stealth/ox-alpha" },
    );

    expect(error.kind).toBe("model_not_found");
    expect(error.statusCode).toBe(404);
    expect(error.errorCode).toBe("model_not_found");
    expect(error.requestId).toBe("req_sdk");
    expect(error.retryAfter).toBe("7s");
    expect(error.details).toContain("stealth/ox-alpha");
  });

  it("aggregates a generic outer Error with a detailed nested response", () => {
    const cause = Object.assign(new Error("Provider returned error"), {
      response: {
        status: 404,
        headers: new Headers({
          "x-request-id": "req_nested_response",
        }),
        data: {
          error: {
            message: "The requested model does not exist",
            code: "model_not_found",
          },
        },
      },
    });
    const outer = Object.assign(new Error("AI request failed"), { cause });
    const error = normalizeAiError(outer, OPENROUTER);

    expect(error.kind).toBe("model_not_found");
    expect(error.statusCode).toBe(404);
    expect(error.errorCode).toBe("model_not_found");
    expect(error.requestId).toBe("req_nested_response");
    expect(error.details).toBe("The requested model does not exist");
  });

  it("reads status aliases and tuple headers", () => {
    const error = normalizeAiError(
      {
        message: "Too many requests",
        status: "429",
        headers: [
          ["Request-Id", "req_tuple"],
          ["Retry-After", "2.5"],
        ],
        data: { error: { message: "Burst limit reached", code: "rate_limit" } },
      },
      OPENROUTER,
    );

    expect(error.kind).toBe("rate_limit");
    expect(error.statusCode).toBe(429);
    expect(error.requestId).toBe("req_tuple");
    expect(error.retryAfter).toBe("2.5s");
  });

  it("parses nested JSON strings stored in provider metadata", () => {
    const error = normalizeAiError(
      {
        name: "OpenRouterStreamError",
        message: "Provider returned error",
        statusCode: 502,
        code: 502,
        data: {
          error: {
            message: "Provider returned error",
            code: 502,
            metadata: {
              raw: JSON.stringify({
                error: {
                  message: "Upstream inference service is overloaded",
                  code: "provider_overloaded",
                },
                request_id: "req_metadata_raw",
              }),
            },
          },
        },
      },
      OPENROUTER,
    );

    expect(error.kind).toBe("provider_unavailable");
    expect(error.statusCode).toBe(502);
    expect(error.errorCode).toBe("provider_overloaded");
    expect(error.requestId).toBe("req_metadata_raw");
    expect(error.details).toBe("Upstream inference service is overloaded");
  });

  it("redacts secrets found only in nested provider metadata", () => {
    const error = normalizeAiError(
      {
        message: "Provider returned error",
        data: {
          error: {
            code: 401,
            message: "Provider returned error",
            metadata: {
              raw: JSON.stringify({
                error: {
                  message:
                    "Invalid Authorization: Bearer sk-or-nested-secret-value",
                  code: "invalid_api_key",
                },
              }),
            },
          },
        },
      },
      OPENROUTER,
    );

    const details = formatAiErrorDetails(error);
    expect(error.kind).toBe("authentication");
    expect(details).not.toContain("nested-secret-value");
    expect(details).toContain("[REDACTED]");
  });

  it("describes upstream shape without dumping response bodies or secret fields", () => {
    const shape = describeAiErrorShape(
      Object.assign(new Error("Provider returned error"), {
        statusCode: 502,
        responseBody: '{"api_key":"sk-or-do-not-log"}',
        authorization: "Bearer sk-or-do-not-log",
        data: { error: { message: "hidden" } },
      }),
    );
    const serialized = JSON.stringify(shape);

    expect(serialized).toContain("Error");
    expect(serialized).toContain("responseBody");
    expect(serialized).not.toContain("do-not-log");
    expect(serialized).not.toContain("authorization");
  });
});
