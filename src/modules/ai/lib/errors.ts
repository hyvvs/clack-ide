import {
  APICallError,
  InvalidResponseDataError,
  NoSuchModelError,
  RetryError,
} from "ai";

export type AiErrorKind =
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "quota"
  | "model_not_found"
  | "provider_unavailable"
  | "network"
  | "timeout"
  | "bad_request"
  | "tool"
  | "cancelled"
  | "interrupted"
  | "internal"
  | "unknown";

export type AiErrorDisposition = "recoverable" | "retrying" | "terminal";

export type NormalizedAiError = {
  kind: AiErrorKind;
  disposition: AiErrorDisposition;
  title: string;
  message: string;
  provider?: string;
  model?: string;
  endpoint?: string;
  statusCode?: number;
  errorCode?: string;
  retryAfter?: string;
  requestId?: string;
  toolName?: string;
  retryable: boolean;
  details?: string;
  cause?: string;
};

export type AiErrorContext = {
  provider?: string;
  model?: string;
  endpoint?: string;
  toolName?: string;
  kind?: AiErrorKind;
  disposition?: AiErrorDisposition;
};

type UnknownRecord = Record<string, unknown>;

type ErrorNode = {
  value: unknown;
  record: UnknownRecord | null;
  depth: number;
  path: string;
};

type ProviderPayload = {
  message?: string;
  code?: string;
  requestId?: string;
  retryAfter?: string;
  statusCode?: number;
};

const MAX_MESSAGE_LENGTH = 1_200;
const MAX_DETAIL_LENGTH = 4_000;
const MAX_ERROR_CHAIN_DEPTH = 6;
const MAX_ERROR_CHAIN_NODES = 20;
const MAX_PROVIDER_CANDIDATES = 48;

const SECRET_FIELD =
  "authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|password";

export function sanitizeAiErrorText(
  value: unknown,
  maxLength = MAX_DETAIL_LENGTH,
): string {
  if (typeof value !== "string") return "";
  let safe = value.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    "",
  );
  safe = safe.replace(
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=:-]+/gi,
    "$1 [REDACTED]",
  );
  safe = safe.replace(
    /\b(Set-Cookie|Cookie)\s*:\s*[^\r\n]*/gi,
    "$1: [REDACTED]",
  );
  safe = safe.replace(
    new RegExp(
      `(["']?(?:${SECRET_FIELD})["']?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;}]*)`,
      "gi",
    ),
    "$1[REDACTED]",
  );
  safe = safe.replace(
    new RegExp(`([?&](?:${SECRET_FIELD})=)[^&#\\s]+`, "gi"),
    "$1[REDACTED]",
  );
  safe = safe.replace(
    /\b(?:sk-(?:ant-|or-)?|xai-|gsk_|csk-)[A-Za-z0-9._-]{6,}\b/g,
    "[REDACTED]",
  );
  safe = safe.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    "[REDACTED]",
  );
  safe = safe.trim();
  return safe.length > maxLength
    ? `${safe.slice(0, Math.max(0, maxLength - 3))}...`
    : safe;
}

