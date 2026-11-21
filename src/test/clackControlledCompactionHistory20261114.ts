/** Deterministic synthetic Agent history for a non-ForgeBoard native proof. */
import type { UIMessage } from "ai";

const message = (id: string, role: "user" | "assistant", text: string): UIMessage =>
  ({ id, role, parts: [{ type: "text", text }] });

export function controlledHistory(): UIMessage[] {
  const historical = Array.from({ length: 5 }, (_, index) => {
    const i = index + 1;
    const line = `Observation ${i}: the controlled inventory used revision ${i} with its own intact original evidence; review remains pending.`;
    return message(`historical-assistant-${i}`, "assistant", `${line}\n${(line + "\n").repeat(14)}`);
  });
  const completed = Array.from({ length: 5 }, (_, i) => {
    const name = i === 4 ? "todo_write" : "read_file";
    return [{ type: `tool-${name}`, toolCallId: `controlled-completed-${i + 1}`,
      state: "output-available", input: name === "todo_write"
        ? { todos: [{ title: "Continue controlled verification", status: "in_progress" }] }
        : { path: `isolated/observation-${i + 1}.txt` },
      output: name === "todo_write"
        ? { ok: true, count: 1 }
        : { ok: true, content: `Historical completed read ${i + 1}; never replay this effect.` },
    }] as UIMessage["parts"];
  }).flat();
  return [
    message("controlled-original-user", "user", "Controlled reliability test, NOT ForgeBoard. Preserve original requirements and prior completed tool results; do not execute historical effects again."),
    ...historical,
    { id: "controlled-completed-transcript", role: "assistant", parts: [
      { type: "text", text: "Completed tool results remain original evidence; the latest Todo is still in progress." },
      ...completed,
    ] },
    message("controlled-correction-user", "user", "Continue the same logical task after context preparation; retain the completed reads and latest Todo. Do not replay prior effects."),
    { id: "controlled-next-agent-turn", role: "assistant", parts: [] },
  ];
}
