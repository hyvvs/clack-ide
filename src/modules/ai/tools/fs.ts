import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import {
  checkReadableCanonical,
  checkWritableCanonical,
} from "../lib/security";
import { newQueuedEditId, usePlanStore } from "../store/planStore";
import { resolvePath, type ToolContext } from "./context";
import { observeCheckpointWrite } from "@/modules/ai/lib/writeCheckpoint";
import {
  hashText,
  isMissingPathError,
  validateReadSnapshot,
} from "../lib/readSnapshot";

const READ_BYTE_CAP = 25 * 1024;
const READ_LINE_CAP = 2000;

export function buildFsTools(ctx: ToolContext) {
  const workspace = () => ctx.getWorkspaceEnv?.();
  const canonicalize = (path: string) =>
    native.canonicalize(path, workspace());
  return {
    read_file: tool({
      description:
        "Read UTF-8 text, first 2000 lines (max 25KB). Use `offset`/`limit` for line windows. Refuses binary, oversized and sensitive files (.env, keys, credentials). An unchanged full re-read returns `unchanged: true`; reuse the prior content.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute or active-terminal-cwd-relative."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Start line: 0-based; default 0."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .optional()
          .describe("Max lines; default 2000."),
      }),
      execute: async ({ path, offset, limit }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkReadableCanonical(reqPath, canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const r = await native.readFile(abs, workspace());
          if (r.kind === "binary")
            return { error: "binary file refused", path: abs, size: r.size };
          if (r.kind === "toolarge")
            return {
              error: `file too large (${r.size} bytes, limit ${r.limit})`,
              path: abs,
            };

          const hash = hashText(r.content);
          const isFullRead = offset === undefined && limit === undefined;
          const prior = ctx.readCache.get(abs);
          if (isFullRead && prior && prior.size === r.size && prior.hash === hash) {
            return { path: abs, unchanged: true, size: r.size };
          }
          ctx.readCache.set(abs, { size: r.size, hash });

          if (isFullRead) {
            const lines = r.content.split("\n");
            const sliceEnd = Math.min(lines.length, READ_LINE_CAP);
            let content = lines.slice(0, sliceEnd).join("\n");
            let truncated = sliceEnd < lines.length;
            if (content.length > READ_BYTE_CAP) {
              content = content.slice(0, READ_BYTE_CAP);
              truncated = true;
            }
            return {
              path: abs,
              content,
              size: r.size,
              total_lines: lines.length,
              ...(truncated
                ? { truncated: true, hint: "call read_file with offset to continue" }
                : {}),
            };
          }

          const lines = r.content.split("\n");
          const start = offset ?? 0;
          const requested = limit ?? READ_LINE_CAP;
          const end = Math.min(lines.length, start + requested);
          let content = lines.slice(start, end).join("\n");
          let truncated = end < lines.length;
          if (content.length > READ_BYTE_CAP) {
            content = content.slice(0, READ_BYTE_CAP);
            truncated = true;
          }
          return {
            path: abs,
            content,
            size: r.size,
            total_lines: lines.length,
            start_line: start,
            end_line: end,
            ...(truncated ? { truncated: true } : {}),
          };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    list_directory: tool({
      description:
        "List immediate files and directories; hidden entries omitted.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute or active-terminal-cwd-relative."),
      }),
      execute: async ({ path }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkReadableCanonical(reqPath, canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const entries = await native.readDir(abs, workspace());
          return {
            path: abs,
            entries: entries.map((e) => ({ name: e.name, kind: e.kind })),
          };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    write_file: tool({
      description:
        "Create a brand-new file or overwrite a previously read small text file. Confirm its parent exists. Prefer exposed exact-string editing for targeted changes; do not replace a whole file for a targeted edit. Approval follows the active agent policy.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path, content }, execution) => {
        const sessionId = ctx.getSessionId(), workspaceId = ctx.getWorkspaceId?.(), runId = ctx.getRunId?.();
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;

        let original = "";
        let isNewFile = false;
        try {
          const existing = await native.readFile(abs, workspace());
          if (existing.kind !== "text") {
            return {
              error: "existing binary or oversized file refused",
              code: "existing_file_not_text",
              path: abs,
            };
          }
          original = existing.content;
          const snapshot = validateReadSnapshot(
            existing.content,
            ctx.readCache.get(abs),
          );
          if (!snapshot.ok) {
            return {
              error: snapshot.error,
              code: snapshot.code,
              path: abs,
            };
          }
        } catch (error) {
          if (!isMissingPathError(error)) {
            return { error: String(error), path: abs };
          }
          isNewFile = true;
        }

        if (usePlanStore.getState().active) {
          usePlanStore.getState().enqueue({
            id: newQueuedEditId(),
            kind: "write_file",
            path: abs,
            originalContent: original,
            proposedContent: content,
            isNewFile,
            workspaceEnvironment: workspace(),
          });
          return {
            path: abs,
            queued_for_plan_review: true,
            ok: true,
          };
        }

        try {
          await native.writeFile(abs, content, workspace());
          if (sessionId && workspaceId && runId !== undefined && execution?.toolCallId) {
            // Observation failure must not misreport or replay an already applied write.
            await observeCheckpointWrite({ sessionId, workspaceId }, runId, execution.toolCallId, { path: abs, content }).catch(() => undefined);
          }
          ctx.readCache.set(abs, {
            size: content.length,
            hash: hashText(content),
          });
          return { path: abs, bytesWritten: content.length, ok: true, clackWorkspaceWrite: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    create_directory: tool({
      description:
        "Create a directory and missing parents. Approval follows the active agent policy.",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        if (usePlanStore.getState().active) {
          usePlanStore.getState().enqueue({
            id: newQueuedEditId(),
            kind: "create_directory",
            path: abs,
            originalContent: "",
            proposedContent: "",
            isNewFile: true,
            description: "Create directory",
            workspaceEnvironment: workspace(),
          });
          return { path: abs, queued_for_plan_review: true, ok: true };
        }
        try {
          await native.createDir(abs, workspace());
          return { path: abs, ok: true, clackWorkspaceWrite: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),
  } as const;
}
