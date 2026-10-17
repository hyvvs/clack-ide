import { createHash } from "node:crypto";
import { lstat, realpath, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { inspectAcceptanceShellEffects } from "./acceptance-approval.mjs";

export const correctionText = "Change the task page size requirement from 50 to 25. The new value supersedes 50 everywhere. Continue the same project and do not restart from scratch.";
const digest = value => createHash("sha256").update(value).digest("hex");
const page50 = text => !/(?:50[^\n]{0,40}(?:superseded|replaced)[^\n]{0,20}25|25[^\n]{0,40}supersedes[^\n]{0,20}50)/i.test(text) &&
  (/\b(?:page[\s_-]*size|per[\s_-]*page)\b["'`\s]*(?:(?:[:=]|of|is|at|to|equals|default)\s*)?["'`\s]*50\b/i.test(text) ||
    /\b50\s*(?:\/|per\s+)\s*page\b/i.test(text) ||
    /\bpaginat\w*\s*[:=(]?\s*50\b/i.test(text) ||
    /\b(?:paginat\w*|tasks?)\b[^\n\r.;]{0,50}\blimit\s*[:=]\s*50\b/i.test(text));
const normalize = text => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

async function projectFile(root, operand) {
  if (typeof operand !== "string" || /[\x00-\x1f*?[\]~$%]/.test(operand) || /^(?:\\\\|\/\/)/.test(operand)) throw new Error("Nonliteral project path");
  const target = path.resolve(root, operand);
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Not a workspace file");
  for (const segment of relative.split(path.sep)) {
    if (segment.includes(":") || /[. ]$/.test(segment) || /^(?:\.git|\.ssh|\.aws|\.azure|\.gnupg|\.env.*|credentials|models|node_modules)$/i.test(segment)) throw new Error("Excluded evidence path");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1) || await realpath(current) !== current) throw new Error("Linked evidence path");
    if (info.isDirectory()) {
      try { await lstat(path.join(current, ".git")); throw new Error("Nested repository"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const info = await lstat(target);
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Not a bounded ordinary file");
  const content = await readFile(target, "utf8");
  return { path: target, sha256: digest(content), bytes: info.size, content };
}

export async function confirmedWrite(root, part) {
  const output = part.output;
  if (!part.toolCallId || part.state !== "output-available" || !output || output.error || output.queued_for_plan_review) return undefined;
  let files = [];
  if (["tool-write_file", "tool-edit", "tool-multi_edit"].includes(part.type)) {
    if (output.ok !== true || output.clackWorkspaceWrite !== true || !Number.isSafeInteger(output.bytesWritten) || output.bytesWritten < 0) return undefined;
    files = [await projectFile(root, output.path)];
    if (part.type === "tool-write_file" && files[0].content !== part.input?.content) return undefined;
  } else if (part.type === "tool-bash_run") {
    if (output.exit_code !== 0 || output.timed_out !== false || output.truncated !== false || typeof output.stderr !== "string" || typeof output.stdout !== "string" || output.stderr.trim() || output.command !== part.input?.command) return undefined;
    // Relative paths are only interpretable when the persistent shell stayed at root.
    if (path.resolve(output.cwd_after ?? "") !== path.resolve(root)) return undefined;
    const effects = await inspectAcceptanceShellEffects(output.command);
    for (let index = 0; index < effects.length; index++) {
      const effect = effects[index];
      if (!["write", "append", "create"].includes(effect.operation) || (effect.operation === "create" && effect.itemType !== "file")) continue;
      if (effect.errorAction?.toLowerCase() === "silentlycontinue") continue;
      const file = await projectFile(root, effect.operand);
      if (effects.slice(index + 1).some(e => path.resolve(root, e.operand) === file.path && ["write", "append", "create", "delete"].includes(e.operation))) continue;
      const actual = normalize(file.content);
      const expected = normalize(effect.literalContent) + (effect.noNewline || effect.operation === "create" ? "" : "\n");
      if (effect.operation === "append" ? !actual.endsWith(expected) : actual !== expected) continue;
      files.push(file);
    }
  }
  if (!files.length) return undefined;
  return { toolCallId: part.toolCallId, type: part.type, inputSha256: digest(JSON.stringify(part.input)), at: Date.now(),
    files: files.map(({ content: _content, ...file }) => file) };
}

export async function currentPage50(root, writes, plan) {
  const todo = plan.find(t => !["cancelled", "interrupted", "failed"].includes(t.status) && page50(`${t.title}\n${t.description ?? ""}`));
  if (todo) return { kind: "current-accepted-plan", todo: structuredClone(todo), planSha256: digest(JSON.stringify(plan)) };
  for (const target of new Set(writes.flatMap(w => w.files.map(f => f.path)))) {
    if (!/\.(?:[cm]?[jt]sx?|json|ya?ml)$/i.test(target) || /[\\/]docs?[\\/]/i.test(target)) continue;
    try {
      const file = await projectFile(root, target);
      const line = file.content.split(/\r?\n/).find(line => page50(line));
      if (line) return { kind: "current-authored-code", path: file.path, sha256: file.sha256, line: line.slice(0, 512) };
    } catch { /* Missing or replaced evidence is not current implementation. */ }
  }
  return undefined;
}

export function createCorrectionObserver(root, checkpoint) {
  let state;
  let serial = Promise.resolve();
  const save = async () => {
    await writeFile(`${checkpoint}.tmp`, JSON.stringify(state));
    await rename(`${checkpoint}.tmp`, checkpoint);
  };
  return request => {
    const result = serial.then(async () => {
      if (!state) {
        try { state = JSON.parse(await readFile(checkpoint, "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        state ??= { version: 1, root, sessionId: "real-mission-a", writes: [], status: "pending" };
        if (state.version !== 1 || state.root !== root || state.sessionId !== request.sessionId || !Array.isArray(state.writes) || !["pending", "dispatching", "sent"].includes(state.status)) throw new Error("Invalid correction checkpoint");
      }
      if (request.sessionId !== state.sessionId) throw new Error("Correction owner mismatch");
      if (request.action === "dispatch") {
        if (!state.boundary || state.status !== "pending") return { ...state, claimed: false };
        state.status = "dispatching";
        state.dispatchAt = Date.now();
        await save();
        return { ...state, claimed: true };
      }
      if (request.action !== "observe") throw new Error("Unknown correction action");
      if (request.messageId) {
        if (state.messageId && state.messageId !== request.messageId) throw new Error("Duplicate correction message");
        state.status = "sent";
        state.messageId = request.messageId;
        state.sentAt ??= Date.now();
      }
      if (state.status === "pending") {
        if (!Array.isArray(request.parts) || request.parts.length > 2048 || !Array.isArray(request.plan) || request.plan.length > 16) throw new Error("Correction observation exceeds bound");
        for (const part of request.parts) {
          if (state.writes.some(w => w.toolCallId === part.toolCallId)) continue;
          let write;
          try { write = await confirmedWrite(root, part); } catch { /* Unconfirmed effects never count. */ }
          if (write) state.writes.push(write);
          if (state.writes.length > 512) throw new Error("Write observation bound exceeded");
        }
        const page = await currentPage50(root, state.writes, request.plan);
        if (!state.boundary && state.writes.length >= 3 && page) state.boundary = { at: Date.now(), writes: structuredClone(state.writes), thresholdEvent: state.writes[2], page };
      }
      await save();
      return structuredClone(state);
    });
    serial = result.catch(() => {});
    return result;
  };
}
