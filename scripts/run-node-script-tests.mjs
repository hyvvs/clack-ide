// CI/standalone Node test owner. Vitest excludes the SAME source-marked
// node:test suites (see vite.config.ts) but retains its Vitest *.test.mjs.
// Discover new tests automatically instead of silently leaving them unrun.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
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
if (selected.length === 0) {
  process.stderr.write('No node:test script suites discovered; fail CI closed.\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`NODE_NATIVE_SCRIPT_TEST_FILES=${selected.length}\n`);
  const result = spawnSync(process.execPath, ['--test', ...selected], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  });
  if (result.error) {
    process.stderr.write(`Node test runner unavailable: ${result.error.message}\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
