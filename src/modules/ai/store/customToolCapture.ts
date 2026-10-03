import {
  captureToolVersions,
  customToolsClient,
} from "@/modules/ai/lib/customTools";
import {
  awaitSessionWrites,
  saveSessionsList,
  type SessionRun,
} from "@/modules/ai/lib/sessions";
import { useChatStore } from "@/modules/ai/store/chatStore";
import type { ToolContext } from "@/modules/ai/tools/context";

export async function captureSessionTools(sessionId: string, ctx: ToolContext) {
  const initial = useChatStore
    .getState()
    .sessions.find((s) => s.id === sessionId);
  const run = initial?.run;
  const workspaceId = initial?.profile?.workspaceId;
  if (run?.state !== "running" || run.customTools || !workspaceId) return;
  await awaitSessionWrites(sessionId);
  let capture: NonNullable<SessionRun["customTools"]>;
  try {
    const view = await customToolsClient(sessionId).loadEligible();
    capture = {
      revision: view.revision,
      versions: captureToolVersions(view, workspaceId, ctx),
      unavailable: false,
    };
  } catch {
    // An unavailable registry cannot expose tools or break ordinary built-in tools.
    capture = { revision: null, versions: [], unavailable: true };
  }
  const state = useChatStore.getState();
  const current = state.sessions.find((s) => s.id === sessionId)?.run;
  if (
    current?.state !== "running" ||
    current.startedAt !== run.startedAt ||
    current.customTools
  )
    return;
  const sessions = state.sessions.map((s) =>
    s.id === sessionId
      ? { ...s, run: { ...current, customTools: capture } }
      : s,
  );
  useChatStore.setState({ sessions });
  await saveSessionsList(sessions);
}
