import { createServer } from 'node:net';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];
const warnings = [];
const isWindows = process.platform === 'win32';

const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

function versionTuple(version) {
  return version.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
}
function atLeast(current, wanted) {
  for (let i = 0; i < Math.max(current.length, wanted.length); i += 1) {
    const a = current[i] ?? 0; const b = wanted[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

if (isWindows && !atLeast(versionTuple(process.version), [22, 19, 0])) {
  fail(`Node ${process.version} is too old for the supported Win10 runtime; install Node 22.19+.`);
} else if (!isWindows && !atLeast(versionTuple(process.version), [22, 19, 0])) {
  warn(`Current audit host is ${process.platform} with Node ${process.version}; Win10 target remains Node 22.19+.`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const scriptText = Object.values(packageJson.scripts ?? {}).join('\n');
const posixOnly = /(^|[;&|\s])(rm|cp|mv|chmod|chown|bash|zsh|sh|export)(?=\s|$)/m;
if (posixOnly.test(scriptText)) fail('package.json contains a POSIX-only shell command in npm scripts.');
if (scriptText.includes('*.test.')) fail('npm scripts still depend on shell wildcard expansion for tests.');

for (const required of ['win10-install.bat', 'win10-verify.bat', 'win10-start.bat', 'scripts/run-tests.mjs', 'scripts/win10-token.mjs']) {
  if (!existsSync(resolve(root, required))) fail(`missing Windows helper: ${required}`);
}

for (const rel of ['scripts/controller-heartbeat.mjs', 'dsh-session-bridge/client.js']) {
  const content = readFileSync(resolve(root, rel), 'utf8');
  if (content.includes('127.0.0.1:4311')) fail(`${rel} still points at obsolete task-room port 4311; Win10 relay uses 4310.`);
}

for (const doc of ['README.md', 'docs/HANDOFF.zh-CN.md']) {
  const content = readFileSync(resolve(root, doc), 'utf8');
  if (/\$env:CONTROLLER_TOKEN\s*=.*ToHexString/.test(content)) {
    fail(`${doc} still contains an executable ToHexString token command, which is not safe for stock Windows PowerShell 5.1.`);
  }
}

const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const invalidChars = /[<>:"/\\|?*]/;
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.build', 'data'].includes(item.name)) continue;
    const full = join(dir, item.name);
    const rel = relative(root, full);
    if (invalidChars.test(item.name) || /[ .]$/.test(item.name) || reserved.test(item.name)) {
      fail(`Windows-invalid file name: ${rel}`);
    }
    if (rel.length > 180) warn(`Long relative path (${rel.length} chars): ${rel}`);
    if (item.isDirectory()) walk(full);
  }
}
walk(root);

// Exercise the exact write -> rename pattern used by persisted JSON stores.
const tempRoot = mkdtempSync(join(tmpdir(), 'a2a-win-compat-'));
try {
  const unicodeDir = join(tempRoot, '中文路径');
  mkdirSync(unicodeDir, { recursive: true });
  const dest = join(unicodeDir, '状态.json');
  const temp = `${dest}.tmp`;
  writeFileSync(dest, '{"version":1}', 'utf8');
  writeFileSync(temp, '{"version":2}', 'utf8');
  renameSync(temp, dest);
  if (readFileSync(dest, 'utf8') !== '{"version":2}') fail('Unicode file persistence/replace round-trip failed.');
} catch (error) {
  fail(`File persistence compatibility check failed: ${error.message}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (isWindows) {
  const configPath = resolve(root, 'data', 'execution-config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      if (config.workspaceRoot && !existsSync(config.workspaceRoot)) {
        warn(`Configured workspace does not currently exist: ${config.workspaceRoot}`);
      }
    } catch {
      warn('Could not parse data/execution-config.json while checking workspace path.');
    }
  } else if (!existsSync('D:\\GPT工作室\\执行端文件夹\\deepseek执行端')) {
    warn('Default DeepSeek workspace D:\\GPT工作室\\执行端文件夹\\deepseek执行端 does not exist on this machine yet; choose the real workspace in the web UI before execution.');
  }

  const port = Number.parseInt(process.env.PORT ?? '4310', 10);
  const portCheck = await new Promise((finish) => {
    const server = createServer();
    server.once('error', (error) => finish({ ok: false, error }));
    server.listen(port, '127.0.0.1', () => server.close(() => finish({ ok: true })));
  });
  if (!portCheck.ok) warn(`Port ${port} is already in use; starting another task-room instance may fail.`);
} else {
  warn('Dynamic Windows-only checks (Win32 port/workspace behavior) cannot execute on this Linux audit host.');
}

for (const message of warnings) console.warn(`WARN: ${message}`);
if (failures.length) {
  console.error('Windows compatibility checks failed:');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`Windows compatibility checks passed (${isWindows ? 'dynamic Win32 + static' : 'static/cross-platform'}).`);
