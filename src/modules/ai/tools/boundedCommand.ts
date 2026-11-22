import { invoke } from "@tauri-apps/api/core";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

/** TF's first native-authorized vertical. The model supplies a structured
 * executable and argv, never a shell string or an approval credential. Native
 * owns the allowlist, workspace authority, ticket, OS process and receipt. */
const commandSchema = z.object({
  action: z.enum(["read_status", "write_marker"]),
  executable: z.string().min(1).max(1024),
  args: z.array(z.string().max(512)).max(12),
  cwd: z.string().min(1).max(4096),
}).strict();

export type BoundedCommandInput = z.infer<typeof commandSchema>;
type NativePrepare = {
  token: string;
  requestId: string;
  action: BoundedCommandInput["action"];
  cwd: string;
  requiresApproval: boolean;
  expiresInSecs: number;
  isolation: string;
};

/** The received native receipt, not an invented JS success result. */
export type NativeToolEffectReceipt = {
  requestId: string;
  toolId: "tf.bounded_command.v1";
  actor: string;
  policyDecision: string;
  approvalId: string | null;
  sandbox: string;
  requestedResources: unknown;
  affectedResources: unknown;
  executable: string;
  args: string[];
  startedAt: number | null;
  endedAt: number | null;
  retry: string;
  action: "read_status" | "write_marker";
  terminal: string;
  sideEffect: string;
  uncertainty: string;
  autoRetry: false;
  pid: number | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutSha256: string;
  stderrSha256: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  isolation: string;
};

const conservativeUnknown = (code: string) => ({
  ok: false,
  code,
  effectState: "Unknown" as const,
  terminal: "unknown" as const,
  retry: "no_auto_retry" as const,
  explanation: "Native terminal/effect could not be authenticated. Nothing is retried automatically.",
});

/** UI approval happens in the existing AI SDK card BEFORE this function is
 * called. The second native ticket is exact-scoped and single-use; it is not
 * a proof against a compromised same-origin renderer. */
export function buildBoundedCommandTools(ctx: ToolContext) {
  return {
    bounded_command: tool({
      description: "Execute a bounded native command with executable+argv, never a shell string. On Windows the ONLY allowed executable is C:/Program Files/Git/cmd/git.exe. Read: action='read_status', args=['status','--short','--untracked-files=no']; write: action='write_marker', args=['config','--local','tf.command.marker','approved']. cwd must be the current registered standalone Git workspace. A write ALWAYS requires per-request Allow once approval, even under Full Access. The native owner limits environment, process tree and timeout, but filesystem and network OS isolation are UNSUPPORTED (not a full sandbox). No automatic retry of a command with uncertain effects. Returns a native effect receipt and bounded stdout/stderr.",
      inputSchema: commandSchema,
      needsApproval: (input) => input.action === "write_marker",
      execute: async (input, options) => {
        const root = ctx.getWorkspaceRoot();
        if (!root || !ctx.getSessionId() || !ctx.getAgentId())
          return {ok:false,code:"tf_workspace_or_actor_missing",effectState:"Unknown",retry:"no_auto_retry"};
        const signal = options?.abortSignal;
        if (signal?.aborted)
          return {ok:false,code:"tf_cancelled_before_prepare",effectState:"NoEffect",retry:"no_auto_retry"};
        let prepared: NativePrepare;
        try {
          prepared = await invoke<NativePrepare>("tf_command_prepare", {
            request: { ...input, actor: ctx.getAgentId(), workspaceRoot: root },
          });
        } catch {
          // A rejected native admission has not given renderer a trustworthy
          // receipt. Never fabricate process/effect/sandbox success.
          return conservativeUnknown("tf_native_admission_failed");
        }
        if (prepared.action !== input.action || !prepared.token || !prepared.requestId)
          return conservativeUnknown("tf_native_preparation_mismatch");
        const cancel = () => void invoke("tf_command_cancel", {token:prepared.token}).catch(()=>undefined);
        if (signal?.aborted) cancel();
        else signal?.addEventListener("abort",cancel,{once:true});
        try {
          if (prepared.requiresApproval) {
            // Never call this from a component or model-provided function. It
            // is reached solely following SDK tool approval/execute dispatch.
            await invoke("tf_command_approve",{token:prepared.token});
          }
          const receipt=await invoke<NativeToolEffectReceipt>("tf_command_execute",{
            token:prepared.token,
          });
          if (receipt.requestId !== prepared.requestId ||
              receipt.toolId !== "tf.bounded_command.v1" || receipt.actor !== ctx.getAgentId())
            return conservativeUnknown("tf_native_receipt_mismatch");
          return {ok:receipt.terminal === "completed" && receipt.exitCode === 0,
            effectReceipt:receipt};
        } catch {
          // May have spawned before the IPC disconnected. Cannot assume an
          // operation failed harmlessly or is safe to retry.
          cancel();
          return conservativeUnknown("tf_native_terminal_unknown");
        } finally {
          signal?.removeEventListener("abort",cancel);
        }
      },
    }),
  } as const;
}
