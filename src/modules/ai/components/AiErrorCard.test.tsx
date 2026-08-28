import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiErrorCard } from "@/modules/ai/components/AiErrorCard";
import {
  normalizeAiError,
  shouldPresentAiError,
} from "@/modules/ai/lib/errors";

function renderError(error: ReturnType<typeof normalizeAiError>): string {
  return renderToStaticMarkup(
    <AiErrorCard
      error={error}
      onDismiss={() => {}}
      onOpenProviderSettings={() => {}}
    />,
  );
}

describe("AiErrorCard", () => {
  it("renders structured authentication details and real actions", () => {
    const error = normalizeAiError(
      {
        message: "Invalid API key",
        statusCode: 401,
        responseHeaders: { "x-request-id": "req_auth" },
      },
      { provider: "OpenRouter", model: "test/model" },
    );
    const html = renderError(error);

    expect(html).toContain("Authentication error");
    expect(html).toContain("OpenRouter");
    expect(html).toContain("test/model");
    expect(html).toContain("req_auth");
    expect(html).toContain("Provider settings");
    expect(html).toContain("Copy details");
    expect(html).toContain("Dismiss");
    expect(html).not.toContain("Retry");
  });

  it("never renders a raw token from provider details", () => {
    const secret = "sk-or-rendered-secret-value";
    const error = normalizeAiError(
      {
        message: `Authorization: Bearer ${secret}`,
        statusCode: 401,
        responseBody: `{"error":{"message":"Bad key ${secret}"}}`,
      },
      { provider: "OpenRouter" },
    );
    const html = renderError(error);

    expect(html).not.toContain(secret);
    expect(html).toContain("[REDACTED]");
  });

  it("renders a tool failure as a tool failure", () => {
    const html = renderError(
      normalizeAiError(new Error("Missing file: docs/absent.md"), {
        kind: "tool",
        toolName: "read_file",
        disposition: "terminal",
      }),
    );

    expect(html).toContain("Tool failed: read_file");
    expect(html).toContain("Missing file");
    expect(html).not.toContain("Provider error");
  });

  it("defensively suppresses recoverable and retrying errors", () => {
    const recoverable = normalizeAiError(
      new Error("Invalid input for tool edit: Type validation failed"),
      { kind: "tool", toolName: "edit" },
    );
    const retrying = normalizeAiError(
      { statusCode: 429, message: "Rate limited" },
      { provider: "OpenRouter", disposition: "retrying" },
    );

    expect(renderError(recoverable)).toBe("");
    expect(renderError(retrying)).toBe("");
  });

  it("suppresses cancelled and interrupted states before rendering", () => {
    const cancelled = normalizeAiError(
      new DOMException("Request aborted", "AbortError"),
    );
    const interrupted = normalizeAiError(new Error("closed"), {
      kind: "interrupted",
    });

    expect(shouldPresentAiError(cancelled, "cancelled")).toBe(false);
    expect(shouldPresentAiError(interrupted, "interrupted")).toBe(false);
  });
});