export function sanitizeAiEndpoint(value: unknown): string | undefined {
  const raw = sanitizeAiErrorText(value, 1_000);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.split(/[?#]/, 1)[0] || undefined;
  }
}

export function normalizeAiError(
  error: unknown,
  context: AiErrorContext = {},
): NormalizedAiError {
  const chain = collectErrorChain(error);
  const payload = extractProviderPayload(chain);
  const headers = collectHeaders(chain);
  const statusCode = firstStatusCode(chain) ?? payload.statusCode;
  const rawMessage =
    payload.message || selectBestChainMessage(chain) || stringValue(error);
  const safeMessage = oneLine(
    sanitizeAiErrorText(rawMessage, MAX_MESSAGE_LENGTH),
  );
  const provider = optionalSafe(context.provider, 160);
  const model = optionalSafe(context.model, 300);
  const endpoint = sanitizeAiEndpoint(
    context.endpoint ?? firstChainValue(chain, ["url"], ["response", "url"]),
  );
  const toolName = optionalSafe(
    context.toolName ?? firstChainValue(chain, ["toolName"], ["tool"]),
    160,
  );
  const errorCode = optionalSafe(
    payload.code ?? firstChainValue(chain, ["errorCode"], ["code"]),
    160,
  );
  const retryAfter = normalizeRetryAfter(
    header(headers, "retry-after") ??
      payload.retryAfter ??
      firstChainValue(chain, ["retryAfter"], ["retry_after"]),
  );
  const requestId = optionalSafe(
    payload.requestId ??
      header(headers, "x-request-id") ??
      header(headers, "request-id") ??
      header(headers, "x-goog-request-id") ??
      header(headers, "x-correlation-id") ??
      header(headers, "x-generation-id") ??
      firstChainValue(chain, ["requestId"], ["request_id"]),
    300,
  );
  const cause = safeChainCause(chain, safeMessage);
  const kind = classifyError({
    requested: context.kind,
    statusCode,
    name: chainNames(chain),
    message: safeMessage,
    code: errorCode,
    toolName,
  });
  const retryable =
    firstRetryableValue(chain) ?? isRetryableKind(kind, statusCode);
  const disposition =
    context.disposition ?? (kind === "tool" ? "recoverable" : "terminal");
  const title = titleForKind(kind, toolName);
  const message = messageForError({
    kind,
    provider,
    model,
    endpoint,
    statusCode,
    retryAfter,
    toolName,
    providerMessage: safeMessage,
  });

  return compactUndefined({
    kind,
    disposition,
    title,
    message: sanitizeAiErrorText(message, MAX_MESSAGE_LENGTH),
    provider,
    model,
    endpoint,
    statusCode,
    errorCode,
    retryAfter,
    requestId,
    toolName,
    retryable,
    details: safeMessage || undefined,
    cause,
  });
}

export function shouldPresentAiError(
  error: NormalizedAiError | null | undefined,
  runState?: "running" | "completed" | "failed" | "cancelled" | "interrupted",
): error is NormalizedAiError {
  if (!error) return false;
  if (runState !== "failed") return false;
  return (
    error.disposition !== "recoverable" &&
    error.disposition !== "retrying" &&
    error.kind !== "cancelled" &&
    error.kind !== "interrupted"
  );
}

export function normalizeAiStreamPartError(
  error: unknown,
  context: AiErrorContext = {},
): { error: NormalizedAiError; text: string } {
  const normalized = normalizeAiError(error, context);
  if (normalized.kind !== "tool") {
    return { error: normalized, text: normalized.message };
  }

  const recoverable = { ...normalized, disposition: "recoverable" as const };
  return {
    error: recoverable,
    text: formatRecoverableToolError(error, recoverable),
  };
}

export function formatAiErrorDetails(error: NormalizedAiError): string {
  const rows = [
    error.title,
    error.message,
    `Kind: ${error.kind}`,
    `Disposition: ${error.disposition}`,
    error.provider ? `Provider: ${error.provider}` : null,
    error.model ? `Model: ${error.model}` : null,
    error.endpoint ? `Endpoint: ${error.endpoint}` : null,
    error.statusCode ? `HTTP: ${error.statusCode}` : null,
    error.errorCode ? `Code: ${error.errorCode}` : null,
    error.retryAfter ? `Retry after: ${error.retryAfter}` : null,
    error.requestId ? `Request ID: ${error.requestId}` : null,
    error.toolName ? `Tool: ${error.toolName}` : null,
    `Retryable: ${error.retryable ? "yes" : "no"}`,
    error.details && error.details !== error.message
      ? `Provider detail: ${error.details}`
      : null,
    error.cause ? `Cause: ${error.cause}` : null,
  ];
  return sanitizeAiErrorText(rows.filter(Boolean).join("\n"));
}

export function safeAiErrorLog(error: NormalizedAiError): UnknownRecord {
  return {
    kind: error.kind,
    disposition: error.disposition,
    provider: error.provider,
    model: error.model,
    endpoint: error.endpoint,
    statusCode: error.statusCode,
    errorCode: error.errorCode,
    retryAfter: error.retryAfter,
    requestId: error.requestId,
    toolName: error.toolName,
    retryable: error.retryable,
    message: error.message,
    details: error.details,
    cause: error.cause,
  };
}

function formatRecoverableToolError(
  source: unknown,
  error: NormalizedAiError,
): string {
  const validationFailure = /invalid input|type validation|schema/i.test(
    `${error.message} ${error.details ?? ""}`,
  );
  if (validationFailure) {
    const issue = firstValidationIssue(collectErrorChain(source));
    const technical = issue
      ? `${error.toolName ? `Invalid input for tool ${error.toolName}` : "Invalid tool input"}: ${issue}`
      : `${error.toolName ? `Invalid input for tool ${error.toolName}` : "Invalid tool input"}: Type validation failed.`;
    return sanitizeAiErrorText(
      `Tool input did not match the expected schema.\n${technical}`,
      800,
    );
  }

  return sanitizeAiErrorText(error.details || error.message, 800);
}

function firstValidationIssue(chain: readonly ErrorNode[]): string | undefined {
  for (const node of chain) {
    const record = node.record;
    if (!record) continue;
    const candidates = [record.issues, record.errors];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;
      for (const value of candidate) {
        const issue = asRecord(value);
        if (!issue) continue;
        const message = optionalSafe(issue.message, 360);
        if (!message) continue;
        const path = Array.isArray(issue.path)
          ? issue.path
              .filter(
                (part): part is string | number =>
                  typeof part === "string" || typeof part === "number",
              )
              .join(".")
          : "";
        return path ? `${path}: ${message}` : message;
      }
    }
  }
  return undefined;
}

