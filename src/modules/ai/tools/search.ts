import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkReadableCanonical } from "../lib/security";
import { resolvePath, type ToolContext } from "./context";

function resolveRoot(
  rawRoot: string | undefined,
  ctx: ToolContext,
): { ok: true; path: string } | { ok: false; error: string } {
  if (rawRoot && rawRoot.trim().length > 0) {
    try {
      return { ok: true, path: resolvePath(rawRoot, ctx.getCwd()) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  const ws = ctx.getWorkspaceRoot();
  if (ws) return { ok: true, path: ws };
  const cwd = ctx.getCwd();
  if (cwd) return { ok: true, path: cwd };
  return {
    ok: false,
    error: "no workspace root or active cwd; pass `root` explicitly.",
  };
}

const MAX_LINE_LEN = 160;

function clipLine(s: string): string {
  if (s.length <= MAX_LINE_LEN) return s;
  return `${s.slice(0, MAX_LINE_LEN)}…[+${s.length - MAX_LINE_LEN}]`;
}

export function buildSearchTools(ctx: ToolContext) {
  const workspace = () => ctx.getWorkspaceEnv?.();
  const canonicalize = (path: string) =>
    native.canonicalize(path, workspace());
  return {
    grep: tool({
      description:
        "Search workspace file contents by regex; honors .gitignore. Returns `{path, line, text}` hits (default 30, max 500), `truncated` if more, lines clipped to 160 chars. Do NOT brute-force read_file across the tree; narrow with `glob` and raise `max_results` only as needed.",
      inputSchema: z.object({
        pattern: z
          .string()
          .describe(
            "Rust ripgrep regex; escape literals.",
          ),
        root: z
          .string()
          .optional()
          .describe(
            "Root; default workspace root, then cwd.",
          ),
        glob: z
          .array(z.string())
          .optional()
          .describe(
            "Relative include globs, e.g. **/*.ts.",
          ),
        case_insensitive: z.boolean().optional(),
        max_results: z.number().int().min(1).max(500).optional(),
      }),
      execute: async ({
        pattern,
        root,
        glob,
        case_insensitive,
        max_results,
      }) => {
        const r = resolveRoot(root, ctx);
        if (!r.ok) return { error: r.error };
        const safety = await checkReadableCanonical(r.path, canonicalize);
        if (!safety.ok) return { error: safety.reason, root: r.path };
        r.path = safety.canonical;
        const cap = Math.min(max_results ?? 30, 500);
        try {
          const res = await native.grep(
            {
              pattern,
              root: r.path,
              glob,
              caseInsensitive: case_insensitive,
              maxResults: cap,
            },
            workspace(),
          );
          return {
            root: r.path,
            hits: res.hits.map((h) => ({
              path: h.path,
              rel: h.rel,
              line: h.line,
              text: clipLine(h.text),
            })),
            truncated: res.truncated,
            files_scanned: res.files_scanned,
          };
        } catch (e) {
          return { error: String(e), root: r.path };
        }
      },
    }),

    glob: tool({
      description:
        "Find files recursively by gitignore-aware globset pattern, e.g. `**/*.ts`. Prefer over `list_directory` for recursive matches; returns up to `max_results`.",
      inputSchema: z.object({
        pattern: z.string().describe("Glob pattern over relative paths."),
        root: z.string().optional(),
        max_results: z.number().int().min(1).max(2000).optional(),
      }),
      execute: async ({ pattern, root, max_results }) => {
        const r = resolveRoot(root, ctx);
        if (!r.ok) return { error: r.error };
        const safety = await checkReadableCanonical(r.path, canonicalize);
        if (!safety.ok) return { error: safety.reason, root: r.path };
        r.path = safety.canonical;
        try {
          const res = await native.glob(
            {
              pattern,
              root: r.path,
              maxResults: max_results,
            },
            workspace(),
          );
          return {
            root: r.path,
            hits: res.hits,
            truncated: res.truncated,
          };
        } catch (e) {
          return { error: String(e), root: r.path };
        }
      },
    }),
  } as const;
}
