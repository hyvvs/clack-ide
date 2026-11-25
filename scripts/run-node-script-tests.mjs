// CI/standalone Node test owner. Vitest excludes the SAME source-marked
// node:test suites (see vite.config.ts) but retains its Vitest *.test.mjs.
// Discover new tests automatically instead of silently leaving them unrun.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// These exact historical acceptance tests require evidence deliberately
// stored outside Git under src-tauri/target/. They must NOT be treated as
// portable fixture tests or silently marked PASS when that evidence is absent.
// Ordinary CI records NOT_RUN for these historical checks. The strict
// --evidence-bound command is for a trusted checkout with original evidence.
const evidenceBound = new Set([
  'scripts/lm11-t15-attributable-policy.test.mjs',
  'scripts/local-muse-crash-only-check.test.mjs',
  'scripts/local-muse-one-host-sources.test.mjs',
]);
// This file also contains an independent source-only regression. Keep it
// in portable CI even though its other three tests require the manifest.
const mixedSuite = 'scripts/local-muse-crash-only-check.test.mjs';
const portableMixedTest = '^standalone crash listener never reports readiness or starts inference$';
const scope = process.argv.length === 3 && process.argv[2] === '--portable'
  ? 'portable'
  : process.argv.length === 3 && process.argv[2] === '--evidence-bound'
    ? 'evidence-bound'
    : process.argv.length === 2 ? 'all' : null;
if (!scope) {
  process.stderr.write('Usage: node scripts/run-node-script-tests.mjs [--portable|--evidence-bound]\n');
  process.exit(2);
}
const selected = [];
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.isFile() && entry.name.endsWith('.test.mjs') &&
        readFileSync(full, 'utf8').includes('node:test')) {
      selected.push(relative(root, full));
    }
  }
}
visit(join(root, 'scripts'));
selected.sort();
const normalized = selected.map((s) => s.replaceAll('\\', '/'));
const missingClassified = [...evidenceBound].filter((name) => !normalized.includes(name));
if (missingClassified.length > 0) {
  process.stderr.write(`Historical evidence suite missing: ${missingClassified.join(', ')}\n`);
  process.exit(2);
}
const files = selected.filter((f) => {
  const evidence = evidenceBound.has(f.replaceAll('\\', '/'));
  return scope === 'all' || (scope === 'evidence-bound' ? evidence : !evidence);
});
if (files.length === 0) {
  process.stderr.write('No node:test script suites discovered; fail CI closed.\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`NODE_NATIVE_SCRIPT_SCOPE=${scope} FILES=${files.length} TOTAL=${selected.length}\n`);
  function run(args, requireOneMatch = false) {
    const result = spawnSync(process.execPath, ['--test', ...args], {
      cwd: root, stdio: requireOneMatch ? 'pipe' : 'inherit',
      encoding: requireOneMatch ? 'utf8' : undefined,
      windowsHide: true,
    });
    if (requireOneMatch) {
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    if (result.error) {
      process.stderr.write(`Node test runner unavailable: ${result.error.message}\n`);
      return 1;
    }
    if (requireOneMatch && (!/^# pass\s+1\s*$/m.test(result.stdout ?? '') ||
        !/^# fail\s+0\s*$/m.test(result.stdout ?? ''))) {
      process.stderr.write('Portable mixed Node test did not execute exactly one passing test.\n');
      return 1;
    }
    return result.status ?? 1;
  }
  let status = run(files);
  if (scope === 'portable') {
    const mixedStatus = run(['--test-name-pattern', portableMixedTest, mixedSuite], true);
    status ||= mixedStatus;
    process.stdout.write('HISTORICAL_ACCEPTANCE=NOT_RUN (requires original evidence; run --evidence-bound separately)\n');
  }
  process.exitCode = status;
}
