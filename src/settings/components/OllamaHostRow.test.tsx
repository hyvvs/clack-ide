import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OllamaHostRow, ollamaHostStatus, ollamaProbeIssue } from "./OllamaHostRow";

describe("Ollama host presentation", () => {
  it("distinguishes unknown, checked offline, and disabled without claiming Agent readiness", () => {
    expect(ollamaHostStatus(true, "unknown")).toBe("Unknown — refresh to check");
    expect(ollamaHostStatus(true, "offline")).toBe("Offline (last check)");
    expect(ollamaHostStatus(false, "online")).toBe("Disabled");
    expect(ollamaProbeIssue("unsupported-probe-route")).toBe("Model inventory unavailable");
    expect(ollamaProbeIssue("token=PRIVATE")).toBe("Metadata check failed");
  });

  it("renders a local Ollama host with an explicit evidence limitation", () => {
    const html = renderToStaticMarkup(
      <OllamaHostRow
        alias="My Ollama"
        address="http://127.0.0.1:11434/"
        location="This PC"
        enabled
        connection="online"
        modelCount={2}
        version="0.40.11"
        onToggle={vi.fn()}
        onRefresh={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(html).toContain("This PC");
    expect(html).toContain("Online (last check)");
    expect(html).toContain("2 discovered models");
    expect(html).toContain("Last reported Ollama 0.40.11");
    expect(html).toContain("Not checked");
    expect(html).toContain("Refresh Ollama model inventory");
    expect(html).toContain("Connection does not establish model context or native tool readiness");
    expect(html).toContain('aria-label="Disable Ollama host My Ollama"');
  });

  it("keeps a disabled remote host editable but disallows toggling while busy", () => {
    const html = renderToStaticMarkup(
      <OllamaHostRow
        alias="Lab"
        address="http://192.0.2.10:11434/"
        location="Other computer"
        enabled={false}
        connection="unknown"
        modelCount={1}
        busy
        lastCheckedAt={1_700_000_000_000}
        lastSuccessAt={1_699_999_000_000}
        lastErrorCode="authentication-failed"
        onToggle={vi.fn()}
        onRefresh={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(html).toContain("Other computer");
    expect(html).toContain("Disabled");
    expect(html).toContain("Ollama version unknown");
    expect(html).toContain("Last probe: Authentication required");
    expect(html).toContain("Last successful check:");
    expect(html).toContain("Enable this Ollama host before refreshing");
    expect(html).toContain('aria-label="Enable Ollama host Lab"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("Manage");
  });
});
