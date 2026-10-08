import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const mode = process.argv[2] ?? 'source';
if (!['source', 'compiled'].includes(mode)) {
  console.error('Usage: node scripts/run-tests.mjs <source|compiled>');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..');
const testDir = resolve(root, mode === 'compiled' ? '.build/test' : 'test');
const suffix = mode === 'compiled' ? '.test.js' : '.test.ts';
const files = readdirSync(testDir)
  .filter((name) => name.endsWith(suffix))
  .sort()
  .map((name) => resolve(testDir, name));

if (!files.length) {
  console.error(`No ${suffix} files found in ${testDir}`);
  process.exit(1);
}

const args = mode === 'source'
  ? ['--import', 'tsx', '--test', '--test-isolation=none', ...files]
  : ['--test', ...files];

const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
