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
  reasoningBudget?: number;
  manualWorking?: boolean;
};
export type RequestCost = {
  system: number;
  tools: number;
  conversation: number;
  uncertainMedia: boolean;
  breakdown?: Partial<Record<ContextSection, number>>;
  schemas?: { available?: number; exposed: number; bytes: number };
};
export type SchemaKind = "builtin" | "custom" | "mcp";
export type ContextSection =
  | "core"
  | "agent"
  | "project"
  | "customInstructions"
  | "history"
  | "memory"
  | "retrieval"
  | "attachments"
  | "environment"
  | SchemaKind
  | "other";
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
  reasoningReserve?: number;
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
  const fallback =
    Math.min(2048, Math.max(256, Math.floor(ceiling * 0.15))) +
    (limits.reasoningBudget ?? 0);
  const output = Math.min(
    requestedOutput ?? limits.maxOutput ?? (limits.outputReserve || fallback),
    limits.maxOutput ?? Infinity,
    limits.outputCap ?? Infinity,
  );
  const reserve = Math.max(output, limits.outputReserve ?? 0);
  if (limits.reasoningBudget && output <= limits.reasoningBudget)
    invalid(
      "The total output limit must leave room for an answer after the requested thinking budget. Lower effort or increase the output limit.",
    );
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
    reasoningReserve: limits.reasoningBudget,
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

export function measureRequest(
  body: Record<string, unknown>,
  schemaKinds: Record<string, SchemaKind> = {},
  availableSchemas?: number,
): RequestCost {
  const breakdown: NonNullable<RequestCost["breakdown"]> = {};
  const cost: RequestCost = {
    system: 0,
    tools: 0,
    conversation: 0,
    uncertainMedia: false,
    breakdown,
  };
  const add = (section: ContextSection, tokens: number) => {
    if (tokens) breakdown[section] = (breakdown[section] ?? 0) + tokens;
    return tokens;
  };
  const textCost = (text: string, section: ContextSection): number => {
    const tokens = estimateTextTokens(text);
    if (section === "core") {
      const markers = [
        ...text.matchAll(
          /\n\n## (PROJECT MEMORY|ACTIVE AGENT[^\n]*|USER CUSTOM INSTRUCTIONS[^\n]*)/g,
        ),
      ].slice(0, 16);
      let current: ContextSection = "core";
      let previous = 0;
      for (const marker of markers) {
        const prefix = estimateTextTokens(text.slice(0, marker.index));
        add(current, prefix - previous);
        previous = prefix;
        current =
          marker[1] === "PROJECT MEMORY"
            ? "project"
            : marker[1].startsWith("ACTIVE AGENT")
              ? "agent"
              : "customInstructions";
      }
      add(current, tokens - previous);
    } else if (
      section === "history" &&
      text.startsWith("<env>\n") &&
      text.includes("</env>")
    ) {
      const end = text.indexOf("</env>") + 6;
      const environment = estimateTextTokens(text.slice(0, end));
      add("environment", environment);
      textCost(text.slice(end), "history");
    } else {
      const content = text.trimStart();
      const category =
        section !== "history"
          ? section
          : content.startsWith("Derived conversation evidence,")
            ? "memory"
            : /^(Retrieved original conversation evidence\.|Authorized project\/task evidence \()/u.test(
                  content,
                )
              ? "retrieval"
              : /^----- CLACK (ATTACHMENT|SELECTION) -----/u.test(content)
                ? "attachments"
                : "history";
      add(category, tokens);
    }
    return tokens;
  };
  const schemaNames = new Set<string>();
  let schemaBytes = 0;
  const measure = (value: unknown, section: ContextSection): number => {
    if (value == null) return 0;
    if (typeof value === "string") return textCost(value, section);
    if (Array.isArray(value))
      return (
        add("other", 2 + value.length) +
        value.reduce((sum, item) => sum + measure(item, section), 0)
      );
    if (typeof value !== "object")
      return add(section, estimateTextTokens(String(value)));
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
    if (["builtin", "custom", "mcp"].includes(section)) {
      const fn =
        record.function && typeof record.function === "object"
          ? (record.function as Record<string, unknown>)
          : record;
      if (
        typeof fn.name === "string" &&
        ("parameters" in fn || "input_schema" in fn)
      ) {
        schemaNames.add(fn.name);
        section =
          schemaKinds[fn.name] ??
          (fn.name.startsWith("custom_") ? "custom" : "builtin");
      }
    }
    return (
      add(section, 2) +
      Object.entries(record).reduce(
        (sum, [key, item]) =>
          sum +
          add(section, estimateTextTokens(key) + 2) +
          measure(item, section),
        0,
      )
    );
  };
  for (const [key, value] of Object.entries(body)) {
    if (["system", "instructions", "systemInstruction"].includes(key))
      cost.system += measure(value, "core");
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
    ) {
      const isSchemas = key === "tools" || key === "functions";
      if (isSchemas && value !== undefined)
        schemaBytes += new TextEncoder().encode(JSON.stringify(value)).length;
      cost.tools += measure(value, isSchemas ? "builtin" : "other");
    } else if (
      key === "generationConfig" &&
      value &&
      typeof value === "object"
    ) {
      const config = value as Record<string, unknown>;
      cost.tools +=
        measure(config.responseSchema, "other") +
        measure(config.responseJsonSchema, "other");
    } else if (["messages", "input", "contents", "prompt"].includes(key)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (
            item &&
            typeof item === "object" &&
            ["system", "developer"].includes(String(item.role))
          )
            cost.system += measure(item, "core");
          else cost.conversation += measure(item, "history");
        }
      } else cost.conversation += measure(value, "history");
    }
  }
  cost.schemas = {
    available: availableSchemas,
    exposed: schemaNames.size,
    bytes: schemaBytes,
  };
  return cost;
}

