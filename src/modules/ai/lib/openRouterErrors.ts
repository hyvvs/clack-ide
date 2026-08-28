import type { TextStreamPart, ToolSet } from "ai";
import { z } from "zod";

const openRouterErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        message: z.string(),
        code: z.union([z.string(), z.number()]).nullish(),
        type: z.string().nullish(),
        param: z.unknown().nullish(),
        metadata: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type OpenRouterErrorEnvelope = z.infer<
  typeof openRouterErrorEnvelopeSchema
>;

export class OpenRouterStreamError extends Error {
  readonly statusCode?: number;
  readonly code?: string | number | null;
  readonly data: OpenRouterErrorEnvelope;

  constructor(data: OpenRouterErrorEnvelope) {
    super(data.error.message);
    this.name = "OpenRouterStreamError";
    const status = Number(data.error.code);
    this.statusCode =
      Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : undefined;
    this.code = data.error.code;
    this.data = data;
  }
}

export function openRouterStreamErrorFromRaw(
  value: unknown,
): OpenRouterStreamError | null {
  const parsed = openRouterErrorEnvelopeSchema.safeParse(value);
  return parsed.success ? new OpenRouterStreamError(parsed.data) : null;
}

export function preserveOpenRouterErrorMetadata<
  TOOLS extends ToolSet,
>(): TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> {
  let pending: OpenRouterStreamError | null = null;
  return new TransformStream({
    transform(part, controller) {
      if (part.type === "raw") {
        pending = openRouterStreamErrorFromRaw(part.rawValue);
        return;
      }
      if (part.type === "error" && pending) {
        controller.enqueue({ ...part, error: pending });
        pending = null;
        return;
      }
      pending = null;
      controller.enqueue(part);
    },
  });
}
