// The portable CI gate runs both test frameworks with their own runners.
// Evidence-dependent acceptance checks are retained verbatim and run by
// `npm run test:evidence` (or the complete `npm test`). Missing authentic
// evidence remains a release blocker, never a passing test or a fixture.
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitest = 'node_modules/vitest/vitest.mjs';
const museReplay = 'scripts/muse-continuation-allocation-offline-20261104.test.ts';
const mixedVitest = [
  'src/test/hostedEgressIsolationGuard.test.ts',
  'src/modules/ai/lib/lm11ProductionSelectorExclusion.offline.test.tsx',
];
const mixedVitestEvidence = [
  'preserves independently frozen native report hashes during --offline-dry-run=probe',
  'preserves independently frozen native report hashes during --offline-dry-run=verify',
  'enumerates REAL production and legacy persisted IDs through normal selectors without ever registering synthetic fixture',
];
const nodeEvidenceFiles = [
  'scripts/lm11-t15-attributable-policy.test.mjs',
  'scripts/local-muse-one-host-sources.test.mjs',
];
const mixedNode = 'scripts/local-muse-crash-only-check.test.mjs';
const mixedNodeEvidence = [
  'read-only process/comm/socket mapping never calls Ollama HTTP',
  'mistaken model inventory check fails without sending HTTP',
  'stale run, bad PID or replaced process fails closed',
];

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const suffix = (names) => `(?:${names.map(escape).join('|')})$`;
// Parameterized Vitest titles can contain literal newlines. A dot-only
// matcher silently filters those unrelated cases, so span all characters.
const without = (names) => `^(?![\\s\\S]*${suffix(names)})[\\s\\S]*$`;

export function discoverNodeTests(directory = root) {
  const files = readdirSync(join(directory, 'scripts'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => `scripts/${entry.name}`).sort();
  return files.filter((file) => {
    const source = readFileSync(join(directory, file), 'utf8');
    const node = /(?:from\s*['"]node:test['"]|require\(\s*['"]node:test['"]\s*\))/.test(source);
    const vite = /(?:from\s*['"]vitest['"]|require\(\s*['"]vitest['"]\s*\))/.test(source);
    if (node === vite) throw new Error(`Ambiguous or missing test runner: ${file}`);
    return node;
  });
}

export function buildPlan(mode, nodeFiles = discoverNodeTests()) {
  if (!['all', 'portable', 'evidence'].includes(mode)) throw new Error(`Unknown test mode: ${mode}`);
  for (const file of [...nodeEvidenceFiles, mixedNode]) {
    if (!nodeFiles.includes(file)) throw new Error(`Missing registered evidence test: ${file}`);
  }
  const viteBase = [vitest, 'run', '--maxWorkers=4', '--exclude', 'src-tauri/target/**',
    ...nodeFiles.flatMap((file) => ['--exclude', file])];
  const nodeBase = ['--test', '--test-concurrency=4'];
  if (mode === 'all') return [viteBase, [...nodeBase, ...nodeFiles]];
  if (mode === 'portable') return [
    [...viteBase, '--exclude', museReplay, '--testNamePattern', without(mixedVitestEvidence)],
    [...nodeBase, ...nodeFiles.filter((file) => !nodeEvidenceFiles.includes(file) && file !== mixedNode)],
    // Node treats a matching parent suite as permission to run its children.
    // Use a separate positive selection rather than a broad negative filter.
    [...nodeBase, '--test-name-pattern=^standalone crash listener never reports readiness or starts inference$', mixedNode],
  ];
  return [
    [...viteBase, museReplay],
    [...viteBase, ...mixedVitest, '--testNamePattern', suffix(mixedVitestEvidence)],
    [...nodeBase, ...nodeEvidenceFiles],
    [...nodeBase, `--test-name-pattern=${suffix(mixedNodeEvidence)}`, mixedNode],
  ];
}

export function evidenceRequirements() {
  return [
    `${museReplay}: original November 3 Muse settings/calibration evidence (8 assertions)`,
    `${mixedVitest[0]}: independent historical native reports (2 assertions; real offline-dry-run and source guards stay in CI)`,
    `${mixedVitest[1]}: authenticated T15 BEFORE inventory and exact production/legacy stores (1 assertion; five deterministic selector tests stay in CI)`,
    `${nodeEvidenceFiles[0]}: immutable T15 policy report and linked cohorts (3 assertions)`,
    `${nodeEvidenceFiles[1]}: frozen mission evidence manifest (3 assertions)`,
    `${mixedNode}: frozen mission evidence manifest (3 assertions; standalone listener control stays in CI)`,
  ];
}

function main() {
  const [mode = 'all', ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Use npm exec -- vitest run <filters> for custom Vitest arguments.');
  const plan = buildPlan(mode);
  if (mode === 'portable') {
    const notice = [
      'EVIDENCE ACCEPTANCE NOT RUN — 20 authentic-evidence tests remain separately mandatory before release:',
      ...evidenceRequirements().map((requirement) => `- ${requirement}`),
      'Run npm run test:evidence with genuine evidence. No acceptance is inferred from portable CI.',
    ].join('\n');
    console.log(notice);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### ${notice}\n`);
  }
  let failed = false;
  for (const args of plan) {
    console.log(`\n[${mode}] node ${args.map(JSON.stringify).join(' ')}`);
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failed = true;
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
