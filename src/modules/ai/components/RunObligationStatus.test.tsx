import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { inspectRunObligations } from "../lib/runObligations";
import {
  RunObligationEvidence,
  RunObligationStatus,
} from "./RunObligationStatus";

describe("R3a visible run evidence", () => {
  it("does not present an empty plan as settled evidence before restart hydration", () => {
    const html = renderToStaticMarkup(
      <RunObligationStatus
        sessionId="unhydrated-ended-chat"
        workspaceId="local:/a"
        run={{ state: "completed", startedAt: 10, workspaceId: "local:/a" }}
        messages={[]}
        continuation="new-instruction"
      />,
    );
    expect(html).toContain("Loading persisted Agent obligations");
    expect(html).not.toContain("Plan: 0 tracked");
  });
  it("renders unfinished work after a normal model stop without promoting an untested source write", () => {
    const report = inspectRunObligations({
      sessionId: "chat",
      workspaceId: "local:/a",
      todos: [
        { id: "api", title: "Implement backend API", status: "pending" },
        { id: "ui", title: "Implement frontend", status: "in_progress" },
        { id: "test", title: "Run tests", status: "completed" },
      ],
      run: {
        state: "completed",
        startedAt: 10,
        budget: {
          softStepLimit: 24,
          hardStepLimit: 240,
          autoContinue: false,
          maxAutoContinuations: 9,
          totalSteps: 8,
          continuationCount: 0,
          peerTaskCount: 0,
          phase: "complete",
          stopReason: null,
          lastFinishReason: "stop",
          continuationPromptPending: false,
        },
      },
      messages: [
        {
          id: "u",
          role: "user",
          parts: [{ type: "text", text: "Build application" }],
        },
      ],
    });
    const html = renderToStaticMarkup(
      <RunObligationEvidence report={report} continuation="new-instruction" />,
    );
    expect(html).toContain("Task status: unfinished");
    expect(html).toContain("Implement backend API");
    expect(html).toContain("Implement frontend");
    expect(html).toContain("marked done without current independent proof");
    expect(html).toContain(
      "No independently identifiable test or build execution",
    );
    expect(html).toContain("No automatic continuation is available");
    expect(html).not.toContain("independently verified</div>");
  });
});
