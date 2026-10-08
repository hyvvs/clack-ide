import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { frontendFiles } from "./q1-manifest.mjs";
import { summarize, markdown } from "./q1-report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "clack-q1-"));
const corpus = JSON.parse(readFileSync(join(root, "src/modules/ai/quality/corpus.json"), "utf8"));
const run = (command, args, cwd = root, env = process.env, quiet = false) => {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 300000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  process.stdout.write(quiet && result.status === 0
    ? (result.stdout ?? "").split("\n").filter(line => line.startsWith("test result:")).join("\n") + "\n"
    : result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  return result;
};
try {
  // Direct node invocation avoids Windows batch-shell argument quoting.
  const frontend = run(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", ...frontendFiles, "--maxWorkers=4", "--reporter=json", `--outputFile=${join(temp, "vitest.json")}`], root, { ...process.env, CLACK_Q1_METRICS_DIR: temp });
  const rust = run("cargo", ["test", "--locked"], join(root, "src-tauri"), process.env, true);
  const measurements = Object.fromEntries(readdirSync(temp).filter(name => /^[A-L]\.json$/.test(name)).map(name => [name[0], JSON.parse(readFileSync(join(temp, name), "utf8"))]));
  let vitest = { success: false, testResults: [] };
  try { vitest = JSON.parse(readFileSync(join(temp, "vitest.json"), "utf8")); } catch { /* Missing report is a failed gate. */ }
  const report = summarize(vitest, `${rust.stdout ?? ""}\n${rust.stderr ?? ""}`, measurements);
  if (frontend.status !== 0 || rust.status !== 0) report.status = "failed";
  report.fixtureVersion = corpus.version;
  for (const scenario of report.scenarios) scenario.fixtureVersion = corpus.version;
  report.corpusSha256 = createHash("sha256").update(JSON.stringify(corpus)).digest("hex");
  report.sourceSignatures = Object.fromEntries([...frontendFiles, "src/modules/ai/lib/conversationCompaction.fixture.ts", "src/modules/ai/lib/conversationRetrieval.ts", "src/modules/ai/quality/oracle.ts", "scripts/q1-manifest.mjs", "scripts/q1-report.mjs", "scripts/q1-quality.mjs"].map(name => [name, createHash("sha256").update(readFileSync(join(root, name))).digest("hex")]));
  report.testedBaseCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout?.trim() ?? "unknown";
  report.host = `${process.platform}/${process.arch}`;
  report.adapterVersions = Object.fromEntries(["ai", "@ai-sdk/openai", "@ai-sdk/anthropic", "@ai-sdk/google"].map(name => [name, JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version]));
  report.fixtureMetadata = { quantization: "not applicable: deterministic model fixtures", deployedContext: "per-scenario recorded limits", credentials: "synthetic placeholders only", preparationClock: "fixed 1420; no benchmark claim", manualPins: "fixture-only context bounds", permissionVersions: "existing T1/T2/T3/F1 fixtures", runtimeMilliseconds: vitest.testResults?.map(f => ({ file: f.name.replaceAll("\\", "/").replace(`${root.replaceAll("\\", "/")}/`, ""), elapsed: f.endTime - f.startTime })) };
  writeFileSync(join(root, "docs/Q1_EVIDENCE.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(root, "docs/Q1_EVIDENCE.md"), markdown(report));
  console.log(`Q1 ${report.status}: frontend ${report.frontend.passed ?? 0}; Rust ${report.rust.passed}. Evidence: docs/Q1_EVIDENCE.{json,md}`);
  process.exitCode = report.status === "passed" ? 0 : 1;
} finally {
  // Only remove the exact directory this runner created.
  if (dirname(temp) === tmpdir() && temp.startsWith(join(tmpdir(), "clack-q1-"))) rmSync(temp, { recursive: true, force: true });
}
