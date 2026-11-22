import { buildManagedAgentTools } from "./agent";
import { buildCustomToolProposals } from "@/modules/ai/tools/custom";
import { buildPeerTaskTools } from "./peer";
import { buildEditTools } from "./edit";
import { buildFsTools } from "./fs";
import { buildSearchTools } from "./search";
import { buildShellTools } from "./shell";
import { buildSubagentTools } from "./subagent";
import { buildTerminalTools } from "./terminal";
import { buildTodoTools } from "./todo";
import { buildEvidenceTools } from "@/modules/ai/tools/evidence";
import { buildResearchTools } from "@/modules/ai/tools/research";
import { buildBoundedCommandTools } from "@/modules/ai/tools/boundedCommand";
import { buildTfOperationTools } from "@/modules/ai/tools/tfOperations";
import { buildTfWebTools } from "@/modules/ai/tools/tfWeb";
import { buildTfBrowserTools } from "@/modules/ai/tools/tfBrowser";
import { applyAgentPermissionPolicy } from "@/modules/ai/lib/permissions";
import { capabilityIndexFromTools } from "@/modules/ai/lib/capabilityIndex";
import { identifyTool, toolRevisionIdentity } from "@/modules/ai/lib/toolExposure";

export { resolvePath, type ToolContext } from "./context";

/**
 * AI tool definitions.
 *
 * Approval policy:
 *  - Read-only tools (`read_file`, `list_directory`, `grep`, `glob`)
 *    auto-execute, but go through the security guard which refuses obvious
 *    secret paths (.env*, .ssh/, credentials, etc.).
 *  - Mutating tools (`write_file`, `edit`, `multi_edit`, `create_directory`,
 *    `run_command`) require explicit user approval — the AI SDK pauses on
 *    tool-call and surfaces a `tool-approval-request` part that the UI
 *    renders as a confirmation card.
 *  - `edit` / `multi_edit` additionally enforce a read-before-edit invariant
 *    (the model must have called read_file on the path earlier in the
 *    session).
 *
 * The model sees absolute paths only after they are resolved against the
 * active terminal's cwd (provided via `getCwd`); it should not invent paths
 * outside that.
 */
export function buildTools(ctx: import("./context").ToolContext) {
  const tools = {
    ...buildFsTools(ctx),
    ...buildEditTools(ctx),
    ...buildSearchTools(ctx),
    ...buildShellTools(ctx),
    ...buildBoundedCommandTools(ctx),
    ...buildTfOperationTools(ctx),
    ...buildTfWebTools(ctx),
    ...buildTfBrowserTools(ctx),
    ...buildSubagentTools(ctx),
    ...buildTerminalTools(ctx),
    ...buildTodoTools(ctx),
    ...buildEvidenceTools(ctx),
    ...buildResearchTools(ctx),
    ...buildManagedAgentTools(ctx),
    ...buildPeerTaskTools(ctx),
    ...buildCustomToolProposals(ctx),
  } as const;
  // The same existing capability index now provides the authoritative
  // descriptor passed through the SDK permission/approval execution wrapper.
  const registry=capabilityIndexFromTools(tools);
  const guarded=applyAgentPermissionPolicy(tools,ctx,name=>registry.callable(name)?.security);
  // The SDK wrapper is a new object. Carry the original native-owned T1/T2
  // version identity across it so the existing exposure catalog still sees
  // the exact registered tool, not an unversioned untrusted lookalike.
  for(const [name,original] of Object.entries(tools)){
    const identity=toolRevisionIdentity(original);
    if(identity!==null)identifyTool((guarded as Record<string,object>)[name],identity);
  }
  return guarded;
}

export type ChatTools = ReturnType<typeof buildTools>;
