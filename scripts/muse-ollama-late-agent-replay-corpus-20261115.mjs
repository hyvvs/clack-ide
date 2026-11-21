/**
 * Content-free structural recreation of frozen ForgeBoard 06/09 durable UI
 * transcript PARTS, not a claim that their per-request Ollama wire was retained.
 * Source size targets come from saved user/tool/reasoning part counts; no source
 * text, sensitive paths, secrets, original prompt, or executable effects copied.
 */
const sixth = [
  ["list_directory",120,133],["todo_write",1202,40],["todo_write",1206,87],
  ["create_directory",128,165],["create_directory",129,166],["create_directory",133,170],
  ["write_file",555,189],["write_file",886,197],["write_file",416,198],
  ["write_file",834,198],["write_file",353,200],["write_file",485,199],
  ["write_file",216,186],["todo_write",1208,109],["create_directory",132,169],
  ["write_file",1346,195],["write_file",764,197],["write_file",1676,200],
  ["write_file",1208,195],
];
const ninth = [
  ["list_directory",120,133],["todo_write",2031,77],
  ["create_directory",128,165],["create_directory",129,166],["create_directory",125,162],
  ["write_file",768,197],["write_file",512,198],["write_file",899,198],
  ["write_file",185,186],["todo_write",2033,75],["create_directory",132,169],
  ["write_file",801,197],["write_file",1246,197],["write_file",865,195],
  ["write_file",1697,200],
];
const reasoning06=[1442,2672,98,58,20,34,22,24,8,21,11,17,17,14,25,16,12,25,17,10];
const reasoning09=[1260,2275,104,157,16,21,25,16,31,986,12,14,22,10];
const contexts = [
  ["board-filter","Filter nested task boards by tenant and owner without leaking archived cards","tenantId","ownerId"],
  ["project-sync","Recover offline project edits without replaying committed operations","syncEpoch","changeId"],
  ["kanban-import","Import staged task cards while preserving validated status transitions","batchId","taskKey"],
  ["activity-log","Create consistent audit-event logs when concurrent edits arrive","eventSeq","actorScope"],
  ["calendar-rollup","Recalculate due-date widgets without duplicate recurring tasks","occurrenceId","timezone"],
  ["websocket-stream","Resume board events from a durable acknowledgement boundary","cursor","channelId"],
  ["permissions","Validate inherited workspace access after role revocation","policyRevision","subjectId"],
  ["build-verification","Verify end-to-end task-board build and integration checks","artifactHash","testCase"],
];

export const historicalShapes = {
  "06-pre-idle": { source:"forgeboard-prod-muse-20261114-06/inference-25",
    tools:["read_file","list_directory","write_file","create_directory","edit","grep","glob","bash_run",
      "bash_list","open_preview","todo_write","request_peer_task","cancel_peer_task","propose_custom_tool"],
    savedParts:59, savedStepStarts:20, savedReasoningParts:20, completedTools:sixth,
    reasoningBytes:reasoning06, originalUserUtf8Bytes:2086, savedTodoCount:11 },
  "09-pre-idle": { source:"forgeboard-prod-muse-20261115-09/inference-24",
    tools:["read_file","list_directory","write_file","create_directory","edit","grep","glob","bash_run",
      "bash_list","open_preview","todo_write","read_agent_output","request_peer_task","cancel_peer_task","propose_custom_tool"],
    savedParts:45, savedStepStarts:16, savedReasoningParts:14, completedTools:ninth,
    reasoningBytes:reasoning09, originalUserUtf8Bytes:2086, savedTodoCount:11 },
  "09-recovery": { source:"forgeboard-prod-muse-20261115-09/inference-25",
    tools:["read_file","list_directory","write_file","create_directory","edit","glob","bash_run",
      "bash_list","open_preview","todo_write","request_peer_task","cancel_peer_task"],
    savedParts:45, savedStepStarts:16, savedReasoningParts:14, completedTools:ninth,
    reasoningBytes:reasoning09, originalUserUtf8Bytes:2086, savedTodoCount:11 },
};

export const replayPlan = [
  "06-pre-idle","09-pre-idle","06-pre-idle","09-pre-idle",
  "09-recovery","09-recovery","09-recovery","09-recovery",
];