export function describeAiErrorShape(error: unknown): UnknownRecord {
  const chain = collectErrorChain(error);
  return {
    rootType: error === null ? "null" : typeof error,
    rootMessage: optionalSafe(
      asRecord(error)?.message ?? (typeof error === "string" ? error : ""),
      MAX_MESSAGE_LENGTH,
    ),
    chain: chain.map((node) => {
      const record = node.record;
      if (!record) {
        return {
          path: node.path,
          type: node.value === null ? "null" : typeof node.value,
          value:
            typeof node.value === "string"
              ? optionalSafe(node.value, MAX_MESSAGE_LENGTH)
              : undefined,
        };
      }
      return compactUndefined({
        path: node.path,
        constructor: constructorName(node.value),
        name: optionalSafe(record.name, 160),
        message: optionalSafe(record.message, MAX_MESSAGE_LENGTH),
        ownKeys: safeOwnKeys(node.value),
        statusCode: numberValue(record.statusCode ?? record.status),
        code: optionalSafe(record.code ?? record.errorCode, 160),
        hasCause: record.cause != null,
        hasResponse: record.response != null,
        hasResponseBody: record.responseBody != null,
        hasData: record.data != null,
        hasError: record.error != null,
        hasHeaders: record.responseHeaders != null || record.headers != null,
      });
    }),
  };
}

function collectErrorChain(error: unknown): ErrorNode[] {
  const nodes: ErrorNode[] = [];
  const queue: Array<{ value: unknown; depth: number; path: string }> = [
    { value: error, depth: 0, path: "error" },
  ];
  const seen = new Set<unknown>();

  while (queue.length > 0 && nodes.length < MAX_ERROR_CHAIN_NODES) {
    const next = queue.shift();
    if (!next || next.depth > MAX_ERROR_CHAIN_DEPTH) continue;
    if (
      (typeof next.value === "object" || typeof next.value === "function") &&
      next.value !== null
    ) {
      if (seen.has(next.value)) continue;
      seen.add(next.value);
    }

    const record = asRecord(next.value);
    nodes.push({ ...next, record });
    if (!record || next.depth === MAX_ERROR_CHAIN_DEPTH) continue;

    if (
      (RetryError.isInstance(next.value) ||
        stringValue(record.name) === "AI_RetryError") &&
      record.lastError != null
    ) {
      queue.push({
        value: record.lastError,
        depth: next.depth + 1,
        path: `${next.path}.lastError`,
      });
    }
    if (record.cause != null) {
      queue.push({
        value: record.cause,
        depth: next.depth + 1,
        path: `${next.path}.cause`,
      });
    }
    if (asRecord(record.error)) {
      queue.push({
        value: record.error,
        depth: next.depth + 1,
        path: `${next.path}.error`,
      });
    }
  }
  return nodes;
}

