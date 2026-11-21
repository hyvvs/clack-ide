import { describe, expect, it } from "vitest";
import {
  QualificationOperationDeadline,
  armDeploymentQualification,
  cancelAllDeploymentQualificationBeforeDispatch,
  disarmDeploymentQualification,
} from "./deploymentQualificationFlight";
import { cancelSessionInference } from "./inferenceLifecycle";

describe("LM11 original operation cancellation after native quiescence", () => {
  it("revokes the SAME original live operation after flight snapshot consumption, without cancelling an unrelated session", async () => {
    const aId = "s-lm11-post-quiescence-A";
    const bId = "s-lm11-post-quiescence-B";
    const a = new QualificationOperationDeadline(120_000);
    const b = new QualificationOperationDeadline(120_000);
    try {
      armDeploymentQualification(aId, "managed-model-A", "builtin:coder", { operation: a });
      expect(disarmDeploymentQualification(aId)).not.toBeNull();
      armDeploymentQualification(bId, "managed-model-B", "builtin:coder", { operation: b });
      expect(a.isOpen()).toBe(true);
      expect(b.isOpen()).toBe(true);

      // The real Stop path revokes a flight even after SDK/native quiescence,
      // while the original (not replacement) aggregate operation is in B03.
      await cancelSessionInference(aId, {
        source: "explicit-user", reason: "cancel-requested",
      });
      expect(a.isOpen()).toBe(false);
      expect(b.isOpen()).toBe(true);
    } finally {
      disarmDeploymentQualification(aId);
      disarmDeploymentQualification(bId);
      a.finish();
      b.finish();
    }
  });

  it("host shutdown also stops a still-live consumed flight without creating another authority", () => {
    const sessionId = "s-lm11-post-quiescence-shutdown";
    const operation = new QualificationOperationDeadline(120_000);
    try {
      armDeploymentQualification(sessionId, "managed-model-A", "builtin:coder", {
        operation,
      });
      expect(disarmDeploymentQualification(sessionId)).not.toBeNull();
      expect(operation.isOpen()).toBe(true);
      cancelAllDeploymentQualificationBeforeDispatch();
      expect(operation.isOpen()).toBe(false);
    } finally {
      disarmDeploymentQualification(sessionId);
      operation.finish();
    }
  });
});
