import type { ModelMessage } from "ai";

export const multilineRefusal = "Refused: command contains control characters (including CR/LF). Commands must be single-line.";
export function shellPair(id: string, command: string, output: Record<string, string | number | boolean | undefined>): ModelMessage[] {
  return [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: "bash_run", input: { command } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName: "bash_run", output: { type: "json", value: output } }] },
  ];
}
export function refusedShellHistory() {
  const command = `echo '${"unexecuted draft\n".repeat(180)}'`;
  const adapted = "echo adapted";
  return [
    ...shellPair("refused", command, { error: multilineRefusal }),
    ...shellPair("adapted", adapted, { command: adapted, stdout: "adapted", stderr: "", exit_code: 0, timed_out: false }),
  ];
}
