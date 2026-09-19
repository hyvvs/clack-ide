export const UNKNOWN_CONTEXT_POLICY = 4096;

export type BudgetLimits = {
  deployed?: number;
  asserted?: number;
  reported?: number;
  theoretical?: number;
  advertised?: number;
  inputCap?: number;
  outputCap?: number;
  workingTarget?: number;
  outputReserve?: number;
  maxOutput?: number;
  manualWorking?: boolean;
};
export type RequestCost = {
  system: number;
  tools: number;
  conversation: number;
  uncertainMedia: boolean;
};
export type ContextBudget = {
  ceiling: number;
  source: "deployed" | "manual" | "reported" | "unknown-policy";
  output: number;
  reserve: number;
  margin: number;
  working: number;
  cost: RequestCost;
  fits: boolean;
  reason?: string;
  provenance: "estimated";
};

export class ContextBudgetError extends Error {
  readonly contextPreflight = true;
  readonly retryable = false;
  constructor(
    readonly code: string,
    message: string,
    readonly budget?: ContextBudget,
  ) {
    super(message);
    this.name = "ContextBudgetError";
  }
}

const invalid = (message: string): never => {
  throw new ContextBudgetError("invalid-context-settings", message);
};

export function resolveContextBudget(
  limits: BudgetLimits,
  cost: RequestCost = {
    system: 0,
    tools: 0,
    conversation: 0,
    uncertainMedia: false,
  },
  requestedOutput?: number,
  marginOverride?: number,
): ContextBudget {
  for (const [field, value] of Object.entries(limits)) {
    if (typeof value === "boolean" || value === undefined) continue;
    if (
      !Number.isSafeInteger(value) ||
      (field === "outputReserve" ? value < 0 : value <= 0)
    )
      invalid(`${field} must be a positive whole token count.`);
  }
  for (const value of [
    cost.system,
    cost.tools,
    cost.conversation,
    marginOverride ?? 0,
  ])
    if (!Number.isSafeInteger(value) || value < 0)
      invalid("Invalid request token estimate.");
  if (
    requestedOutput !== undefined &&
    (!Number.isSafeInteger(requestedOutput) || requestedOutput <= 0)
  )
    invalid("Output limit must be a positive whole token count.");
  const stronger = limits.deployed ?? limits.reported;
  if (limits.asserted && stronger && limits.asserted > stronger)
    invalid(
      "Configured context pin exceeds the known server/model limit. Correct it in model settings.",
    );
  const source = limits.deployed
    ? "deployed"
    : limits.asserted
      ? "manual"
      : limits.reported
        ? "reported"
        : "unknown-policy";
  let ceiling =
    limits.deployed ??
    limits.asserted ??
    limits.reported ??
    UNKNOWN_CONTEXT_POLICY;
  // Model maxima are bounds, never proof of a deployment allocation.
  for (const bound of [limits.theoretical, limits.advertised, limits.reported])
    if (bound) ceiling = Math.min(ceiling, bound);
  if (limits.asserted && limits.asserted > ceiling)
    invalid("Configured context pin exceeds a known model bound.");
  if (
    limits.manualWorking &&
    limits.workingTarget &&
    limits.workingTarget > ceiling
  )
    invalid("Working context pin exceeds the usable context ceiling.");
  for (const value of [limits.maxOutput, limits.outputReserve])
    if (
      value &&
      (value >= ceiling || (limits.outputCap && value > limits.outputCap))
    )
      invalid(
        "Output pin/reserve exceeds the usable context or API output limit.",
      );
  const fallback = Math.min(2048, Math.max(256, Math.floor(ceiling * 0.15)));
  const output = Math.min(
    requestedOutput ?? limits.maxOutput ?? (limits.outputReserve || fallback),
    limits.maxOutput ?? Infinity,
    limits.outputCap ?? Infinity,
  );
  const reserve = Math.max(output, limits.outputReserve ?? 0);
  const input = cost.system + cost.tools + cost.conversation;
  const margin = marginOverride ?? Math.max(128, Math.ceil(input * 0.1));
  const available =
    Math.min(ceiling - reserve, limits.inputCap ?? Infinity) -
    cost.system -
    cost.tools -
    margin;
  const working = Math.max(
    0,
    Math.min(limits.workingTarget ?? Infinity, available),
  );
  const fits =
    !cost.uncertainMedia && available >= 0 && cost.conversation <= working;
  const unknown =
    source === "unknown-policy"
      ? " The server limit is unverified; Clack uses a 4096-token planning policy, not a server capacity claim."
      : "";
  const reason = cost.uncertainMedia
    ? "Image or binary input has unknown token cost. Request blocked before inference; use a text representation or a supported counting path. No attachment was removed."
    : !fits
      ? `Request exceeds its context budget (estimated input ${input}, output reserve ${reserve}, margin ${margin}, ceiling ${ceiling}). ${cost.system + cost.tools + margin + reserve >= ceiling ? "System instructions and tool schemas leave insufficient conversation space." : "Conversation/task/attachment content exceeds the working budget."}${unknown}`
      : undefined;
  return {
    ceiling,
    source,
    output,
    reserve,
    margin,
    working,
    cost,
    fits,
    reason,
    provenance: "estimated",
  };
}

