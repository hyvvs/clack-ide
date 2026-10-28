import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const equal = (a, b) => process.platform === "win32"
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b);
const inside = (root, target) => !equal(root, target) && !path.relative(root, target).startsWith(`..${path.sep}`) &&
  path.relative(root, target) !== ".." && !path.isAbsolute(path.relative(root, target));
const helper = fileURLToPath(new URL("./acceptance-powershell-effects.ps1", import.meta.url));
const executable = process.platform === "win32"
  ? path.join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe") : "pwsh";

function inspectPowerShell(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", helper], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "", settled = false;
    const finish = failure => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failure) reject(failure);
      else { try { resolve(JSON.parse(output)); } catch { reject(new Error("Invalid parser response")); } }
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("PowerShell inspection timed out")); }, 5000);
    child.once("error", finish);
    child.stdin.on("error", finish);
    child.stdout.on("data", bytes => {
      output += bytes;
      if (output.length > 1024 * 1024) { child.kill(); finish(new Error("Inspection response exceeds bound")); }
    });
    child.stderr.on("data", bytes => { error = (error + bytes).slice(-4096); });
    child.once("close", code => finish(code === 0 ? null : new Error(error || `Parser exited ${code}`)));
    child.stdin.end(JSON.stringify(request));
  });
}

const contracts = {
  "remove-item": { operation: "delete", switches: ["recurse", "force"], values: ["path", "literalpath", "erroraction"] },
  "set-content": { operation: "write", switches: ["force", "nonewline"], values: ["path", "literalpath", "value", "encoding", "erroraction"] },
  "add-content": { operation: "append", switches: ["force", "nonewline"], values: ["path", "literalpath", "value", "encoding", "erroraction"] },
  "new-item": { operation: "create", switches: ["force"], values: ["path", "itemtype", "value", "erroraction"] },
  "get-content": { operation: "read", switches: ["raw"], values: ["path", "literalpath", "erroraction"] },
  "test-path": { operation: "test", switches: [], values: ["path", "literalpath", "erroraction"] },
  "out-file": { operation: "write", switches: ["force", "append", "nonewline", "noclobber"], values: ["filepath", "literalpath", "encoding", "erroraction"] },
};
function bind(elements, includeContent = false) {
  if (elements[0]?.kind !== "literal") throw new Error("Literal cmdlet required");
  const name = elements[0].value.toLowerCase();
  const contract = Object.hasOwn(contracts, name) ? contracts[name] : undefined;
  if (!contract) throw new Error(`Unrecognized operation: ${name}`);
  const args = {};
  let pipelineInput;
  for (let index = 1; index < elements.length; index++) {
    const element = elements[index];
    if (element.kind === "pipeline-input") {
      if (!["set-content", "add-content", "out-file"].includes(name) || pipelineInput || !Array.isArray(element.value) || !element.value.every(v => typeof v === "string")) throw new Error("Unsupported pipeline input");
      pipelineInput = element.value;
      continue;
    }
    if (element.kind === "literal") {
      if (args.path || args.literalpath) throw new Error("Ambiguous positional operand");
      args.path = element.value;
      continue;
    }
    const key = element.value.toLowerCase();
    if (Object.hasOwn(args, key)) throw new Error("Duplicate parameter");
    if (contract.switches.includes(key)) args[key] = true;
    else if (contract.values.includes(key) && elements[index + 1]?.kind === "literal") args[key] = elements[++index].value;
    else throw new Error(`Unsupported parameter: ${key}`);
  }
  if ([args.path, args.filepath, args.literalpath].filter(v => v !== undefined).length !== 1) throw new Error("One literal path required");
  if (args.erroraction && !["stop", "continue", "silentlycontinue"].includes(args.erroraction.toLowerCase())) throw new Error("Unsupported error policy");
  if (args.encoding && !["utf8", "utf8nobom", "ascii"].includes(args.encoding.toLowerCase())) throw new Error("Unsupported encoding");
  if (pipelineInput && args.value !== undefined) throw new Error("Ambiguous explicit and piped content");
  if (["write", "append"].includes(contract.operation) && args.value === undefined && !pipelineInput) throw new Error("Literal content required");
  if (contract.operation === "create" && !["file", "directory"].includes(args.itemtype?.toLowerCase())) throw new Error("Only ordinary file/directory creation supported");
  return { command: name, operation: args.append ? "append" : contract.operation, operand: args.path ?? args.filepath ?? args.literalpath,
    recursive: args.recurse === true, force: args.force === true, itemType: args.itemtype?.toLowerCase(),
    contentBytes: pipelineInput ? Buffer.byteLength(pipelineInput.join("\n")) : args.value === undefined ? undefined : Buffer.byteLength(args.value),
    ...(includeContent ? { literalContent: pipelineInput ? pipelineInput.join(args.nonewline ? "" : "\n") : args.value ?? "", noNewline: args.nonewline === true, errorAction: args.erroraction } : {}) };
}

// Read-only reuse of the same bounded AST parser; this does not approve or execute.
export async function inspectAcceptanceShellEffects(command) {
  if (typeof command !== "string" || !command.length || command.length > 16384 || /[\x00-\x1f]/.test(command)) throw new Error("Invalid observation command");
  const parsed = await inspectPowerShell({ mode: "parse", command });
  if (!Array.isArray(parsed.commands) || !parsed.commands.length || parsed.commands.length > 16) throw new Error("Invalid parsed operations");
  return parsed.commands.map(elements => bind(elements, true));
}