function extractProviderPayload(chain: ErrorNode[]): ProviderPayload {
  type Candidate = { value: unknown; score: number };
  const queue: Candidate[] = [];
  const seen = new Set<unknown>();
  let message: string | undefined;
  let messageScore = Number.NEGATIVE_INFINITY;
  let code: string | undefined;
  let codeScore = Number.NEGATIVE_INFINITY;
  let requestId: string | undefined;
  let retryAfter: string | undefined;
  let statusCode: number | undefined;

  const enqueue = (value: unknown, score: number) => {
    if (value == null || queue.length >= MAX_PROVIDER_CANDIDATES) return;
    queue.push({ value, score });
  };

  for (const node of chain) {
    const record = node.record;
    if (!record) continue;
    const base = node.depth * 4;
    enqueue(node.value, base);
    enqueue(record.data, base + 30);
    enqueue(record.responseBody, base + 40);
    enqueue(record.body, base + 35);
    enqueue(record.error, base + 25);
    const response = asRecord(record.response);
    if (response) {
      enqueue(response, base + 15);
      enqueue(response.data, base + 35);
      enqueue(response.body, base + 40);
      enqueue(response.responseBody, base + 40);
      enqueue(response.error, base + 30);
    }
  }

  for (
    let index = 0;
    index < queue.length && index < MAX_PROVIDER_CANDIDATES;
    index += 1
  ) {
    const candidate = queue[index];
    const raw = candidate.value;
    if (typeof raw === "string") {
      const parsed = parseJsonText(raw);
      if (parsed !== undefined) {
        enqueue(parsed, candidate.score + 10);
      } else {
        const safe = optionalSafe(raw, MAX_DETAIL_LENGTH);
        const score = providerMessageScore(safe, candidate.score);
        if (safe && score > messageScore) {
          message = safe;
          messageScore = score;
        }
      }
      continue;
    }

    const root = asRecord(raw);
    if (!root || seen.has(raw)) continue;
    seen.add(raw);
    const nested = asRecord(root.error) ?? root;
    const candidateMessage = optionalSafe(
      nested.message ??
        nested.detail ??
        nested.error_description ??
        root.message ??
        root.detail,
      MAX_MESSAGE_LENGTH,
    );
    const nextMessageScore = providerMessageScore(
      candidateMessage,
      candidate.score + (nested === root ? 0 : 12),
    );
    if (candidateMessage && nextMessageScore > messageScore) {
      message = candidateMessage;
      messageScore = nextMessageScore;
    }

    const candidateCode = optionalSafe(
      nested.code ?? nested.type ?? root.code ?? root.errorCode,
      160,
    );
    const nextCodeScore =
      candidate.score + (/^\d{3}$/.test(candidateCode ?? "") ? 0 : 20);
    if (candidateCode && nextCodeScore > codeScore) {
      code = candidateCode;
      codeScore = nextCodeScore;
    }

    statusCode ??= httpStatusValue(
      nested.statusCode ??
        nested.status ??
        root.statusCode ??
        root.status ??
        nested.code,
    );
    requestId ??= optionalSafe(
      nested.request_id ??
        nested.requestId ??
        root.request_id ??
        root.requestId ??
        root.id,
      300,
    );
    retryAfter ??= normalizeRetryAfter(
      nested.retry_after ??
        nested.retryAfter ??
        root.retry_after ??
        root.retryAfter,
    );

    const metadata = asRecord(nested.metadata) ?? asRecord(root.metadata);
    if (metadata) {
      requestId ??= optionalSafe(
        metadata.request_id ?? metadata.requestId ?? metadata.id,
        300,
      );
      retryAfter ??= normalizeRetryAfter(
        metadata.retry_after ?? metadata.retryAfter,
      );
      for (const key of [
        "raw",
        "body",
        "responseBody",
        "response",
        "error",
        "provider_error",
        "providerResponse",
      ]) {
        enqueue(metadata[key], candidate.score + 45);
      }
    }
    for (const key of ["data", "body", "responseBody", "details"]) {
      enqueue(root[key], candidate.score + 20);
      if (nested !== root) enqueue(nested[key], candidate.score + 25);
    }
  }

  return compactUndefined({
    message,
    code,
    requestId,
    retryAfter,
    statusCode,
  });
}