// Deterministic conservative estimate, not a matching tokenizer: ASCII word runs
// use 3 chars/token, punctuation 1/token, non-ASCII up to one token per UTF-8 byte.
export function estimateTextTokens(text: string): number {
  let tokens = 0;
  const pattern = /[A-Za-z0-9]+|[ \t\r\n]+|[^A-Za-z0-9 \t\r\n]/gu;
  for (const match of text.matchAll(pattern)) {
    const run = match[0];
    if (/^[A-Za-z0-9]/.test(run)) tokens += Math.ceil(run.length / 3);
    else if (/^[ \t\r\n]/.test(run)) tokens += Math.ceil(run.length / 4);
    else {
      const point = run.codePointAt(0) ?? 0;
      tokens += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    }
  }
  return tokens;
}

export function measureRequest(body: Record<string, unknown>): RequestCost {
  const cost: RequestCost = {
    system: 0,
    tools: 0,
    conversation: 0,
    uncertainMedia: false,
  };
  const measure = (value: unknown): number => {
    if (value == null) return 0;
    if (typeof value === "string") return estimateTextTokens(value);
    if (Array.isArray(value))
      return 2 + value.reduce((sum, item) => sum + measure(item) + 1, 0);
    if (typeof value !== "object") return estimateTextTokens(String(value));
    const record = value as Record<string, unknown>;
    // Recognize adapter media envelopes, never tokenize their base64 or URLs.
    if (
      ([
        "image",
        "image_url",
        "input_image",
        "file",
        "input_file",
        "audio",
        "input_audio",
        "document",
      ].includes(String(record.type)) &&
        [
          "source",
          "data",
          "image",
          "image_url",
          "file",
          "file_data",
          "file_url",
          "file_id",
          "audio",
          "input_audio",
        ].some((field) => field in record)) ||
      "inlineData" in record ||
      "fileData" in record
    ) {
      cost.uncertainMedia = true;
      return 0;
    }
    return (
      2 +
      Object.entries(record).reduce(
        (sum, [key, item]) => sum + estimateTextTokens(key) + measure(item) + 2,
        0,
      )
    );
  };
  for (const [key, value] of Object.entries(body)) {
    if (["system", "instructions", "systemInstruction"].includes(key))
      cost.system += measure(value);
    else if (
      [
        "tools",
        "tool_choice",
        "toolConfig",
        "response_format",
        "text",
        "functions",
        "function_call",
      ].includes(key)
    )
      cost.tools += measure(value);
    else if (key === "generationConfig" && value && typeof value === "object") {
      const config = value as Record<string, unknown>;
      cost.tools +=
        measure(config.responseSchema) + measure(config.responseJsonSchema);
    } else if (["messages", "input", "contents", "prompt"].includes(key)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (
            item &&
            typeof item === "object" &&
            ["system", "developer"].includes(String(item.role))
          )
            cost.system += measure(item);
          else cost.conversation += measure(item);
        }
      } else cost.conversation += measure(value);
    }
  }
  return cost;
}

export function assertRequestBudget(
  limits: BudgetLimits,
  body: Record<string, unknown>,
): ContextBudget {
  const generation = body.generationConfig as
    | { maxOutputTokens?: number }
    | undefined;
  const values = [
    body.max_tokens,
    body.max_completion_tokens,
    body.max_output_tokens,
    generation?.maxOutputTokens,
  ].filter((v) => v !== undefined);
  if (values.length !== 1 || typeof values[0] !== "number")
    invalid("The adapter must serialize exactly one output token limit.");
  return assertMeasuredRequestBudget(
    limits,
    measureRequest(body),
    values[0] as number,
  );
}

export function assertMeasuredRequestBudget(
  limits: BudgetLimits,
  cost: RequestCost,
  output: number,
): ContextBudget {
  const budget = resolveContextBudget(limits, cost, output);
  // Adapters may add reasoning tokens; account for the final wire value, never clamp it only on paper.
  if (budget.output !== output)
    invalid("Serialized output limit exceeds the configured/API cap.");
  if (!budget.fits)
    throw new ContextBudgetError(
      budget.cost.uncertainMedia ? "context-media-unknown" : "context-overflow",
      budget.reason ?? "Request exceeds context budget.",
      budget,
    );
  return budget;
}
