import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const equal = (a, b) => process.platform === "win32"
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b);

// This is an evaluator for one disposable probe, not a shell sandbox/parser.
// Unrecognized commands, existing data and ambiguous paths require separate review.
export async function evaluateAcceptanceApproval(subject, expected) {
  const targets = [];
  const deny = reason => ({ approved: false, reason, targets });
  if (!expected || subject.sessionId !== expected.sessionId ||
    subject.runId !== expected.runId || subject.workspaceRoot !== expected.workspaceRoot)
    return deny("Approval does not belong to the expected live acceptance run");
  if (subject.toolName !== "bash_run" || !subject.id || !subject.toolCallId)
    return deny("Unsupported acceptance approval effect");
  if (!subject.cwd || !equal(subject.cwd, expected.workspaceRoot))
    return deny("Approval cwd is not the disposable workspace root");
  if (!/^forgeboard-qwen-none-\d{8}-\d{2}$/.test(path.basename(expected.workspaceRoot)))
    return deny("Workspace is not an explicitly disposable ForgeBoard acceptance root");
  const input = subject.input;
  if (!input || Object.keys(input).some(k => !["command", "timeout_secs"].includes(k)) ||
    (input.timeout_secs !== undefined && (!Number.isInteger(input.timeout_secs) || input.timeout_secs < 1 || input.timeout_secs > 300)))
    return deny("Unrecognized approval input");
  const command = input.command;
  if (typeof command !== "string" || command.length > 1024)
    return deny("Invalid approval command");
  const match = /^Set-Content -Path '([^'\r\n]+)' -Value 'hello' -Encoding utf8; Test-Path '\1'; Remove-Item '\1'$/.exec(command);
  if (!match) return deny("Command is outside the explicitly reviewed disposable probe grammar");
  const operand = match[1];
  if (/[\x00-\x1f*?\[\]:]/.test(operand) || path.isAbsolute(operand))
    return deny("Ambiguous or absolute probe operand");
  const target = path.resolve(subject.cwd, operand);
  targets.push(target);
  if (!equal(target, path.join(expected.workspaceRoot, "test.txt")) || operand !== "test.txt")
    return deny("Probe target escapes the explicitly reviewed scratch file");
  try {
    const root = await realpath(expected.workspaceRoot);
    if (!equal(root, expected.workspaceRoot) || (await lstat(expected.workspaceRoot)).isSymbolicLink())
      return deny("Disposable workspace resolves through a link");
    if (!(await lstat(path.join(root, ".git"))).isDirectory())
      return deny("Acceptance root is not its own scratch repository");
    try {
      await lstat(target);
      return deny("Probe target already exists; refusing to overwrite or delete existing data");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return { approved: true, targets, reason: "Exact task-related write/read/delete probe; absent literal test.txt inside the owned disposable workspace; no wildcard/recursion/force or permission change" };
  } catch (error) {
    return deny(`Filesystem safety could not be established: ${error.code ?? String(error)}`);
  }
}
