import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, discoverNodeTests, evidenceRequirements } from './test-execution-contract.mjs';

test('all mode retains every Node suite and does not filter Vitest acceptance', () => {
  const files = discoverNodeTests();
  const [vite, node] = buildPlan('all', files);
  assert.ok(files.length >= 23);
  for (const file of files) {
    assert.ok(vite.some((arg, index) => arg === '--exclude' && vite[index + 1] === file));
    assert.ok(node.includes(file));
  }
  assert.ok(!vite.includes('--testNamePattern'));
  assert.ok(!node.some((arg) => arg.startsWith('--test-name-pattern=')));
});

test('portable filters only named evidence checks and retains mixed deterministic controls', () => {
  const [vite, node, mixed] = buildPlan('portable');
  const vp = new RegExp(vite[vite.indexOf('--testNamePattern') + 1]);
  const np = new RegExp(mixed.find((arg) => arg.startsWith('--test-name-pattern=')).split('=').slice(1).join('='));
  assert.ok(!vp.test('suite > enumerates REAL production and legacy persisted IDs through normal selectors without ever registering synthetic fixture'));
  assert.ok(vp.test('suite > blocks --offline-dry-run=probe before settings, workspace, Vite and WebView startup'));
  assert.ok(vp.test('suite > blocks --offline-dry-run=verify before settings, workspace, Vite and WebView startup'));
  assert.ok(!vp.test('suite > preserves independently frozen native report hashes during --offline-dry-run=probe'));
  assert.ok(!vp.test('suite > preserves independently frozen native report hashes during --offline-dry-run=verify'));
  assert.ok(vp.test('suite > has no unsafe opt-in flag that silently turns the old dry-run back on'));
  assert.ok(vp.test('suite > positive detection control: the SAME normal selector and picker expose it only after an explicit in-memory attachment'));
  assert.ok(vp.test('suite > parameterized case {\n  field: "value"\n}'));
  assert.ok(!np.test('stale run, bad PID or replaced process fails closed'));
  assert.ok(np.test('standalone crash listener never reports readiness or starts inference'));
  assert.ok(!node.includes('scripts/local-muse-crash-only-check.test.mjs'));
  assert.ok(mixed.includes('scripts/local-muse-crash-only-check.test.mjs'));
  assert.ok(!node.some((arg) => arg.startsWith('--test-name-pattern=')));
  assert.ok(!node.includes('scripts/lm11-t15-attributable-policy.test.mjs'));
});

test('evidence mode retains every evidence source and rejects ambiguous invocation', () => {
  const plan = buildPlan('evidence');
  assert.equal(plan.length, 4);
  assert.equal(evidenceRequirements().length, 6);
  for (const file of [
    'scripts/muse-continuation-allocation-offline-20261104.test.ts',
    'src/test/hostedEgressIsolationGuard.test.ts',
    'src/modules/ai/lib/lm11ProductionSelectorExclusion.offline.test.tsx',
    'scripts/lm11-t15-attributable-policy.test.mjs',
    'scripts/local-muse-one-host-sources.test.mjs',
    'scripts/local-muse-crash-only-check.test.mjs',
  ]) assert.ok(plan.some((args) => args.includes(file)));
  assert.throws(() => buildPlan('unknown'));
  assert.throws(() => buildPlan('portable', []));
});
