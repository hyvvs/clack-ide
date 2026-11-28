import { invoke } from "@tauri-apps/api/core";
import { tool } from "ai";
import type { z } from "zod";
import type { ToolContext } from "./context";
import { pathWithin } from "@/modules/ai/lib/toolFabricPolicy";
import {
  tfFsReadSchema, tfFsWriteSchema, tfFsDeleteSchema,
  tfRepoReadSchema, tfRepoWriteSchema, tfBuildRunSchema,
  tfOperationEffectful, validateTfOperationInput,
  type TfOperationToolName,
} from "./tfOperationSchemas";

// Preserve the existing public API for real TF operation executors and tests.
export {
  tfFsReadSchema, tfFsWriteSchema, tfFsDeleteSchema,
  tfRepoReadSchema, tfRepoWriteSchema, tfBuildRunSchema,
  TF_OPERATION_SCHEMAS, isTfOperationTool,
  validateTfOperationInput, tfOperationEffectful,
  type TfOperationToolName,
} from "./tfOperationSchemas";

type NativePrepare = {token:string;requestId:string;operation:string;
  requiresApproval:boolean;workspaceRoot:string;cwd:string;isolation:string};
export type TfOperationReceipt = {requestId:string;toolId:"tf.operation.v1";
  actor:string;operation:string;terminal:string;
  effectState:"NoEffect"|"Observed"|"Unknown";retry:string;
  canonicalPaths:string[];[key:string]:unknown};

const uncertain=(code:string)=>({ok:false,code,effectState:"Unknown" as const,
  terminal:"unknown" as const,retry:"no_auto_retry" as const,
  explanation:"Native completion and effect could not be verified; never retry automatically."});
const noEffect=(code:string)=>({ok:false,code,effectState:"NoEffect" as const,
  retry:"no_auto_retry" as const});
/** The Windows native PathBuf echo may differ in case and slash spelling.
 * Do not collapse distinct paths or treat a different root as authority. */
function sameNativeLocation(actual:string,requested:string):boolean {
  const normalize=(value:string)=>{
    const slashed=value.replace(/\\/g,"/");
    // Rust std::fs::canonicalize on Windows may return \\?\C:\... .
    // Strip ONLY this exact native disk-path wrapper; UNC/device aliases
    // remain non-equivalent and cannot broaden the selected authority.
    const disk=slashed.startsWith("//?/") &&
      /^[a-zA-Z]:\//.test(slashed.slice(4))?slashed.slice(4):slashed;
    const trimmed=disk.replace(/\/+$/,"");
    return /^[a-zA-Z]:\//.test(trimmed)?trimmed.toLowerCase():trimmed;
  };
  return normalize(actual)===normalize(requested);
}
function normalizeWorkspaceTarget(raw:string,root:string,cwd:string):string|null {
  if(/^([a-zA-Z]:(?![\\/])|\\\\|\/\/)/.test(raw))return null;
  const absolute=/^[a-zA-Z]:[\\/]/.test(raw)||raw.startsWith("/") ?
    raw : `${cwd.replace(/[\\/]$/,"")}/${raw}`;
  if(!pathWithin(root,absolute))return null;
  const value=absolute.replace(/\\/g,"/");
  const drive=/^[a-zA-Z]:\//.test(value)?value.slice(0,2):"";
  const segments=value.slice(drive?3:1).split("/");
  const parts:string[]=[];
  for(const segment of segments){
    if(!segment || segment===".")continue;
    if(segment==="..")parts.pop();
    else parts.push(segment);
  }
  return `${drive}/${parts.join("/")}`;
}

/** Existing SDK approval wrapper consumes the exact once proof BEFORE this
 * executor is reached. Native prepare/approve/execute independently reauth. */
