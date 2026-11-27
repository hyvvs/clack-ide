import { z } from "zod";
import { isPublicWebUrl } from "@/modules/ai/lib/webSearchAdapters";

/** TF3 input validation is available to startup permissions without importing
 * the AI SDK or tool factories. Native TF3 repeats authoritative policy. */
const publicUrl = z.string().min(1).max(2048).refine(isPublicWebUrl);
const resultId = z.string().regex(/^[a-f0-9]{48}$/i);
const timeoutMs = z.number().int().min(1000).max(15_000).optional();
const maxRedirects = z.number().int().min(0).max(5).optional();
const commonFetch = { url: publicUrl.optional(), searchResultId: resultId.optional(),
  timeoutMs, maxRedirects };
const exactlyOneTarget = (value: {url?:string;searchResultId?:string}) =>
  Boolean(value.url) !== Boolean(value.searchResultId);

export const tfHttpFetchSchema = z.object({
  ...commonFetch,
  maxBytes: z.number().int().min(256).max(65_536).optional(),
}).strict().refine(exactlyOneTarget, "Specify exactly one URL or native searchResultId");
export const tfHttpHeadSchema = z.object(commonFetch)
  .strict().refine(exactlyOneTarget, "Specify exactly one URL or native searchResultId");
export const tfWebSearchSchema = z.object({
  query: z.string().trim().min(2).max(256),
  timeoutMs,
}).strict();

export const TF_WEB_SCHEMAS = {
  tf_http_fetch: tfHttpFetchSchema,
  tf_http_head: tfHttpHeadSchema,
  tf_web_search: tfWebSearchSchema,
} as const;
export type TfWebToolName = keyof typeof TF_WEB_SCHEMAS;
export function isTfWebTool(name: string): name is TfWebToolName {
  return Object.prototype.hasOwnProperty.call(TF_WEB_SCHEMAS,name);
}
export function validateTfWebInput(name: string,input: unknown): boolean {
  return isTfWebTool(name) && TF_WEB_SCHEMAS[name].safeParse(input).success;
}
