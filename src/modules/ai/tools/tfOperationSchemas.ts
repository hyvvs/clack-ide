import { z } from "zod";

/** TF operation authority shapes are safe to import during app startup.
 * The AI SDK tool constructors live separately in tfOperations.ts. */
const path = z.string().min(1).max(4096);
const sha = z.string().regex(/^[a-f0-9]{64}$/i);
const content = z.string().max(262_144);
const text = z.string().min(1).max(65_536);
const pattern = z.string().min(1).max(256);
const query = z.string().min(1).max(256);
const refName = z.string().regex(/^[A-Za-z0-9._/-]{1,96}$/)
  .refine(value=>!value.startsWith("-") && !value.startsWith(".") &&
    !value.endsWith("/") && !value.endsWith(".") &&
    !value.endsWith(".lock") && !value.includes("..") &&
    !value.includes("//"));
const paths = z.array(path).min(1).max(64);
const pagination = { offset: z.number().int().min(0).max(100_000).optional(),
  limit: z.number().int().min(1).max(1000).optional() };
const depth = { depth: z.number().int().min(0).max(8).optional() };
const op = <Name extends string, Shape extends z.ZodRawShape>(
  name: Name, fields: Shape,
) => z.object({ operation: z.literal(name), ...fields }).strict();

export const tfFsReadSchema = z.discriminatedUnion("operation", [
  op("file_read", { path, ...pagination }),
  op("file_stat", { path }),
  op("directory_list", { path, ...depth }),
  op("file_find", { path, pattern, ...depth, ...pagination }),
  op("text_search", { path, query, ...depth, ...pagination }),
]);
export const tfFsWriteSchema = z.discriminatedUnion("operation", [
  op("file_create", { path, content }),
  op("file_replace", { path, content, expectedSha256: sha }),
  op("file_patch", { path, oldText: text, newText: content,
    expectedSha256: sha }),
  op("directory_create", { path }),
  op("file_move", { path, destination: path, expectedSha256: sha }),
]);
export const tfFsDeleteSchema = op("file_delete", {
  path, expectedSha256: sha,
});
export const tfRepoReadSchema = z.discriminatedUnion("operation", [
  op("repo_status", {}),
  op("repo_branch", {}),
  op("repo_head", {}),
  op("repo_changed", {}),
  op("repo_diff", { paths }),
  op("repo_staged_diff", { paths }),
  op("repo_log", {}),
  op("repo_show", { refName: refName.optional(), paths }),
  op("repo_refs", {}),
]);
export const tfRepoWriteSchema = z.discriminatedUnion("operation", [
  op("repo_stage", { paths }),
  op("repo_unstage", { paths }),
  op("repo_create_branch", { refName }),
  op("repo_switch_branch", { refName }),
]);
export const tfBuildRunSchema = z.discriminatedUnion("operation", [
  op("build_typecheck", { timeoutMs: z.number().int().min(1000).max(120_000).optional() }),
  op("build_frontend", { timeoutMs: z.number().int().min(1000).max(120_000).optional() }),
  op("build_cargo_check", { timeoutMs: z.number().int().min(1000).max(120_000).optional() }),
  op("build_cargo_test", { timeoutMs: z.number().int().min(1000).max(120_000).optional() }),
  op("build_cargo_build", { timeoutMs: z.number().int().min(1000).max(120_000).optional() }),
]);

export const TF_OPERATION_SCHEMAS = {
  tf_fs_read: tfFsReadSchema,
  tf_fs_write: tfFsWriteSchema,
  tf_fs_delete: tfFsDeleteSchema,
  tf_repo_read: tfRepoReadSchema,
  tf_repo_write: tfRepoWriteSchema,
  tf_build_run: tfBuildRunSchema,
} as const;
export type TfOperationToolName = keyof typeof TF_OPERATION_SCHEMAS;
export function isTfOperationTool(name:string):name is TfOperationToolName {
  return Object.prototype.hasOwnProperty.call(TF_OPERATION_SCHEMAS,name);
}
export function validateTfOperationInput(name:string,value:unknown):value is Record<string,unknown> {
  return isTfOperationTool(name) &&
    TF_OPERATION_SCHEMAS[name].safeParse(value).success;
}
export function tfOperationEffectful(name:string):boolean {
  return name === "tf_fs_write" || name === "tf_fs_delete" ||
    name === "tf_repo_write" || name === "tf_build_run";
}
