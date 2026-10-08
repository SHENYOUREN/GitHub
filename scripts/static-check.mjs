import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pairs = [
  ['public/app.js', 'public/index.html'],
  ['public/agent.js', 'public/agent.html'],
];

const failures = [];

function fail(message) {
  failures.push(message);
}

for (const [scriptRel, htmlRel] of pairs) {
  const scriptPath = resolve(root, scriptRel);
  const htmlPath = resolve(root, htmlRel);
  try {
    execFileSync(process.execPath, ['--check', scriptPath], { stdio: 'pipe' });
  } catch (error) {
    fail(`${scriptRel}: JavaScript syntax check failed: ${error.stderr?.toString() || error.message}`);
  }

  const script = readFileSync(scriptPath, 'utf8');
  const html = readFileSync(htmlPath, 'utf8');
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  const idSet = new Set(ids);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const duplicate of new Set(duplicates)) fail(`${htmlRel}: duplicate id="${duplicate}"`);

  const selectors = [...script.matchAll(/\$\(["']#([^"']+)["']\)/g)].map((match) => match[1]);
  for (const selector of new Set(selectors)) {
    if (!idSet.has(selector)) fail(`${scriptRel}: selector #${selector} does not exist in ${htmlRel}`);
  }

  const iconRefs = [...html.matchAll(/src=["']\/assets\/icons\/([^"']+)["']/g)].map((match) => match[1]);
  for (const icon of new Set(iconRefs)) {
    const iconPath = resolve(root, 'node_modules', 'lucide-static', 'icons', icon);
    if (!existsSync(iconPath)) fail(`${htmlRel}: missing lucide icon ${icon}`);
  }
}

for (const required of [
  'README.md',
  'docs/HANDOFF.zh-CN.md',
  'docs/architecture.zh-CN.md',
  'docs/SELF-CHECK.zh-CN.md',
  'docs/WIN10-CHECK.zh-CN.md',
  'win10-install.bat',
  'win10-verify.bat',
  'win10-start.bat',
  'public/index.html',
  'public/agent.html',
]) {
  if (!existsSync(resolve(root, required))) fail(`required handoff file missing: ${required}`);
}

if (failures.length) {
  console.error('Static handoff checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Static handoff checks passed: JS syntax, DOM ids/selectors, icons, and required handoff files.');
