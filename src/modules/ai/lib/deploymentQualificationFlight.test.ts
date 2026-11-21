import type { ModelMessage, UIMessageChunk } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import {
  MANAGED_QUALIFICATION_MAX_OUTPUT,
  MANAGED_QUALIFICATION_PROMPT,
  armDeploymentQualification,
  disarmDeploymentQualification,
  hasActiveDeploymentQualification,
  observeDeploymentQualificationPrepared,
  observeDeploymentQualificationStream,
  qualificationMaxOutputTokens,
} from "./deploymentQualificationFlight";

const session = "lm2f-observed-chat";
const model = "exact-managed-deployment-a";
const messages: ModelMessage[] = [
  { role: "system", content: "CORE SYSTEM\nACTIVE AGENT: Coder\nReal persona instructions" },
  { role: "user", content: [{ type: "text", text: "<env>real Clack context</env>\n\n" + MANAGED_QUALIFICATION_PROMPT }] },
];
afterEach(() => disarmDeploymentQualification(session));

describe("LM2F bounded request and parsed-stream observer", () => {
  it("observes only an explicit real-context no-tool request and keeps bounded hashed evidence", async () => {
    armDeploymentQualification(session, model, "builtin:coder");
    expect(hasActiveDeploymentQualification(session)).toBe(true);
    expect(qualificationMaxOutputTokens(session)).toBe(MANAGED_QUALIFICATION_MAX_OUTPUT);
    expect(() => armDeploymentQualification("other-session", model, "builtin:coder"))
      .toThrow(/qualification is active/);
    await observeDeploymentQualificationPrepared(session, {
      modelId: model, messages, outputLimit: 64, activeTools: [],
    });
    const chunks = [
      { type: "text-start", id: "part-a" },
      { type: "text-delta", id: "part-a", delta: "LM2F-CHAT-" },
      { type: "text-delta", id: "part-a", delta: "QUALIFIED" },
      { type: "text-end", id: "part-a" },
      { type: "finish", finishReason: "stop" },
    ];
    for (const chunk of chunks)
      observeDeploymentQualificationStream(session, chunk as UIMessageChunk);
    const snapshot = disarmDeploymentQualification(session)!;
    expect(snapshot).toMatchObject({
      prepared: 1, textStarts: 1, textDeltas: 2,
      textEnds: 1, textChars: 19, finishes: 1, violations: [],
    });
    expect(snapshot.systemContextDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(snapshot.modelMessagesDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain("CORE SYSTEM");
    expect(JSON.stringify(snapshot)).not.toContain(MANAGED_QUALIFICATION_PROMPT);
    expect(hasActiveDeploymentQualification(session)).toBe(false);
  });

  it.each([
    ["wrong deployment", { modelId: "other-model", messages, outputLimit: 64, activeTools: [] }],
    ["native tool exposed", { modelId: model, messages, outputLimit: 64, activeTools: ["write_file"] }],
    ["output too large", { modelId: model, messages, outputLimit: 2048, activeTools: [] }],
    ["persona changed", { modelId: model, messages: [{ role: "system", content: "Other persona" }, messages[1]],
      outputLimit: 64, activeTools: [] }],
    ["not Clack's actual prompt", { modelId: model, messages: [messages[0],
      { role: "user", content: [{ type: "text", text: "Some other task" }] }],
      outputLimit: 64, activeTools: [] }],
  ])("%s is rejected before dispatch and never accepted as qualifying evidence", async (_label, prepared) => {
    armDeploymentQualification(session, model, "builtin:coder");
    await expect(observeDeploymentQualificationPrepared(session,
      prepared as Parameters<typeof observeDeploymentQualificationPrepared>[1]))
      .rejects.toThrow(/did not match/);
    expect(disarmDeploymentQualification(session)!.violations.length).toBeGreaterThan(0);
  });

  it("a normal, unarmed Chat cannot silently acquire qualification state", async () => {
    const unarmed = "ordinary-not-previously-qualified-session";
    await expect(observeDeploymentQualificationPrepared(unarmed, {
      modelId: model, messages, outputLimit: 128, activeTools: [],
    })).resolves.toBeUndefined();
    observeDeploymentQualificationStream(unarmed, {
      type: "finish", finishReason: "stop",
    } as UIMessageChunk);
    expect(disarmDeploymentQualification(unarmed)).toBeNull();
    expect(qualificationMaxOutputTokens(unarmed)).toBeUndefined();
  });
});
