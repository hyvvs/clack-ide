import { z } from "zod";
import { isPublicWebUrl } from "@/modules/ai/lib/webSearchAdapters";

/** Inert native browser request shapes, deliberately independent of the AI
 * SDK and live native tool constructors for cheap startup permission checks. */
const nativeId = z.string().regex(/^[a-fA-F0-9]{48}$/);
const browserSessionId = nativeId;
const snapshotId = nativeId;
const elementId = nativeId;
const publicUrl = z.string().max(2048).refine(isPublicWebUrl);
const timeoutMs = z.number().int().min(1000).max(15_000).optional();
const maxBytes = z.number().int().min(256).max(65_536).optional();
const timed = {timeoutMs, maxBytes};

export const tfBrowserOpenSchema = z.object({url:publicUrl,...timed}).strict();
export const tfBrowserNavigateSchema = z.object({
  browserSessionId,url:publicUrl,...timed,
}).strict();
export const tfBrowserInspectSchema = z.object({
  browserSessionId,snapshotId:snapshotId.optional(),
}).strict();
export const tfBrowserClickSchema = z.object({
  browserSessionId,snapshotId,elementId,...timed,
}).strict();
export const tfBrowserBackSchema = z.object({
  browserSessionId,...timed,
}).strict();
export const tfBrowserCloseSchema = z.object({browserSessionId}).strict();

export const TF_BROWSER_SCHEMAS = {
  tf_browser_open:tfBrowserOpenSchema,
  tf_browser_navigate:tfBrowserNavigateSchema,
  tf_browser_inspect:tfBrowserInspectSchema,
  tf_browser_click:tfBrowserClickSchema,
  tf_browser_back:tfBrowserBackSchema,
  tf_browser_close:tfBrowserCloseSchema,
} as const;
export type TfBrowserToolName = keyof typeof TF_BROWSER_SCHEMAS;
export function isTfBrowserTool(name:string):name is TfBrowserToolName {
  return Object.prototype.hasOwnProperty.call(TF_BROWSER_SCHEMAS,name);
}
export function validateTfBrowserInput(name:string,input:unknown):boolean {
  return isTfBrowserTool(name) && TF_BROWSER_SCHEMAS[name].safeParse(input).success;
}