// A point-in-time decision for a paused, isolated scratch run, not an OS sandbox.
export async function evaluateAcceptanceApproval(subject, expected) {
  const targets = [], effects = [];
  const deny = reason => ({ approved: false, reason, targets, effects });
  if (!expected || subject.sessionId !== expected.sessionId || subject.runId !== expected.runId || subject.workspaceRoot !== expected.workspaceRoot)
    return deny("Approval does not belong to the expected live acceptance run");
  if (subject.toolName !== "bash_run" || !subject.id || !subject.toolCallId ||
    !expected.approvals?.some(a => a.id === subject.id && a.toolCallId === subject.toolCallId && a.toolName === subject.toolName && JSON.stringify(a.input) === JSON.stringify(subject.input)))
    return deny("Approval is not the registered pending production effect");
  if (!subject.cwd || !equal(subject.cwd, expected.workspaceRoot)) return deny("Approval cwd is not the disposable workspace root");
  if (!path.isAbsolute(expected.workspaceRoot) || !/^(?:remote-notes-control-20261028-01|forgeboard-(?:qwen-none|qwen3coder|qwen38-iq4xs|devstral|muse-glimmer|north-mini-code|nemotron35-lightning)-\d{8}-\d{2})$/.test(path.basename(expected.workspaceRoot)))
    return deny("Workspace is not an explicitly disposable ForgeBoard acceptance root");
  const input = subject.input;
  if (!input || Object.keys(input).some(k => !["command", "timeout_secs"].includes(k)) ||
    (input.timeout_secs !== undefined && (!Number.isInteger(input.timeout_secs) || input.timeout_secs < 1 || input.timeout_secs > 300))) return deny("Unrecognized approval input");
  if (typeof input.command !== "string" || !input.command.length || input.command.length > 16384 || /[\x00-\x1f]/.test(input.command)) return deny("Invalid approval command");
  try {
    const root = await realpath(expected.workspaceRoot);
    if (!equal(root, expected.workspaceRoot) || (await lstat(expected.workspaceRoot)).isSymbolicLink()) throw new Error("Disposable root resolves through a link");
    const git = await lstat(path.join(root, ".git"));
    if (!git.isDirectory() || git.isSymbolicLink()) throw new Error("Scratch root must own ordinary Git metadata");
    const parsed = await inspectPowerShell({ mode: "parse", command: input.command });
    if (!Array.isArray(parsed.commands) || !parsed.commands.length || parsed.commands.length > 16) throw new Error("Invalid parsed operations");
    for (const command of parsed.commands) {
      const effect = bind(command);
      const operand = effect.operand;
      const segments = operand.split(/[\\/]/);
      if (!operand || (process.platform !== "win32" && operand.includes("\\")) || /[\x00-\x1f*?[\]~$%]/.test(operand) || /^(?:\\\\|\/\/)/.test(operand) ||
        (/^[A-Za-z]:/.test(operand) && !/^[A-Za-z]:[\\/]/.test(operand)) ||
        operand.replace(/^[A-Za-z]:/, "").includes(":") || segments.some(s => s === ".." || /[. ]$/.test(s) ||
          /^(?:\.git|\.ssh|\.aws|\.azure|\.gnupg|\.ollama|\.env.*|credentials|models)$/i.test(s) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) throw new Error("Ambiguous, secret or non-project path");
      const target = path.resolve(subject.cwd, operand);
      if (!inside(root, target)) throw new Error("Effect escapes scratch workspace or targets its root");
      targets.push(target);
      let current = root;
      for (const segment of path.relative(root, target).split(path.sep)) {
        current = path.join(current, segment);
        try {
          const info = await lstat(current);
          if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink > 1)) throw new Error("Linked or nonordinary effect target");
          if (!equal(await realpath(current), current)) throw new Error("Noncanonical effect ancestor");
          if (info.isDirectory()) {
            try { await lstat(path.join(current, ".git")); throw new Error("Nested repository boundary"); }
            catch (error) { if (error.code !== "ENOENT") throw error; }
          }
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      let existed = false;
      try { await lstat(target); existed = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
      effects.push({ ...effect, path: target, existedBeforeApproval: existed });
    }
    const inspected = await inspectPowerShell({ mode: "inspect", root, scopes: effects.map(e => ({ path: e.path, recursive: e.recursive || e.operation === "delete" })) });
    if (!Array.isArray(inspected.inspected) || inspected.inspected.length > 8192) throw new Error("Invalid filesystem inspection");
    for (const file of inspected.inspected) {
      if (!inside(root, file)) throw new Error("Inspection escapes scratch root");
      const info = await lstat(file);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) throw new Error("Linked subtree entry");
      if (!equal(await realpath(file), file)) throw new Error("Subtree resolves outside its literal scope");
      if (path.relative(root, file).split(path.sep).some(s => /^(?:\.ssh|\.aws|\.azure|\.gnupg|\.env.*|\.ollama|credentials|models)$/i.test(s))) throw new Error("Sensitive subtree entry");
    }
    return { approved: true, reason: "Every literal effect is canonically confined to the owned disposable ForgeBoard workspace; no links, wildcard scope or foreign repository", targets, effects, inspectedEntries: inspected.inspected.length };
  } catch (error) { return deny(`Filesystem/effect safety could not be established: ${error.message}`); }
}