export function assertRequestBudget(
  limits: BudgetLimits,
  body: Record<string, unknown>,
  schemaKinds?: Record<string, SchemaKind>,
  availableSchemas?: number,
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
    measureRequest(body, schemaKinds, availableSchemas),
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

export function contextBudgetPresentation(budget: ContextBudget) {
  const { cost } = budget;
  const unknown = budget.source === "unknown-policy";
  const message = unknown
    ? "Verify or configure this model's context capacity. Clack stopped before sending a request that may be too large."
    : cost.tools > Math.max(cost.system, cost.conversation)
      ? "Disable unnecessary tools or choose a model with a larger context window."
      : cost.conversation > cost.system + cost.tools
        ? "Optimize the conversation or choose a model with a larger context window."
        : "Choose a model with a larger context window for the required instructions and project context.";
  const labels: Record<ContextSection, string> = {
    core: "Core system instructions",
    agent: "Agent instructions",
    project: "Workspace/project instructions",
    customInstructions: "User custom instructions",
    history: "Conversation history and tool state",
    memory: "Derived conversation memory",
    retrieval: "Retrieved conversation/project/task evidence",
    attachments: "Text attachments/selections",
    environment: "Environment metadata",
    builtin: "Built-in tool schemas",
    custom: "Custom tool schemas",
    mcp: "MCP tool schemas",
    other: "Other required request structure/options",
  };
  const provenance = {
    deployed: "Verified deployed/server evidence",
    reported: "Installed provider/model metadata",
    manual: "Explicit configured context pin",
    "unknown-policy":
      "Unverified capacity; conservative planning policy, not a server capacity claim",
  };
  const details = [
    `Input estimate: ${cost.system + cost.tools + cost.conversation}`,
    `Output reserve: ${budget.reserve}`,
    `Reasoning reserve (included in output): ${budget.reasoningReserve ?? 0}`,
    `Safety margin: ${budget.margin}`,
    `Effective ceiling: ${budget.ceiling}`,
    `Ceiling provenance: ${provenance[budget.source]}`,
    `System total: ${cost.system}`,
    `Schema/options total: ${cost.tools}`,
    `Conversation total: ${cost.conversation}`,
    ...(cost.schemas
      ? [
          `Schemas available: ${cost.schemas.available ?? "not captured"}`,
          `Schemas exposed on wire: ${cost.schemas.exposed}`,
          `Schema bytes on wire: ${cost.schemas.bytes}`,
        ]
      : []),
    "Context breakdown (estimated tokens; section labels are diagnostic, not provenance):",
    ...Object.entries(labels).map(
      ([key, label]) =>
        `${label}: ${cost.breakdown ? (cost.breakdown[key as ContextSection] ?? 0) : "not attributed"}`,
    ),
  ].join("\n");
  return {
    title: unknown
      ? "Clack couldn't verify this model's context capacity."
      : "This model can't fit the required context.",
    message,
    details,
  };
}
