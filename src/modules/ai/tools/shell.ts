import { currentWorkspaceEnv, workspaceScopeKey } from "@/modules/workspace";
import type { WorkspaceEnv } from "@/modules/workspace/env";
import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkShellCommand } from "../lib/security";
import { type NativeTodoCheck, newTodoId } from "../lib/todos";
import { useTodosStore } from "../store/todoStore";
import type { ToolContext } from "./context";

/**
 * Per-session lazy shell-session id. The agent gets one persistent shell per
 * chat session, so cwd survives across tool calls (cd, mkdir+cd, etc).
 */
const sessionShells = new Map<string, Promise<number>>();

async function getSessionShell(
  sessionId: string,
  cwd: string | null,
  workspace: WorkspaceEnv | undefined,
): Promise<number> {
  let p = sessionShells.get(sessionId);
  if (!p) {
    p = native.shellSessionOpen(cwd, workspace);
    sessionShells.set(sessionId, p);
  }
  return p;
}

function workspaceSessionKey(
  sessionId: string,
  workspaceId: string | null | undefined,
): string {
  return `${sessionId}:${workspaceId ?? workspaceScopeKey(currentWorkspaceEnv())}`;
}

export function buildShellTools(ctx: ToolContext) {
  return {
    bash_run: tool({
      description:
        "Run a foreground command in this session's persistent native shell. Despite the historical tool id `bash_run`, this is NOT necessarily Bash: obey the current <env> shell and shell_syntax fields exactly. cwd persists across calls. Use for short-lived commands (lint, test, search, build), including creating new workspace files with noninteractive native-shell file-writing commands when authorized. Respect workspace scope, secret-path protections and approvals. Do not use for dev servers, watchers or daemons; these require an exposed background-process capability. NEVER invoke interactive tools (vim, less, top). Approval follows the active agent policy.",
      inputSchema: z.object({
        command: z.string(),
        timeout_secs: z.number().int().min(1).max(300).optional(),
        verify_todo_id: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .describe(
            "Explicit existing Todo identity to associate the native command's observed outcome with. Does not certify arbitrary application functionality.",
          ),
        verification_purpose: z.string().trim().min(1).max(160).optional(),
      }),
      execute: async ({
        command,
        timeout_secs,
        verify_todo_id,
        verification_purpose,
      }) => {
        const safety = checkShellCommand(command);
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        // Association is metadata only. The same authorized bash_run executes,
        // or remains denied; no extra command path or new approval bypass.
        const todo = verify_todo_id
          ? useTodosStore
              .getState()
              .bySession[sid]?.find(
                (t) => t.id === verify_todo_id && !t.superseded,
              )
          : undefined;
        if (verify_todo_id && !todo)
          return {
            error: "verification Todo identity is not accepted in this session",
          };
        const runStartedAt = ctx.getRunId?.();
        const userTurnCount = ctx.getUserTurnCount?.();
        const workspaceId = ctx.getWorkspaceId?.();
        const root = ctx.getWorkspaceRoot();
        const env = ctx.getWorkspaceEnv?.();
        const startedAt = Date.now();
        const witness = async () => {
          if (!verify_todo_id || !root) return null;
          try {
            return await native.agentWorkspaceFingerprint(root, env);
          } catch {
            return null;
          }
        };
        const before = safety.ok ? await witness() : null;
        const record = (
          status: NativeTodoCheck["status"],
          exitCode: number | null,
          after: Awaited<ReturnType<typeof witness>>,
          reason?: string,
        ) => {
          if (
            !verify_todo_id ||
            !runStartedAt ||
            userTurnCount === undefined ||
            !workspaceId ||
            !todo
          )
            return null;
          const receipt: NativeTodoCheck = {
            id: `${sid}:${runStartedAt}:${newTodoId()}`,
            purpose: (verification_purpose ?? "Native command check").slice(
              0,
              160,
            ),
            command: command.slice(0, 240),
            sessionId: sid,
            workspaceId,
            runStartedAt,
            userTurnCount,
            startedAt,
            finishedAt: Date.now(),
            exitCode,
            status,
            beforeRevision: before?.revision ?? null,
            afterRevision: after?.revision ?? null,
            qualification:
              before?.qualification === after?.qualification
                ? (before?.qualification ?? "unavailable")
                : "unavailable",
            ...(reason ? { reason: reason.slice(0, 200) } : {}),
          };
          return useTodosStore
            .getState()
            .recordNativeCheck(sid, verify_todo_id, receipt)
            ? receipt.id
            : null;
        };
        if (!safety.ok) {
          const evidenceId = record("blocked", null, null, safety.reason);
          return {
            error: safety.reason,
            ...(evidenceId ? { nativeCheckEvidenceId: evidenceId } : {}),
          };
        }
        try {
          const cwd = ctx.getCwd();
          const workspace = ctx.getWorkspaceEnv?.();
          const shellId = await getSessionShell(
            workspaceSessionKey(sid, ctx.getWorkspaceId?.()),
            cwd,
            workspace,
          );
          const r = await native.shellSessionRun(
            shellId,
            command,
            cwd,
            timeout_secs,
            workspace,
          );
          const after = await witness();
          const evidenceId = record(
            r.timed_out
              ? "timed-out"
              : r.exit_code === 0
                ? "passed"
                : r.exit_code === null
                  ? "blocked"
                  : "failed",
            r.exit_code,
            after,
            r.exit_code === null && !r.timed_out
              ? "Native exit status unavailable"
              : undefined,
          );
          return {
            command,
            stdout: r.stdout,
            stderr: r.stderr,
            exit_code: r.exit_code,
            timed_out: r.timed_out,
            truncated: r.truncated,
            cwd_after: r.cwd_after,
            ...(evidenceId ? { nativeCheckEvidenceId: evidenceId } : {}),
          };
        } catch (e) {
          const cancelled = String(e).includes("Foreground shell command cancelled");
          const evidenceId = record(
            cancelled ? "cancelled" : "not-started",
            null,
            await witness(),
            String(e),
          );
          return {
            error: String(e),
            ...(cancelled ? { cancelled: true } : {}),
            ...(evidenceId ? { nativeCheckEvidenceId: evidenceId } : {}),
          };
        }
      },
    }),

    bash_background: tool({
      description:
        "Spawn a long-running process using the native shell declared by the current <env> shell and shell_syntax fields. Despite the historical `bash_` tool ids, do not assume POSIX Bash syntax. Returns a handle for exposed log/stop capabilities. Output is captured into a 4MB ring buffer. Approval follows the active agent policy.",
      inputSchema: z.object({
        command: z.string(),
        cwd: z.string().nullable().optional(),
      }),
      execute: async ({ command, cwd }) => {
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };
        const effectiveCwd = cwd ?? ctx.getCwd();
        try {
          const handle = await native.shellBgSpawn(
            command,
            effectiveCwd,
            ctx.getWorkspaceEnv?.(),
          );
          return { handle, command, cwd: effectiveCwd, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_logs: tool({
      description:
        "Read accumulated logs from a managed background process. Pass `since_offset` from the previous response's `next_offset` to tail incrementally. `dropped` reports bytes evicted by the ring buffer.",
      inputSchema: z.object({
        handle: z.number().int(),
        since_offset: z.number().int().optional(),
      }),
      execute: async ({ handle, since_offset }) => {
        try {
          const r = await native.shellBgLogs(handle, since_offset);
          return r;
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_list: tool({
      description:
        "List all managed background processes in this app, running and exited. Always call this BEFORE spawning a new long-running process to avoid duplicates. If a matching process is already running, reuse it; inspect it through an exposed preview capability instead of respawning. Auto-executes.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const list = await native.shellBgList();
          return { processes: list };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_kill: tool({
      description:
        "Terminate a managed background process by handle. Idempotent: kills nothing if the handle is unknown or already exited.",
      inputSchema: z.object({ handle: z.number().int() }),
      execute: async ({ handle }) => {
        try {
          await native.shellBgKill(handle);
          return { handle, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
