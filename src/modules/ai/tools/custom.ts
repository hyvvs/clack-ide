import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import type { ToolContext } from "@/modules/ai/tools/context";
import { customToolsClient } from "@/modules/ai/lib/customTools";

export function buildCustomToolProposals(ctx: ToolContext): ToolSet {
  if (!ctx.getSessionId() || !ctx.getWorkspaceId?.()) return {};
  return {
    propose_custom_tool: tool({
      description:
        "Submit a bounded JSON custom-tool definition for user review, never registration or execution. Name must start custom_. Required fields: name, description, inputSchema (object), outputSchema, outputDescription, binding (native operation read_file/list_directory/write_file/create_directory; http url/method; script executable/argv/hash; function module/export/hash; wasi schemaVersion:1/hash/abi:wasi-preview1-json-v1/export:_start/runtime:clack-wasi-1; mcp server/tool), permissions (read-files/write-files/create-files/run-commands/network), credentialRef (null or keyring reference), timeoutMs, outputBytes. WASI requires previously user-imported same-workspace module hash, only run-commands permission, null credentials and outputBytes<=16384. Omit scope/agents/conversations to bind to your current conversation and agent; no broader proposal is allowed. Object schemas require properties and additionalProperties:false; strings maxLength<=8192; arrays maxItems<=64; no references/defaults. No credentials, inline executable code, installation or execution. User authorization is separate.",
      inputSchema: z.object({ definitionJson: z.string().min(2).max(24576) }),
      execute: async ({ definitionJson }) => {
        const sessionId = ctx.getSessionId();
        if (!sessionId) throw Error("Chat unavailable");
        const definition = JSON.parse(definitionJson);
        definition.scope ??= "conversation";
        definition.agents ??= [ctx.getAgentId()];
        definition.conversations ??= [sessionId];
        const current = await customToolsClient(sessionId).loadEligible();
        return invoke("custom_tools_propose", {
          sessionId,
          expectedRevision: current.revision,
          definition,
        });
      },
    }),
  };
}