function snippet(caseId, unit, topic) {
  const [slug, objective, first, second]=topic;
  const file=`src/fictional/${slug}/module-${unit % 13}.ts`;
  return [
    `// Archived synthetic source snapshot ${file}; this is READ-ONLY prior task evidence.`,
    `// State: ${objective}. Current ${first} and ${second} are distinct fields.`,
    `export function validate${unit % 13}(record: { ${first}: string; ${second}: string; revision: number }, next: string) {`,
    `  if (!record.${first} || !record.${second}) throw Error("invalid ${slug} state");`,
    `  if (record.revision < ${(caseId+unit)%7}) return { ok: false, reason: "stale revision" };`,
    `  return {ok:true, next, revision:record.revision+1, review:"needed"};`,
    `}`,
    `// Test requirement ${unit}: verify wrong ${second}, stale ${first}, read-only recovery, and cancelled writes.`,
  ].join("\n");
}
function safeExpansion(caseId,unit,topic,ordinal) {
  const checks=["revision conflict","missing identifier","wrong owner","out-of-order event",
    "incomplete rollback","unfinished test","stale Todo","unverified source","permission boundary"];
  return `Review ${ordinal}: ${topic[1]} at ${topic[0]}:${unit} requires checking ${checks[(ordinal+unit+caseId)%checks.length]}; `+
    `do not claim verification, mutation or tool execution. `+
    `Expected invariant: ${topic[2]} and ${topic[3]} remain linked to source revision ${ordinal%19}.\n`;
}
function fitNarrative(head, approximateUtf8Bytes, caseId,unit,topic) {
  let value=head, index=0;
  while(Buffer.byteLength(value,"utf8") < approximateUtf8Bytes-140 && index<120)
    value+=safeExpansion(caseId,unit,topic,index++);
  return value;
}
function toolArguments(name,caseId,unit,targetInputBytes,topic) {
  const [slug, ,first,second]=topic;
  if(name==="list_directory") return {path:"."};
  if(name==="create_directory") return {path:`fictional/${slug}/stage-${unit}`};
  if(name==="todo_write") {
    const todos=Array.from({length:Math.max(3,Math.min(11,Math.floor(targetInputBytes/160)))},(_,i)=>({
      content:`Inspect ${slug} ${first} and ${second}: validation ${unit+i}; pending source proof ${i%6}`,
      status:i%3===0?"in_progress":"pending",
    }));
    return {todos};
  }
  const head=snippet(caseId,unit,topic);
  const content=fitNarrative(head,Math.max(140,targetInputBytes-85),caseId,unit,topic);
  return {path:`fictional/${slug}/module-${unit}.ts`,content};
}
function toolOutput(name,caseId,unit,targetOutputBytes,topic) {
  const head=`SYNTHETIC_PRIOR_TOOL_RECEIPT: ${name}; state=output-available; `+
    `fixture=${topic[0]}; operation=${unit}; result=previously-observed; no effects in this replay.\n`;
  return fitNarrative(head,Math.max(100,targetOutputBytes),caseId,unit,topic);
}
function summary(caseId,unit,topic,desiredBytes) {
  const head=`Prior assistant note: ${topic[1]}. Source ${unit} is not independently verified. `+
    `Do not repeat finished operations; review completed tool evidence and pending Todos.\n`;
  // Historically 'reasoning' parts are saved as UI evidence, but exact provider
  // retention/pruning is unknown; these benign summaries are NOT hidden thoughts.
  return fitNarrative(head,Math.max(130,desiredBytes),caseId,unit,topic);
}
export function replayMessages(caseNumber,kind,stableSystem,recoveryInstruction="") {
  if(!Number.isInteger(caseNumber)||caseNumber<0||caseNumber>=replayPlan.length||replayPlan[caseNumber]!==kind)
    throw Error("invalid bounded replay id/profile");
  const shape=historicalShapes[kind],topic=contexts[caseNumber];
  const initial=fitNarrative(
    `Fictional full-stack task: ${topic[1]}. Preserve backend/frontend/tests and 11 unresolved Todo entries. `+
    `Previous Agent calls were already completed and must never be executed again. `+
    `Current authorized step: request ONE native list_directory with path "." (do not run the returned tool); do not edit or execute tools.\n`,
    shape.originalUserUtf8Bytes,caseNumber,0,topic);
  const messages=[{role:"system",content:stableSystem+recoveryInstruction},
    {role:"user",content:initial}];
  const receiptNames=[];
  const todoState=Array.from({length:shape.savedTodoCount},(_,i)=>
    `Todo-${i+1} for ${topic[0]}: inspect ${topic[2]}, verify ${topic[3]}, test rollback ${i%3}; state=${i%2?"pending":"in_progress"}`).join("\n");
  for(let i=0;i<shape.completedTools.length;i++){
    const [name,inputBytes,outputBytes]=shape.completedTools[i];
    const args=toolArguments(name,caseNumber,i,inputBytes,topic);
    // This is previous conversation only: never execute these operations.
    const notes=summary(caseNumber,i,topic,shape.reasoningBytes[i]??30)+
      (i===shape.completedTools.length-1
        ? `\nCurrent unfinished Agent Todo state (prior evidence only):\n${todoState}\n`+
          (kind==="09-recovery"
            ?"The previous provider segment emitted partial thinking, then went idle; its text was incomplete, not a completed operation. "
            :"Previous operations have already completed; do not repeat them. ")+
          `The sole remaining authorized next step is native list_directory with path "."; this replay MUST NOT execute that call.`
        : "");
    messages.push({role:"assistant",content:notes,
      tool_calls:[{function:{name,arguments:args}}]});
    messages.push({role:"tool",tool_name:name,content:toolOutput(name,caseNumber,i,outputBytes,topic)});
    receiptNames.push(name);
  }
  // User stays a single initial UI message, as in the archived transcript;
  // a final tool result leaves the assistant poised for its next generation.
  return {messages,shape,receiptNames,topicSlug:topic[0]};
}
