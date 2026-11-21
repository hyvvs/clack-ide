/**
 * LM11 T15 policy clarification (never rewrites historical comparisons).
 * This compares only pre-existing immutable read-only snapshots; the wider
 * Windows Credential Manager target count is diagnostic, not an app authority.
 * No credential names, usernames, or secrets are read or serialized here.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = fs.realpathSync.native(path.join(repo, 'src-tauri', 'target',
  'lm11-b01-b03-authenticated-webview-20261119', 'cases'));
const audits = ['fidelity-audit-20261119164558080-66e12c0fff93',
  'fidelity-audit-20261119202821960-37b57bd5bf84'];
const sha = data => createHash('sha256').update(data).digest('hex');
function load(caseId, leaf) {
  if (!/^fidelity-audit-\d{17}-[a-f0-9]{12}$/.test(caseId) ||
      !/^[a-z0-9-]+\.json$/.test(leaf)) throw new Error('Unsafe evidence locator');
  const file = path.join(cases, caseId, leaf);
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())
    throw new Error('Redirected evidence');
  const bytes = fs.readFileSync(file);
  return { sha256: sha(bytes), file: `cases/${caseId}/${leaf}`,
    json: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) };
}
const evidence = [];
const results = audits.map(caseId => {
  const files = Object.fromEntries([
    'production-comparison', 'credential-manager-before', 'credential-manager-after',
    'credential-manager-comparison', 'credential-secret-v3-before',
    'credential-secret-v3-after', 'credential-secret-v3-comparison'
  ].map(name => [name, load(caseId, `${name}.json`)]));
  evidence.push(...Object.values(files).map(({ file, sha256 }) => ({ file, sha256 })));
  const a = files['credential-manager-before'].json;
  const b = files['credential-manager-after'].json;
  const v3a = files['credential-secret-v3-before'].json;
  const v3b = files['credential-secret-v3-after'].json;
  const metadata = rows => rows.map(r => `${r.targetHash}:${r.metadataHash}`).sort().join('|');
  const secrets = rows => rows.map(r =>
    `${r.targetHash}:${r.metadataHash}:${r.secretBlobHash}`).sort().join('|');
  const stableMetadata = a.scopedTargetCount === 5 && b.scopedTargetCount === 5 &&
    metadata(a.entries) === metadata(b.entries);
  const stableSecrets = v3a.scopedCredentialCount === 5 &&
    v3b.scopedCredentialCount === 5 && secrets(v3a.entries) === secrets(v3b.entries);
  const inventory = files['production-comparison'].json;
  const stableAppState = inventory.noninterferenceProven === true &&
    inventory.beforeEntries === 9541 && inventory.afterEntries === 9541 &&
    inventory.changedCount === 0 && inventory.beforeErrors === 0 &&
    inventory.afterErrors === 0;
  if (!stableMetadata || !stableSecrets || !stableAppState)
    throw new Error(`Clack/Terax scoped noninterference failed: ${caseId}`);
  return {
    caseId, appStateUnchanged: stableAppState,
    scopedCredentialMetadataUnchanged: stableMetadata,
    v3ScopedCredentialSecretFingerprintUnchanged: stableSecrets,
    scopedTargetCountBefore: a.scopedTargetCount,
    scopedTargetCountAfter: b.scopedTargetCount,
    globalTargetCountBefore: a.allTargetCount,
    globalTargetCountAfter: b.allTargetCount,
    globalTargetCountDiagnosticOnly: true,
    // No all-target hash snapshot was collected. Never pretend the physical
    // identities or owner processes of the net removed foreign entries exist.
    individualForeignTargetsIdentified: false,
    foreignProcessAttributionProven: false,
  };
});
const current = results[1];
if (current.globalTargetCountBefore !== 46 || current.globalTargetCountAfter !== 44)
  throw new Error('Wider Windows keyring diagnostic unexpectedly changed');
const report = {
  version: 1,
  policy: 'T15 tests attributable Clack/Terax-owned production state and credentials; unrelated global WinCred count is diagnostic, not an acceptance gate',
  historicalComparatorsPreserved: true,
  metadataScope: 'Only app-scoped targets in cmdkey snapshots, separately V3 exact-service secret fingerprints',
  noRawUnscopedTargetsOrSecretsCollected: true,
  samples: results, sources: evidence,
  scopedT15PolicySatisfied: true,
  globalWincredMetadataIdentical: false,
  foreignNetCountChange: -2,
  scopedDeletionsOrMutationsObserved: false,
  foreignTargetNamesOrHistoricalHashesAvailable: false,
  individualRemovedForeignCredentialOwnershipProven: false,
  acceptanceHarnessAttributionOfForeignCountChange: 'unknown',
  caveat: 'Net -2 foreign targets by aggregate counts and stable scoped hashes; individual unrelated targets and processes were not retained at BEFORE, so unique removal identity, cause and owner cannot be reconstructed; no claim of global unchanged keyring or proof of non-attribution.',
};
const name = 't15-policy-' + new Date().toISOString().replace(/[^0-9]/g,'') +
  '-' + randomBytes(6).toString('hex');
const dir = path.join(cases, name);
fs.mkdirSync(dir, { recursive: false });
const out = path.join(dir,'t15-attributable-policy.json');
const bytes = Buffer.from(JSON.stringify(report,null,2)+'\n');
const fd = fs.openSync(out,'wx',0o600);
try { fs.writeFileSync(fd,bytes);fs.fsyncSync(fd); } finally {fs.closeSync(fd);}
console.log(JSON.stringify({ file:out, sha256:sha(bytes),
  scopedPolicySatisfied:true,globalCountDrift:-2,attribution:'unknown' },null,2));
