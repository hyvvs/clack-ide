import type { UIMessage, UIMessageChunk } from "ai";
import { sanitizeAiErrorText } from "@/modules/ai/lib/errors";
import { checkReadable } from "@/modules/ai/lib/security";
import type { SessionRun } from "@/modules/ai/lib/sessions";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";

export const ACTIVITY_ENABLED = true;
import { MAX_ACTIVITY_RECEIPTS, MAX_ACTIVITY_BYTES, readActivity, type ActivityOwner, type ActivityReceipt, type ActivityRecord } from "@/modules/ai/lib/activityRecord";
export { MAX_ACTIVITY_RECEIPTS, MAX_ACTIVITY_BYTES, activityOwnerSchema, activitySchema, readActivity, type ActivityOwner, type ActivityReceipt, type ActivityRecord } from "@/modules/ai/lib/activityRecord";
export type ActivityEvent = {
  id: string;
  kind: "reasoning" | "summary" | "progress" | "runtime";
  label: string;
  detail?: string;
  at?: number;
  owner?: ActivityOwner;
  messageId?: string;
  toolCallId?: string;
  taskId?: string;
  source?: string;
  order?: number;
};

export function activityText(value: unknown, max = 4000): string {
  if (typeof value !== "string") return "";
  // Never surface encrypted blocks, private keys or URL credentials in activity.
  return sanitizeAiErrorText(
    value
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
        "[REDACTED PRIVATE KEY]",
      )
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
      .replace(
        /\b(?:token|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
        "secret=[REDACTED]",
      ),
    max,
  );
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function reasoningFormat(
  provider?: string,
): "summary" | "content" | "unspecified" {
  // These are the APIs selected in agent.ts, not guesses about a model name.
  if (provider === "openai" || provider === "google") return "summary";
  if (
    provider === "xai" ||
    provider === "groq" ||
    provider === "cerebras" ||
    provider === "deepseek"
  )
    return "content";
  // Anthropic thinking and arbitrary compatible servers do not disambiguate
  // full versus summarized text in the installed adapter's returned blocks.
  return "unspecified";
}

export function reasoningLabel(
  part: unknown,
  format?: ActivityReceipt["format"],
): string | null {
  const value = object(part);
  if (
    typeof value?.text !== "string" ||
    !value.text.length ||
    object(object(value.providerMetadata)?.anthropic)?.redactedData !==
      undefined
  )
    return null;
  return format === "summary"
    ? "Provider reasoning summary"
    : format === "content"
      ? "Provider reasoning content"
      : "Provider reasoning (format unspecified)";
}

export function createActivityRecorder(
  owner: ActivityOwner,
  previous?: ActivityRecord,
  originalParts: UIMessage["parts"] = [],
  now = Date.now,
) {
  const sameConversation =
    previous?.owner.sessionId === owner.sessionId &&
    previous.owner.workspaceId === owner.workspaceId;
  const record: ActivityRecord = {
    version: 1,
    owner: sameConversation ? previous.owner : owner,
    receipts: sameConversation ? [...previous.receipts] : [],
    omitted: sameConversation ? previous.omitted : 0,
  };
  let bytes = new TextEncoder().encode(JSON.stringify(record)).length;
  const seen = new Set(record.receipts.map((r) => r.id));
  const partIndices = new Map<string, number>();
  const toolIndices = new Map<string, number>();
  originalParts.forEach((part, index) => {
    if ("toolCallId" in part) toolIndices.set(part.toolCallId, index);
  });
  let nextPart = originalParts.length;
  const batch = crypto.randomUUID();
  let step = 0;
  let lastOmittedId: string | undefined;
  function add(receipt: Omit<ActivityReceipt, "at">) {
    if (seen.has(receipt.id) || receipt.id === lastOmittedId) return false;
    const next: ActivityReceipt = {
      ...receipt,
      label: activityText(receipt.label, 300),
      at: now(),
      ...(record.owner.runId !== owner.runId ? { owner } : {}),
    };
    const size = new TextEncoder().encode(JSON.stringify(next)).length + 1;
    if (
      record.receipts.length >= MAX_ACTIVITY_RECEIPTS ||
      bytes + size > MAX_ACTIVITY_BYTES - 32
    ) {
      lastOmittedId = receipt.id;
      record.omitted++;
      return true;
    }
    seen.add(receipt.id);
    record.receipts.push(next);
    bytes += size;
    return true;
  }
  return {
    add,
    snapshot: (): ActivityRecord => ({
      ...record,
      receipts: [...record.receipts],
    }),
    observe(chunk: UIMessageChunk): boolean {
      if (chunk.type === "start-step") {
        nextPart++;
        step++;
        return false;
      }
      if (
        chunk.type === "file" ||
        chunk.type === "source-url" ||
        chunk.type === "source-document"
      ) {
        const part = nextPart++;
        return add({
          id: `${batch}:artifact:${part}`,
          kind: "part",
          label: chunk.type,
          part,
        });
      }
      if (chunk.type === "text-start" || chunk.type === "reasoning-start") {
        const key = `${batch}:${step}:${chunk.type}:${chunk.id}`;
        if (partIndices.has(key)) return false;
        const part = nextPart++;
        partIndices.set(key, part);
        return add({
          id: key,
          kind: "part",
          label: chunk.type,
          part,
          ...(chunk.type === "reasoning-start"
            ? { format: reasoningFormat(owner.providerId) }
            : {}),
        });
      }
      if ("toolCallId" in chunk && chunk.type.startsWith("tool-")) {
        let part = toolIndices.get(chunk.toolCallId);
        if (part === undefined) {
          part = nextPart++;
          toolIndices.set(chunk.toolCallId, part);
        }
        if (chunk.type === "tool-input-delta") return false;
        return add({
          id: `${batch}:${chunk.type}:${chunk.toolCallId}`,
          kind: "tool",
          label: chunk.type,
          part,
        });
      }
      if (
        chunk.type === "finish" ||
        chunk.type === "abort" ||
        chunk.type === "error"
      )
        return add({
          id: `${batch}:${chunk.type}`,
          kind:
            chunk.type === "abort"
              ? "cancelled"
              : chunk.type === "error"
                ? "error"
                : "response",
          label:
            chunk.type === "finish"
              ? `Response ended: ${chunk.finishReason ?? "reason unavailable"}`
              : chunk.type === "abort"
                ? "Response cancelled"
                : "Response failed",
        });
      return false;
    },
  };
}

function safePath(value: unknown): string {
  if (typeof value !== "string") return "";
  return checkReadable(value).ok
    ? activityText(value, 1100)
    : "[Protected path]";
}
/** Untrusted query strings can contain session tokens or personal data. The
 * activity feed shows a normalized origin/path and query presence only; full
 * native receipts retain structurally validated evidence when necessary. */
function safeNetworkUrl(value:unknown):string {
  if(typeof value!=="string" || value.length>4096)return "";
  try{
    const url=new URL(value);
    if(!["http:","https:"].includes(url.protocol) || url.username || url.password)
      return "[Untrusted URL withheld]";
    const path=url.pathname.slice(0,260);
    return activityText(`${url.origin}${path}${url.search?"?… [query withheld]":""}`,360);
  }catch{return "[Invalid URL withheld]";}
}

export function messageActivity(
  message: UIMessage,
  sessionId: string,
  workspaceId: string | null,
): ActivityEvent[] {
  if (message.role !== "assistant") return [];
  const record = readActivity(message, sessionId, workspaceId);
  // Explicitly foreign provenance must not fall back to an unscoped display.
  const claimed = object(object(message.metadata)?.clackActivity)?.owner;
  if (
    claimed &&
    (object(claimed)?.sessionId !== sessionId ||
      object(claimed)?.workspaceId !== workspaceId)
  )
    return [];
  const events: ActivityEvent[] = [];
  const add = (event: ActivityEvent) =>
    events.push({ ...event, messageId: message.id });
  const parts = message.parts;
  parts.forEach((part, index) => {
    const p = part as unknown as Record<string, unknown>;
    const receipts = record?.receipts.filter((r) => r.part === index) ?? [];
    const receipt = receipts[0];
    const base = {
      id: `${message.id}:part:${index}`,
      at: receipt?.at,
      order: receipt ? record?.receipts.indexOf(receipt) : undefined,
      owner: receipt ? (receipt.owner ?? record?.owner) : undefined,
    };
    if (part.type === "reasoning") {
      const meta = object(p.providerMetadata);
      if (
        object(meta?.anthropic)?.redactedData !== undefined ||
        typeof p.text !== "string" ||
        !p.text.trim()
      )
        return;
      const format = receipt?.format ?? "unspecified";
      add({
        ...base,
        kind: format === "summary" ? "summary" : "reasoning",
        label:
          format === "summary"
            ? "Provider reasoning summary"
            : format === "content"
              ? "Provider reasoning content"
              : "Provider reasoning (format unspecified)",
        detail: activityText(p.text),
        source:
          p.state === "streaming" ? "Partial output" : "Returned provider text",
      });
    } else if (part.type === "text") {
      if (
        parts
          .slice(index + 1)
          .some(
            (candidate) =>
              candidate.type === "dynamic-tool" ||
              candidate.type.startsWith("tool-"),
          )
      )
        add({
          ...base,
          kind: "progress",
          label: "Assistant progress",
          detail: activityText(p.text),
        });
    } else if (
      part.type === "file" ||
      part.type === "source-url" ||
      part.type === "source-document"
    ) {
      add({
        ...base,
        kind: "runtime",
        label: "Provider artifact returned",
        source: activityText(p.mediaType) || part.type,
      });
    } else if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const tool =
        part.type === "dynamic-tool"
          ? activityText(p.toolName, 100)
          : part.type.slice(5);
      const input = object(p.input);
      const output = object(p.output);
      const approval = object(p.approval);
      const failure =
        p.state === "output-error" ||
        typeof output?.error === "string" ||
        output?.ok === false ||
        output?.success === false;
      const state = failure
        ? "Failed"
        : p.state === "output-available"
          ? "Result received"
          : p.state === "output-denied"
            ? "Denied"
            : p.state === "approval-requested"
              ? "Approval requested"
              : p.state === "approval-responded"
                ? approval?.approved
                  ? "Approved"
                  : "Denied"
                : p.state === "input-streaming"
                  ? "Tool selected"
                  : "Call requested";
      const detail = [
        safePath(input?.path ?? input?.file_path),
        typeof input?.command === "string" ? "Command arguments withheld" : "",
        failure
          ? "Tool reported a failure. Inspect the original tool result."
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      // A returned result is not a claim that a write/command succeeded.
      const toolCallId =
        typeof p.toolCallId === "string" ? p.toolCallId : undefined;
      for (const r of receipts)
        add({
          id: `${message.id}:${r.id}`,
          kind: "runtime",
          label: `${tool}: ${toolBoundaryLabel(r.label, failure)}`,
          detail,
          at: r.at,
          order: record?.receipts.indexOf(r),
          owner: r.owner ?? record?.owner,
          toolCallId,
        });
      if (
        !receipts.length ||
        !receipts.some((r) => r.label === `tool-${String(p.state)}`)
      )
        add({
          ...base,
          at: undefined,
          kind: "runtime",
          label: `${tool}: ${state}`,
          detail,
          toolCallId,
        });
      if (approval && typeof approval.approved === "boolean")
        add({
          id: `${base.id}:approval`,
          kind: "runtime",
          label: approval.approved ? "Approval granted" : "Approval denied",
          owner: base.owner,
          toolCallId,
        });
      // Native TF commands, filesystem/repository/build and web operations
      // return receipts in the existing persisted SDK tool output. Project
      // ONLY bounded, content-free evidence: never duplicate output, file
      // contents, web body, snippets, argv, environment or secrets here.
      const tf = object(output?.effectReceipt);
      const tfOperation = tf?.toolId === "tf.operation.v1";
      const tfWeb = tf?.toolId === "tf.web_operation.v1";
      const tfBrowser = tf?.toolId === "tf.browser_operation.v1";
      const tfEffect = tfOperation || tfWeb || tfBrowser ? tf?.effectState : tf?.sideEffect;
      if ((tf?.toolId === "tf.bounded_command.v1" || tfOperation || tfWeb || tfBrowser) &&
          typeof tf.requestId === "string" &&
          typeof tf.terminal === "string" &&
          typeof tfEffect === "string") {
        const safe = (value:unknown) => activityText(value,160) || "Unknown";
        const pid = typeof tf.pid === "number" && Number.isSafeInteger(tf.pid) && tf.pid>0
          ? String(tf.pid) : "Unknown";
        const paths = Array.isArray(tf.affectedResources) ? tf.affectedResources
          .slice(0,4).map(path=>safePath(path)).filter(Boolean) : [];
        const requested = Array.isArray(tf.requestedResources) ? tf.requestedResources
          .slice(0,4).map(path=>safePath(path)).filter(Boolean) : [];
        const sha = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
          ? value : null;
        const commit = (value: unknown) => typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
          ? value : null;
        const instant = (value: unknown) =>
          typeof value === "number" && Number.isSafeInteger(value) &&
          value >= 946684800000 && value <= 4102444800000
            ? new Date(value).toISOString() : null;
        const listedPaths = (value: unknown) => Array.isArray(value)
          ? value.slice(0, 4).map(path => safePath(path)).filter(Boolean).join(", ")
          : "";
        const commandAdapter = tfOperation &&
          ["native_filesystem", "pinned_git", "pinned_npm", "pinned_cargo"].includes(String(tf.commandAdapter))
          ? String(tf.commandAdapter) : null;
        const detail=[
          `Request: ${safe(tf.requestId)}`,
          `Actor: ${safe(tf.actor)}`,
          ...(tfOperation ? [`Operation: ${safe(tf.operation)}`] : []),
          ...(tfWeb ? [`Network operation: ${safe(tf.operation)}`] : []),
          ...(tfBrowser ? [`Browser operation: ${safe(tf.operation)}`] : []),
          ...(tfBrowser && typeof tf.browserSessionId==="string"
            ? [`Browser session: ${safe(tf.browserSessionId)}`] : []),
          ...(tfBrowser && typeof tf.snapshotId==="string"
            ? [`Page snapshot: ${safe(tf.snapshotId)}`] : []),
          ...(tfBrowser && tf.engine==="inert_native_text"
            ? ["Browser engine: inert bounded native text (no JavaScript or remote WebView)"] : []),
          ...((tfWeb || tfBrowser) && typeof tf.requestedUrl==="string"
            ? [`Requested URL: ${safeNetworkUrl(tf.requestedUrl)}`] : []),
          ...((tfWeb || tfBrowser) && typeof tf.finalUrl==="string"
            ? [`Final URL: ${safeNetworkUrl(tf.finalUrl)}`] : []),
          ...(tfWeb && typeof tf.searchQuery==="string"
            ? [`Search: ${safe(tf.searchQuery)}`] : []),
          ...(tfWeb && tf.operation==="web_search" && typeof input?.query==="string"
            ? [`Search query: ${activityText(input.query, 160)}`] : []),
          ...((tfWeb || tfBrowser) && typeof tf.statusCode==="number" &&
            Number.isInteger(tf.statusCode) && tf.statusCode>=100 && tf.statusCode<=599
            ? [`HTTP status: ${tf.statusCode}`] : []),
          ...((tfWeb || tfBrowser) && typeof tf.contentType==="string"
            ? [`Content type: ${safe(tf.contentType)}`] : []),
          ...(tfWeb && typeof tf.tlsState==="string" &&
            ["unknown","https_transport_observed","cleartext_http"].includes(tf.tlsState)
            ? [`TLS transport: ${tf.tlsState==="https_transport_observed"
              ?"HTTPS response observed; peer IP not attested":tf.tlsState==="cleartext_http"
                ?"HTTP (unencrypted)":"Not observed"}`] : []),
          ...((tfWeb || tfBrowser) && typeof tf.bytesReceived==="number" &&
            Number.isSafeInteger(tf.bytesReceived) && tf.bytesReceived>=0
            ? [`Bytes received: ${tf.bytesReceived}`] : []),
          ...((tfWeb || tfBrowser) && typeof tf.bytesRetained==="number" &&
            Number.isSafeInteger(tf.bytesRetained) && tf.bytesRetained>=0
            ? [`Bytes retained: ${tf.bytesRetained}`] : []),
          ...((tfWeb || tfBrowser) && typeof tf.truncated==="boolean"
            ? [`Truncated: ${tf.truncated?"yes":"no"}`] : []),
          ...((tfWeb || tfBrowser) && sha(tf.contentSha256)
            ? [`Content SHA-256: ${sha(tf.contentSha256)}`] : []),
          ...(tfBrowser && Array.isArray(tf.elements)
            ? [`Page links observed: ${Math.min(128,tf.elements.length)} (snapshot-scoped, untrusted)`] : []),
          ...(tfBrowser && Array.isArray(tf.unsupported)
            ? [`Unsupported browser operations: ${tf.unsupported.slice(0,12)
                .filter((v):v is string=>typeof v==="string" && /^[a-z_-]{1,40}$/.test(v)).join(", ")}`] : []),
          ...(tfWeb && typeof tf.credentialReference==="string" &&
            /^credential:[A-Za-z0-9._-]{1,128}$/.test(tf.credentialReference)
            ? [`Credential reference: ${tf.credentialReference} (value withheld)`] : []),
          ...(tfWeb && typeof tf.credentialUsed==="boolean"
            ? [`Credential used: ${tf.credentialUsed?"yes":"no"}`] : []),
          ...((tfWeb || tfBrowser) && Array.isArray(tf.redirectChain)
            ? [`Redirect transitions: ${Math.min(5,tf.redirectChain.length)}`,
                ...tf.redirectChain.slice(0,5).map((hop,index)=>{
                  const h=object(hop);
                  const destination=safeNetworkUrl(typeof hop==="string"?hop:
                    h?.to??h?.url??h?.destination);
                  return `Redirect ${index+1}: ${destination||"destination withheld"}`;
                })] : []),
          ...((tfWeb || tfBrowser) && Array.isArray(tf.dnsEvidence)
            ? [`DNS checks: ${Math.min(6,tf.dnsEvidence.length)}`,
                ...tf.dnsEvidence.slice(0,6).map(hop=>{
                  const h=object(hop);
                  const host=safe(h?.host);
                  const count=Array.isArray(h?.addresses)?h.addresses.length:0;
                  const ips=Array.isArray(h?.addresses)
                    ? h.addresses.slice(0,8).filter((value):value is string=>
                      typeof value==="string" && value.length<=64 &&
                      /^[0-9a-fA-F:.]+$/.test(value)).join(", ") : "";
                  const classification=safe(h?.classification);
                  return `DNS: ${host} · ${classification} · ${count} addresses${ips?` [${ips}]`:""} (socket peer unverified)`;
                })] : []),
          ...(tfWeb && Array.isArray(tf.searchResults)
            ? [`Search results: ${Math.min(20,tf.searchResults.length)} (metadata only, pages not fetched)`] : []),
          ...(tfWeb && typeof tf.searchResultCount==="number" &&
            Number.isSafeInteger(tf.searchResultCount) && tf.searchResultCount>=0 &&
            tf.searchResultCount<=20
            ? [`Search results: ${tf.searchResultCount} (metadata only, pages not fetched)`] : []),
          ...(tfWeb && typeof tf.searchSource==="string"
            ? [`Search provenance: ${safe(tf.searchSource)} (unverified listing; content fetched separately)`]
            : tfWeb && object(tf.searchSource)
              ? [`Search provenance: ${safe(object(tf.searchSource)?.provider)} (unverified listing; content fetched separately)`] : []),
          ...(commandAdapter ? [`Trusted adapter: ${commandAdapter}`] : []),
          ...(commandAdapter && typeof tf.commandCwd === "string"
            ? [`Command directory: ${safePath(tf.commandCwd)}`] : []),
          ...(instant(tf.startedAt) ? [`Started: ${instant(tf.startedAt)}`] : []),
          ...(instant(tf.endedAt) ? [`Ended: ${instant(tf.endedAt)}`] : []),
          `Policy: ${safe(tf.policyDecision)}`,
          `Approval: ${safe(tf.approvalId)}`,
          `Sandbox: ${safe(tf.sandbox)} (${safe(tf.isolation)})`,
          `Process: ${pid}`,
          `Terminal: ${safe(tf.terminal)}`,
          `Effect: ${safe(tfEffect)}`,
          `Uncertainty: ${safe(tf.uncertainty)}`,
          `Retry: ${tf.autoRetry === false || tfOperation ? "No automatic replay after uncertain effects" : "Unknown · no authority asserted"}`,
          ...(requested.length ? [`Requested resources: ${requested.join(", ")}`] : []),
          ...(paths.length ? [`Affected resources: ${paths.join(", ")}`] : []),
          ...(typeof tf.beforeExists === "boolean" ? [`Existed before: ${tf.beforeExists ? "yes" : "no"}`] : []),
          ...(typeof tf.afterExists === "boolean" ? [`Exists after: ${tf.afterExists ? "yes" : "no"}`] : []),
          ...(sha(tf.beforeSha256) ? [`Before SHA-256: ${sha(tf.beforeSha256)}`] : []),
          ...(sha(tf.afterSha256) ? [`After SHA-256: ${sha(tf.afterSha256)}`] : []),
          ...(sha(tf.stdoutSha256) ? [`Output SHA-256: ${sha(tf.stdoutSha256)}`] : []),
          ...(commit(tf.beforeHead) ? [`HEAD before: ${commit(tf.beforeHead)}`] : []),
          ...(commit(tf.afterHead) ? [`HEAD after: ${commit(tf.afterHead)}`] : []),
          ...(typeof tf.beforeBranch === "string" ? [`Branch before: ${safe(tf.beforeBranch)}`] : []),
          ...(typeof tf.afterBranch === "string" ? [`Branch after: ${safe(tf.afterBranch)}`] : []),
          ...(listedPaths(tf.beforeChangedPaths) ? [`Changed before: ${listedPaths(tf.beforeChangedPaths)}`] : []),
          ...(listedPaths(tf.afterChangedPaths) ? [`Changed after: ${listedPaths(tf.afterChangedPaths)}`] : []),
          ...(listedPaths(tf.beforeStagedPaths) ? [`Staged before: ${listedPaths(tf.beforeStagedPaths)}`] : []),
          ...(listedPaths(tf.afterStagedPaths) ? [`Staged after: ${listedPaths(tf.afterStagedPaths)}`] : []),
        ].join("\n");
        add({
          id:`${base.id}:tf-effect`,kind:"runtime",
          label:`${tool}: native ${safe(tf.terminal)} · effect ${safe(tfEffect)}`,
          detail,owner:base.owner,toolCallId,
          source:"Native TF effect receipt (historical)",
        });
      }
    }
  });
  for (const [order, r] of (record?.receipts ?? []).entries())
    if (r.part === undefined)
      add({
        id: `${message.id}:${r.id}`,
        kind: "runtime",
        label: r.label,
        at: r.at,
        order,
        owner: r.owner ?? record?.owner,
      });
  if (record?.omitted)
    add({
      id: `${message.id}:omitted`,
      kind: "runtime",
      label: `${record.omitted} additional runtime boundaries not retained`,
      detail:
        "Original messages and tool results remain in conversation history.",
    });
  return events;
}

function toolBoundaryLabel(label: string, failure: boolean) {
  switch (label) {
    case "tool-input-start":
      return "Tool selected";
    case "tool-input-available":
      return "Call requested";
    case "tool-approval-request":
      return "Approval requested";
    case "tool-output-available":
      return failure ? "Failed result received" : "Result received";
    case "tool-output-error":
      return "Failed";
    case "tool-output-denied":
      return "Denied";
    default:
      return label.replace(/^tool-/, "").replace(/-/g, " ");
  }
}

export function taskActivity(
  tasks: readonly PeerTask[],
  sessionId: string,
  workspaceId: string | null,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const task of tasks) {
    if (
      task.workspaceId !== workspaceId ||
      (task.sourceSessionId !== sessionId && task.targetSessionId !== sessionId)
    )
      continue;
    const owner: ActivityOwner = {
      sessionId: task.targetSessionId,
      runId: `${task.targetSessionId}:${task.startedAt ?? "unstarted"}`,
      workspaceId: task.workspaceId,
      agentId: task.targetAgentId,
      modelId: task.targetModelId,
      taskId: task.id,
    };
    const add = (key: string, label: string, at?: number, detail?: string) =>
      events.push({
        id: `${task.id}:${key}`,
        kind: "runtime",
        label,
        at,
        detail,
        taskId: task.id,
        owner,
      } satisfies ActivityEvent);
    add(
      "created",
      task.kind === "review" ? "Review delegated" : "Task delegated",
      task.createdAt,
    );
    events[events.length - 1].owner = {
      ...owner,
      sessionId: task.sourceSessionId,
      agentId: task.sourceAgentId,
      modelId: task.sourceModelId,
      runId: "unavailable",
    };
    if (task.dependsOn.length)
      add(
        "dependencies",
        "Task dependencies recorded",
        task.createdAt,
        task.dependsOn.map((id) => activityText(id)).join("\n"),
      );
    if (task.dependenciesSatisfiedAt)
      add("ready", "Dependencies satisfied", task.dependenciesSatisfiedAt);
    if (task.handoff)
      add(
        "handoff",
        "Evidence handoff prepared",
        task.handoff.createdAt,
        activityText(
          `${task.handoff.sources.length} sources; ${task.handoff.omitted} omitted; receipt ${task.handoff.digest}\n${task.handoff.sources.join("\n")}`,
        ),
      );
    if (task.startedAt) add("started", "Task started", task.startedAt);
    for (const event of task.communication ?? []) {
      if (
        event.workspaceId !== workspaceId ||
        (event.sender.sessionId !== sessionId &&
          event.recipient.sessionId !== sessionId)
      )
        continue;
      events.push({
        id: `communication:${event.id}`,
        kind: "runtime",
        label: `${event.kind.replace(/-/g, " ")}: ${event.state}`,
        detail: activityText(event.text),
        at: event.createdAt,
        taskId: task.id,
        messageId: event.sourceMessageId,
        toolCallId: event.toolCallId,
        owner: {
          ...owner,
          sessionId: event.sender.sessionId,
          agentId: event.sender.agentId,
          modelId: event.sender.modelId,
          runId: `${event.sender.sessionId}:${event.runStartedAt}`,
        },
        source: event.evidence
          .map((ref) => `${ref.artifactId} @ ${ref.contentHash}`)
          .join("\n"),
      });
      if (event.deliveredAt)
        add(
          `${event.id}:delivered`,
          "Peer communication delivered",
          event.deliveredAt,
        );
      if (event.acknowledgedAt)
        add(
          `${event.id}:ack`,
          "Peer communication acknowledged",
          event.acknowledgedAt,
        );
    }
    if (task.status !== "running" && task.status !== "queued")
      add(
        "status",
        task.recovery?.interruption
          ? "Task interrupted"
          : `Task ${task.status}`,
        task.endedAt ?? task.updatedAt,
      );
    if (task.result)
      add(
        "result",
        task.kind === "review" ? "Review returned" : "Task result returned",
        task.result.completedAt,
        activityText(
          `${task.result.artifacts.length} artifacts\n${task.result.artifacts
            .filter((artifact) => artifact.workspaceId === workspaceId)
            .map(
              (artifact) =>
                `${artifact.id} @ ${artifact.contentRef.contentHash}`,
            )
            .join(
              "\n",
            )}\n${task.review?.files.map((file) => `${safePath(file.path)} @ ${file.hash}`).join("\n") ?? ""}`,
        ),
      );
  }
  return events;
}

