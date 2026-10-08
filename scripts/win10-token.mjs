import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dataDir = resolve(root, 'data');
const tokenPath = resolve(dataDir, 'controller-token.txt');
mkdirSync(dataDir, { recursive: true });

let token = '';
if (existsSync(tokenPath)) {
  token = readFileSync(tokenPath, 'utf8').trim();
}
if (!/^[0-9a-f]{64}$/i.test(token)) {
  token = randomBytes(32).toString('hex');
  writeFileSync(tokenPath, `${token}\n`, 'utf8');
  console.error(`Created local controller token: ${tokenPath}`);
}
process.stdout.write(token);
