import {
  deploymentQualificationEvidenceReceiptSchema,
  deploymentQualificationScope,
  type DeploymentQualificationEvidenceReceipt,
  type DeploymentRuntimeObservation,
  type LocalComputeFabric,
} from "@/modules/ai/lib/localComputeFabric";

export const INSTRUCTION_ADHERENCE_PROCEDURE = {
  id: "clack-instruction-adherence",
  version: 1,
} as const;

export type InstructionAdherenceContract =
  | { kind: "exact"; expected: string }
  | { kind: "required-lines"; lines: readonly string[]; maxChars: number };

export type InstructionAdherenceObservation = {
  /** A complete text part from Clack's actual request/response pipeline. */
  output: string;
  contract: InstructionAdherenceContract;
  personaId: string;
  /** Digest of the *actual* constructed Clack system/persona context. */
  systemContextDigest: `sha256:${string}`;
  requestId: string;
  finish: "stop" | "length" | "cancelled" | "error";
};

export type AdherenceResult = {
  status: "verified" | "failed" | "incomplete";
  checks: { id: string; result: "pass" | "fail" | "incomplete" }[];
};

/** A bounded, deterministic output-contract check, not an IQ benchmark.
 * Exact output subsumes no prefix/suffix and no invented unrelated task.
 * Required lines reject extraneous text and require original line order. */
export function evaluateInstructionAdherence(
  observation: InstructionAdherenceObservation,
): AdherenceResult {
  const { contract, output, finish } = observation;
  if (finish !== "stop")
    return { status: "incomplete", checks: [{ id: "terminal-stop", result: "incomplete" }] };
  if (contract.kind === "exact") {
    const matches = output === contract.expected;
    return {
      status: matches ? "verified" : "failed",
      checks: [{ id: "exact-no-extra-text", result: matches ? "pass" : "fail" }],
    };
  }
  const validContract = contract.lines.length >= 1 && contract.lines.length <= 8 &&
    contract.lines.every(line => line.length > 0 && line.length <= 128) &&
    contract.maxChars >= 1 && contract.maxChars <= 1024;
  const linesMatch = validContract && output.split(/\r?\n/).length === contract.lines.length &&
    output.split(/\r?\n/).every((line, i) => line === contract.lines[i]);
  const concise = output.length <= contract.maxChars;
  return {
    status: linesMatch && concise ? "verified" : "failed",
    checks: [
      { id: "required-lines-in-order", result: linesMatch ? "pass" : "fail" },
      { id: "bounded-no-extra-text", result: concise ? "pass" : "fail" },
    ],
  };
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

/** This records a deterministic comparison over an actual observed text part;
 * neither the prompt nor the model output is persisted in the receipt. A
 * caller must observe the true native runtime identity independently. */
export async function instructionAdherenceReceipt(
  fabric: LocalComputeFabric,
  deploymentId: string,
  runtime: DeploymentRuntimeObservation,
  observed: InstructionAdherenceObservation,
  now = Date.now(),
): Promise<DeploymentQualificationEvidenceReceipt> {
  if (!observed.requestId || observed.requestId.length > 256 ||
      observed.output.length > 4096 ||
      (observed.contract.kind === "exact" && observed.contract.expected.length > 256) ||
      !/^sha256:[a-f0-9]{64}$/.test(observed.systemContextDigest))
    throw new Error("Unbounded or unqualified instruction-adherence observation");
  const scope = deploymentQualificationScope(fabric, deploymentId, runtime, now);
  if (!scope) throw new Error("No current authoritative deployment for adherence test");
  const outcome = evaluateInstructionAdherence(observed);
  const receipt: DeploymentQualificationEvidenceReceipt = {
    version: 2, scope: { ...scope, deploymentId },
    capability: "instruction-adherence", status: outcome.status,
    verifiedAt: now, expiresAt: now + 86_400_000,
    procedure: INSTRUCTION_ADHERENCE_PROCEDURE,
    context: {
      personaId: observed.personaId,
      systemContextDigest: observed.systemContextDigest,
    },
    evidence: {
      source: "deterministic-evaluator", reference: observed.requestId,
      digest: await sha256(JSON.stringify({
        contract: observed.contract, output: observed.output,
        personaId: observed.personaId,
        systemContextDigest: observed.systemContextDigest, finish: observed.finish,
      })),
      checks: outcome.checks,
    },
  };
  return deploymentQualificationEvidenceReceiptSchema.parse(receipt);
}