function classifyError(input: {
  requested?: AiErrorKind;
  statusCode?: number;
  name: string;
  message: string;
  code?: string;
  toolName?: string;
}): AiErrorKind {
  if (input.requested) return input.requested;
  if (input.toolName || /tool(call| input| execution)?/i.test(input.name)) {
    return "tool";
  }
  if (
    /aborterror/i.test(input.name) ||
    /\b(aborted|cancelled|canceled by (?:the )?user)\b/i.test(input.message)
  ) {
    return "cancelled";
  }
  if (
    input.statusCode === 401 ||
    /invalid api key|api key.*invalid|unauthenticated/i.test(input.message)
  ) {
    return "authentication";
  }
  if (
    input.statusCode === 403 ||
    /forbidden|permission denied|not authorized/i.test(input.message)
  ) {
    return "authorization";
  }
  if (
    input.statusCode === 402 ||
    /insufficient (?:quota|credits)|quota exceeded|credits? (?:are )?exhausted|billing/i.test(
      `${input.code ?? ""} ${input.message}`,
    )
  ) {
    return "quota";
  }
  if (
    input.statusCode === 429 ||
    /rate.?limit|too many requests/i.test(input.message)
  ) {
    return "rate_limit";
  }
  const modelEvidence =
    /AI_NoSuchModelError/i.test(input.name) ||
    /(?:model[_-]?(?:not[_-]?found|unavailable|unknown)|no[_-]?such[_-]?model|invalid[_-]?model)/i.test(
      input.code ?? "",
    ) ||
    /model.{0,60}(?:not found|does not exist|unknown|unavailable|not recognized|not supported)|unknown model|no such (?:language )?model|no model id|no (?:allowed )?providers? (?:are )?available for (?:the )?(?:selected|requested) model|no endpoints? (?:found|available).{0,60}model/i.test(
      input.message,
    );
  if (
    modelEvidence &&
    (input.statusCode === 404 ||
      input.statusCode == null ||
      input.statusCode === 400)
  ) {
    return "model_not_found";
  }
  if (
    input.statusCode === 408 ||
    /\b(?:timed? ?out|timeout|etimedout)\b/i.test(input.message)
  ) {
    return "timeout";
  }
  if (
    /\b(?:econnrefused|econnreset|enotfound|dns|tls|certificate|network|failed to fetch|could not connect|connection refused|connection reset|error sending request)\b/i.test(
      `${input.code ?? ""} ${input.message}`,
    )
  ) {
    return "network";
  }
  if (input.statusCode != null && input.statusCode >= 500) {
    return "provider_unavailable";
  }
  if (
    (input.statusCode != null && input.statusCode >= 400) ||
    /invalid url|malformed|bad request|invalid argument|no base url/i.test(
      input.message,
    )
  ) {
    return "bad_request";
  }
  if (
    /internal clack|ui.?message.?stream|message conversion|invalid stream part|invalid response data|json parse/i.test(
      `${input.name} ${input.message}`,
    )
  ) {
    return "internal";
  }
  return "unknown";
}

function messageForError(input: {
  kind: AiErrorKind;
  provider?: string;
  model?: string;
  endpoint?: string;
  statusCode?: number;
  retryAfter?: string;
  toolName?: string;
  providerMessage: string;
}): string {
  const provider = input.provider ?? "The AI provider";
  const detail = usefulDetail(input.providerMessage);
  switch (input.kind) {
    case "authentication":
      return appendDetail(
        `Authentication failed for ${provider}. Check the configured API key.`,
        detail,
      );
    case "authorization":
      return appendDetail(`${provider} rejected this request.`, detail);
    case "rate_limit":
      return appendDetail(
        `${provider} rate limit reached.${input.retryAfter ? ` Retry in ${input.retryAfter}.` : ""}`,
        detail,
      );
    case "quota":
      return appendDetail(
        `${provider} quota or credits are exhausted.`,
        detail,
      );
    case "model_not_found":
      return appendDetail(
        input.model
          ? `Model "${input.model}" is unavailable or not recognized by ${provider}.`
          : `${provider} could not find the requested model.`,
        detail,
      );
    case "provider_unavailable":
      return appendDetail(
        input.statusCode
          ? `${provider} returned ${input.statusCode}${statusText(input.statusCode) ? ` ${statusText(input.statusCode)}` : ""}.`
          : `${provider} is currently unavailable.`,
        detail,
      );
    case "network":
      return appendDetail(
        input.endpoint
          ? `Could not reach ${input.endpoint}.`
          : `Could not reach ${provider}.`,
        detail,
      );
    case "timeout":
      return appendDetail(
        input.endpoint
          ? `Request to ${input.endpoint} timed out.`
          : `Request to ${provider} timed out.`,
        detail,
      );
    case "bad_request":
      return appendDetail(`${provider} could not accept this request.`, detail);
    case "tool":
      return appendDetail(
        input.toolName ? `Tool failed: ${input.toolName}.` : "A tool failed.",
        detail,
      );
    case "cancelled":
      return "The AI run was cancelled.";
    case "interrupted":
      return "The AI run was interrupted when the previous Clack session closed.";
    case "internal":
      return appendDetail("Clack could not process the AI response.", detail);
    case "unknown":
      return appendDetail(
        "The AI run failed for an unexpected reason.",
        detail,
      );
  }
}

