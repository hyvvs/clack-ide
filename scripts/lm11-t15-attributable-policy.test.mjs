import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(repo, 'src-tauri','target',
  'lm11-b01-b03-authenticated-webview-20261119','cases');
const caseId = 't15-policy-20261120014220207-206462d74cab';
const filename = path.join(base,caseId,'t15-attributable-policy.json');
const evidence = fs.readFileSync(filename);
const sha = data => createHash('sha256').update(data).digest('hex');
const report = JSON.parse(evidence.toString('utf8'));

test('sealed T15 clarification retains immutable old comparison and SHA-256', () => {
  assert.equal(sha(evidence),
    '9a5e1847bea233cedfa79324a21c5f3a80c4ece093f84f7dbb0c09683f11adf0');
  assert.equal(report.historicalComparatorsPreserved, true);
  for (const source of report.sources) {
    assert.match(source.file, /^cases\/fidelity-audit-\d{17}-[a-f0-9]{12}\/[a-z0-9-]+\.json$/);
    assert.equal(sha(fs.readFileSync(path.join(base, source.file.slice('cases/'.length)))),
      source.sha256);
  }
});

test('both independent cohorts preserve 9541 objects and all five scoped target/secret hashes', () => {
  assert.equal(report.samples.length, 2);
  for (const cohort of report.samples) {
    assert.equal(cohort.appStateUnchanged,true);
    assert.equal(cohort.scopedCredentialMetadataUnchanged,true);
    assert.equal(cohort.v3ScopedCredentialSecretFingerprintUnchanged,true);
    assert.equal(cohort.scopedTargetCountBefore,5);
    assert.equal(cohort.scopedTargetCountAfter,5);
  }
});

test('global keyring delta remains diagnostic, unattributed, not falsely identical', () => {
  assert.equal(report.scopedT15PolicySatisfied,true);
  assert.equal(report.globalWincredMetadataIdentical,false);
  assert.equal(report.foreignNetCountChange,-2);
  assert.equal(report.individualRemovedForeignCredentialOwnershipProven,false);
  assert.equal(report.acceptanceHarnessAttributionOfForeignCountChange,'unknown');
  assert.equal(report.noRawUnscopedTargetsOrSecretsCollected,true);
  assert.equal(report.samples[1].globalTargetCountBefore,46);
  assert.equal(report.samples[1].globalTargetCountAfter,44);
});