export function buildTfOperationTools(ctx:ToolContext) {
  const define=<Schema extends z.ZodTypeAny>(name:TfOperationToolName,
    schema:Schema,description:string)=>{
    return tool({
      description,
      inputSchema:schema,
      needsApproval:tfOperationEffectful(name),
      execute:async (input,options)=>{
        const root=ctx.getWorkspaceRoot();
        const activeCwd=ctx.getCwd()??root;
        // Git is registered exclusively at the selected repository root.
        // Builds likewise execute against root-pinned manifests, not a model
        // chosen nested directory. SDK once proof separately binds active cwd.
        const cwd=name.startsWith("tf_repo_") || name==="tf_build_run"
          ? root:activeCwd;
        const session=ctx.getSessionId();
        const actor=ctx.getAgentId();
        if(!root || !cwd || !session || !actor)
          return noEffect("tf_operation_actor_or_workspace_missing");
        if(!validateTfOperationInput(name,input))
          return noEffect("tf_operation_input_invalid");
        const signal=options?.abortSignal;
        if(signal?.aborted)return noEffect("tf_operation_cancelled_before_prepare");
        const request:Record<string,unknown>={...input,actor,
          workspaceRoot:root,cwd};
        // Native rejects dot aliases and parent components. Normalize only
        // paths which the lexical preflight proved stayed within the selected
        // root at *every* step; native still independently canonicalizes them.
        for(const key of ["path","destination"] as const){
          if(typeof request[key]!=="string")continue;
          const normalized=normalizeWorkspaceTarget(request[key] as string,root,cwd);
          if(!normalized)return noEffect("tf_operation_path_outside_workspace");
          request[key]=normalized;
        }
        if(Array.isArray(request.paths)){
          const normalized=request.paths.map(value=>typeof value==="string"
            ?normalizeWorkspaceTarget(value,root,cwd):null);
          if(normalized.some(value=>!value))
            return noEffect("tf_operation_path_outside_workspace");
          request.paths=normalized;
        }
        let prepared:NativePrepare;
        try {
          prepared=await invoke<NativePrepare>("tf_operation_prepare",{request});
        }catch{return uncertain("tf_operation_prepare_failed");}
        const cancel=()=>void invoke("tf_operation_cancel",{token:prepared.token})
          .catch(()=>undefined);
        if(!prepared || !prepared.token || !prepared.requestId ||
          prepared.operation!==input.operation ||
          typeof prepared.workspaceRoot!=="string" ||
          !sameNativeLocation(prepared.workspaceRoot,root) ||
          typeof prepared.cwd!=="string" ||
          !sameNativeLocation(prepared.cwd,cwd) || !prepared.isolation ||
          prepared.requiresApproval!==tfOperationEffectful(name)){
          if(prepared?.token)cancel();
          return uncertain("tf_operation_prepare_mismatch");
        }
        if(signal?.aborted)cancel();
        else signal?.addEventListener("abort",cancel,{once:true});
        try {
          if(signal?.aborted)return uncertain("tf_operation_cancelled_after_prepare");
          if(prepared.requiresApproval)await invoke("tf_operation_approve",{token:prepared.token});
          if(signal?.aborted)return uncertain("tf_operation_cancelled_before_execute");
          const receipt=await invoke<TfOperationReceipt>("tf_operation_execute",{
            token:prepared.token,
          });
          if(!receipt || receipt.requestId!==prepared.requestId ||
            receipt.toolId!=="tf.operation.v1" || receipt.actor!==actor ||
            receipt.operation!==input.operation ||
            typeof receipt.terminal!=="string" ||
            !["NoEffect","Observed","Unknown"].includes(receipt.effectState) ||
            !Array.isArray(receipt.canonicalPaths) ||
            receipt.canonicalPaths.length>128 ||
            !receipt.canonicalPaths.every(path=>typeof path==="string" &&
              path.length<=4096) ||
            typeof receipt.retry!=="string")
            return uncertain("tf_operation_receipt_mismatch");
          const commandStatus=name==="tf_build_run"
            ? receipt.terminal==="completed" && receipt.exitCode===0
              ? "pass" as const
              : receipt.terminal==="unknown" || receipt.exitCode==null
                ? "unknown" as const:"fail" as const
            : undefined;
          return {ok:commandStatus==="pass" ||
              (commandStatus===undefined && receipt.terminal==="completed" &&
              (tfOperationEffectful(name)
                ? receipt.effectState==="Observed"
                : receipt.effectState==="NoEffect") &&
              (typeof receipt.exitCode!=="number" || receipt.exitCode===0)),
            ...(commandStatus?{commandStatus}:{}),
            effectReceipt:{...receipt,autoRetry:false as const}};
        }catch{
          cancel();
          return uncertain("tf_operation_terminal_unknown");
        }finally{signal?.removeEventListener("abort",cancel);}
      },
    });
  };
  return {
    tf_fs_read:define("tf_fs_read",tfFsReadSchema,
      "Native bounded workspace file_read, file_stat, directory_list, file_find or text_search. Structured operation only; sensitive/out-of-root paths denied by native authority."),
    tf_fs_write:define("tf_fs_write",tfFsWriteSchema,
      "Native file_create, file_replace, file_patch, directory_create or file_move inside the registered workspace. Always exact one-use human approval, even Full Access; native rechecks source and destination."),
    tf_fs_delete:define("tf_fs_delete",tfFsDeleteSchema,
      "Native file_delete with exact once approval, workspace checks and native effect receipt."),
    tf_repo_read:define("tf_repo_read",tfRepoReadSchema,
      "Native bounded repository status, branch, head, changed files, diff, staged diff, log, show and refs. No shell."),
    tf_repo_write:define("tf_repo_write",tfRepoWriteSchema,
      "Native repo_stage, repo_unstage, repo_create_branch or repo_switch_branch. Exact once approval, no shell."),
    tf_build_run:define("tf_build_run",tfBuildRunSchema,
      "Execute only native allowlisted build_typecheck, build_frontend, build_cargo_check, build_cargo_test or build_cargo_build with timeout. Effectful process; exact once approval and no automatic replay."),
  } as const;
}