function titleForKind(kind: AiErrorKind, toolName?: string): string {
  switch (kind) {
    case "authentication":
      return "Authentication error";
    case "authorization":
      return "Authorization error";
    case "rate_limit":
      return "Rate limit";
    case "quota":
      return "Provider quota";
    case "model_not_found":
      return "Model unavailable";
    case "provider_unavailable":
      return "Provider error";
    case "network":
      return "Network error";
    case "timeout":
      return "Request timed out";
    case "bad_request":
      return "Request rejected";
    case "tool":
      return toolName ? `Tool failed: ${toolName}` : "Tool failed";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted";
    case "internal":
      return "Clack error";
    case "unknown":
      return "AI run failed";
  }
}

function statusText(status: number): string {
  const labels: Record<number, string> = {
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return labels[status] ?? "";
}

function isRetryableKind(kind: AiErrorKind, statusCode?: number): boolean {
  return (
    kind === "rate_limit" ||
    kind === "network" ||
    kind === "timeout" ||
    kind === "provider_unavailable" ||
    statusCode === 409
  );
}

function normalizeRetryAfter(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}s`;
  const safe = optionalSafe(value, 200);
  if (!safe) return undefined;
  return /^\d+(?:\.\d+)?$/.test(safe) ? `${safe}s` : safe;
}

function collectHeaders(chain: ErrorNode[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const node of chain) {
    const record = node.record;
    if (!record) continue;
    const response = asRecord(record.response);
    for (const candidate of [
      APICallError.isInstance(node.value)
        ? node.value.responseHeaders
        : undefined,
      record.responseHeaders,
      record.headers,
      response?.headers,
    ]) {
      for (const [key, value] of Object.entries(toHeaderRecord(candidate))) {
        headers[key] ??= value;
      }
    }
  }
  return headers;
}

function firstStatusCode(chain: ErrorNode[]): number | undefined {
  for (const node of chain) {
    if (APICallError.isInstance(node.value)) {
      const status = httpStatusValue(node.value.statusCode);
      if (status != null) return status;
    }
    const record = node.record;
    if (!record) continue;
    const response = asRecord(record.response);
    const status = httpStatusValue(
      record.statusCode ??
        record.status ??
        response?.statusCode ??
        response?.status,
    );
    if (status != null) return status;
  }
  return undefined;
}

function firstRetryableValue(chain: ErrorNode[]): boolean | undefined {
  for (const node of chain) {
    if (APICallError.isInstance(node.value)) return node.value.isRetryable;
    const retryable = booleanValue(node.record?.isRetryable);
    if (retryable != null) return retryable;
  }
  return undefined;
}

function firstChainValue(chain: ErrorNode[], ...paths: string[][]): unknown {
  for (const node of chain) {
    for (const path of paths) {
      let current: unknown = node.record;
      for (const key of path) {
        current = asRecord(current)?.[key];
      }
      if (current != null && current !== "") return current;
    }
  }
  return undefined;
}

function selectBestChainMessage(chain: ErrorNode[]): string {
  let selected = "";
  let selectedScore = Number.NEGATIVE_INFINITY;
  for (const node of chain) {
    const candidate = optionalSafe(
      node.record?.message ??
        (typeof node.value === "string" ? node.value : ""),
      MAX_MESSAGE_LENGTH,
    );
    const score = providerMessageScore(candidate, node.depth * 4);
    if (candidate && score > selectedScore) {
      selected = candidate;
      selectedScore = score;
    }
  }
  return selected;
}

function safeChainCause(
  chain: ErrorNode[],
  selectedMessage: string,
): string | undefined {
  for (const node of chain.slice(1)) {
    const candidate = optionalSafe(
      node.record?.message ??
        (typeof node.value === "string" ? node.value : ""),
      MAX_MESSAGE_LENGTH,
    );
    if (candidate && candidate !== selectedMessage) return candidate;
  }
  return undefined;
}

function chainNames(chain: ErrorNode[]): string {
  const names = new Set<string>();
  for (const node of chain) {
    if (NoSuchModelError.isInstance(node.value))
      names.add("AI_NoSuchModelError");
    if (InvalidResponseDataError.isInstance(node.value)) {
      names.add("AI_InvalidResponseDataError");
    }
    if (RetryError.isInstance(node.value)) names.add("AI_RetryError");
    if (APICallError.isInstance(node.value)) names.add("AI_APICallError");
    const name = stringValue(node.record?.name);
    if (name) names.add(name);
  }
  return [...names].join(" ");
}

function providerMessageScore(
  message: string | undefined,
  base: number,
): number {
  if (!message) return Number.NEGATIVE_INFINITY;
  const generic =
    /^(?:provider returned (?:an? )?error|request failed(?: with status \d{3})?|bad request|not found|internal server error|service unavailable|an error occurred|something went wrong)\.?$/i.test(
      message,
    );
  return base + (generic ? 1 : 100) + Math.min(message.length, 300) / 1_000;
}

function parseJsonText(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (
    !trimmed ||
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function httpStatusValue(value: unknown): number | undefined {
  const status = numberValue(value);
  return status != null && status >= 100 && status <= 599 ? status : undefined;
}

function constructorName(value: unknown): string | undefined {
  const record = asRecord(value);
  const constructorRecord = asRecord(record?.constructor);
  return optionalSafe(constructorRecord?.name, 160);
}

function safeOwnKeys(value: unknown): string[] | undefined {
  if (
    value == null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  try {
    return Object.getOwnPropertyNames(value)
      .filter((key) => !new RegExp(`^(?:${SECRET_FIELD})$`, "i").test(key))
      .slice(0, 40);
  } catch {
    return undefined;
  }
}

function usefulDetail(value: string): string {
  if (
    !value ||
    /^(an error occurred\.?|something went wrong\.?)$/i.test(value)
  ) {
    return "";
  }
  return value;
}

function appendDetail(base: string, detail: string): string {
  if (!detail) return base;
  const normalizedBase = base.toLowerCase();
  const normalizedDetail = detail.toLowerCase();
  if (
    normalizedBase.includes(normalizedDetail) ||
    normalizedDetail.includes(normalizedBase.replace(/[.]$/, ""))
  ) {
    return base;
  }
  return `${base} ${detail}`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): UnknownRecord | null {
  return value != null && typeof value === "object"
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalSafe(value: unknown, maxLength: number): string | undefined {
  const safe = oneLine(sanitizeAiErrorText(String(value ?? ""), maxLength));
  return safe || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toHeaderRecord(value: unknown): Record<string, string> {
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [key.toLowerCase(), entry]),
    );
  }
  if (value instanceof Map) {
    const headers: Record<string, string> = {};
    for (const [key, entry] of value.entries()) {
      if (typeof key === "string" && typeof entry === "string") {
        headers[key.toLowerCase()] = entry;
      }
    }
    return headers;
  }
  if (Array.isArray(value)) {
    const headers: Record<string, string> = {};
    for (const entry of value) {
      if (
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string"
      ) {
        headers[entry[0].toLowerCase()] = entry[1];
      }
    }
    return headers;
  }
  const record = asRecord(value);
  if (!record) return {};
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") headers[key.toLowerCase()] = entry;
  }
  return headers;
}

function header(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  return headers[name.toLowerCase()];
}

function compactUndefined<T extends UnknownRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