export function conversationActivity(
  messages: UIMessage[],
  tasks: readonly PeerTask[],
  sessionId: string,
  workspaceId: string | null,
  run?: SessionRun,
): ActivityEvent[] {
  const events = messages.flatMap((m) =>
    messageActivity(m, sessionId, workspaceId),
  );
  events.push(...taskActivity(tasks, sessionId, workspaceId));
  if (run && (run.workspaceId ?? null) === workspaceId)
    events.push({
      id: `run:${run.startedAt}`,
      kind: "runtime",
      label: `Run ${run.state}`,
      at: run.endedAt ?? run.startedAt,
      owner: {
        sessionId,
        runId: `${sessionId}:${run.startedAt}`,
        workspaceId,
        agentId: run.agentId,
        modelId: run.modelId,
        providerId: run.providerId,
        taskId: run.peerTaskId,
      },
      detail: run.error ? activityText(run.error.message) : undefined,
    });
  // Unknown times keep transcript order in a separate, explicitly untimed tail.
  return [...new Map(events.map((e) => [e.id, e])).values()].sort((a, b) => {
    const time = (a.at ?? Infinity) - (b.at ?? Infinity);
    if (time) return time;
    return a.messageId && a.messageId === b.messageId
      ? (a.order ?? Infinity) - (b.order ?? Infinity)
      : 0;
  });
}
