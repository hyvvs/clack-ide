import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const prod = read('src-tauri/src/lib.rs');
const forgeboard = read('src-tauri/examples/forgeboard_muse_instrumented_20261104.rs');
const native = read('src/modules/ai/lib/native.ts');
const checkpoint = read('src/modules/ai/lib/writeCheckpoint.ts');

const recoveryHandlers = [
  'shell::verification::agent_workspace_fingerprint',
  'modules::conversation_memory::checkpoint::conversation_checkpoint_observe',
  'modules::conversation_memory::checkpoint::conversation_checkpoint_prepare',
  'modules::conversation_memory::checkpoint::conversation_checkpoint_validate',
];

function handlers(source) {
  const block = /Box::new\(tauri::generate_handler!\[([\s\S]*?)\]\)/.exec(source);
  assert.ok(block, 'Tauri native command registry must exist');
  return new Set([...block[1].matchAll(/^\s*((?:\w+::)+\w+),\s*$/gm)]
    .map((match) => match[1]));
}

test('ForgeBoard acceptance host has the full production native Agent recovery contract', () => {
  const prodCommands = handlers(prod);
  const hostCommands = handlers(forgeboard);
  for (const handler of recoveryHandlers) {
    const hostHandler = handler.replace(/^modules::conversation_memory/, 'memory');
    assert.ok(prodCommands.has(handler), `production no longer registers ${handler}`);
    assert.ok(hostCommands.has(hostHandler), `acceptance host missing ${hostHandler}`);
  }
  assert.match(native, /invoke<[^\n]+>\("agent_workspace_fingerprint"/);
  for (const command of [
    'conversation_checkpoint_observe',
    'conversation_checkpoint_prepare',
    'conversation_checkpoint_validate',
  ]) assert.ok(checkpoint.includes(`invoke("${command}"`), `client must invoke ${command}`);
});

test('the original unregistered fingerprint defect is detected, not silently mocked', () => {
  const broken = new Set(handlers(forgeboard));
  broken.delete('shell::verification::agent_workspace_fingerprint');
  assert.equal(broken.has('shell::verification::agent_workspace_fingerprint'), false);
  assert.ok(handlers(prod).has('shell::verification::agent_workspace_fingerprint'));
});
