import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DEFAULT_DEEPSEEK_WORKSPACE } from './workspace.js';

export interface DshHandshakeResult {
  connected: boolean;
  reply: string;
  sessionId: string | null;
  error: string | null;
}

export interface DshConnectOptions {
  timeoutMs?: number;
  workspaceRoot?: string;
}

export class DshHandshakeService {
  private busy = false;
  private linked = false;
  private sessionId: string | null = null;

  constructor(
    private readonly dshBin = resolveDshBin(),
    private readonly defaultWorkspaceRoot = process.env.DSH_WORKSPACE ?? DEFAULT_DEEPSEEK_WORKSPACE,
  ) {}

  openWindow(): boolean {
    const script = process.env.DSH_POPUP_SCRIPT ?? 'D:\\AI工作区\\dsh-web.ps1';
    if (!existsSync(script)) return false;
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    try {
      const child = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Popup'], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
      child.on('error', () => undefined);
      child.unref();
      return true;
    } catch {
      return false;
    }
  }

  isLinked() {
    return this.linked;
  }

  reset() {
    this.linked = false;
    this.sessionId = null;
  }

  async connect(options: DshConnectOptions = {}): Promise<DshHandshakeResult> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const workspaceRoot = options.workspaceRoot?.trim() || this.defaultWorkspaceRoot;
    if (this.busy) return { connected: false, reply: '', sessionId: this.sessionId, error: 'handshake_in_progress' };
    if (!existsSync(this.dshBin)) return { connected: false, reply: '', sessionId: null, error: 'dsh_headless_not_found' };
    this.busy = true;
    try {
      mkdirSync(workspaceRoot, { recursive: true });
      this.openWindow();
      const run = await this.run(['--profile', 'headless', '--json', '这是中转站连接握手。请不要执行任何任务，只回复：我已链接'], timeoutMs, workspaceRoot);
      const events = run.stdout.split(/\r?\n/).flatMap((line) => {
        try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; }
      });
      const session = events.find((event) => event.type === 'session');
      const final = [...events].reverse().find((event) => event.type === 'final');
      const reply = typeof final?.text === 'string' ? final.text.trim() : '';
      const connected = run.code === 0 && reply.includes('我已链接');
      this.linked = connected;
      this.sessionId = typeof session?.sessionId === 'string' ? session.sessionId : null;
      return {
        connected,
        reply,
        sessionId: this.sessionId,
        error: connected ? null : run.timedOut ? 'handshake_timeout' : run.stderr.trim() || 'unexpected_handshake_reply',
      };
    } catch (error) {
      return {
        connected: false,
        reply: '',
        sessionId: null,
        error: error instanceof Error ? error.message : 'workspace_prepare_failed',
      };
    } finally {
      this.busy = false;
    }
  }

  private run(args: string[], timeoutMs: number, workspaceRoot: string): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [this.dshBin, ...args], {
        cwd: workspaceRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (result: { code: number; timedOut: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ...result, stdout, stderr });
      };
      const timer = setTimeout(() => {
        child.kill();
        finish({ code: -1, timedOut: true });
      }, timeoutMs);
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => { stdout += chunk; });
      child.stderr?.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => { stderr += error.message; finish({ code: -1, timedOut: false }); });
      child.on('exit', (code) => finish({ code: code ?? -1, timedOut: false }));
    });
  }
}

function resolveDshBin() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN;
  const npxRoot = join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx');
  try {
    const candidates: Array<{ bin: string; version: string }> = [];
    for (const entry of readdirSync(npxRoot)) {
      const candidate = join(npxRoot, entry, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      const packageJson = join(npxRoot, entry, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
      if (!existsSync(candidate) || !existsSync(packageJson)) continue;
      try {
        const metadata = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: unknown };
        candidates.push({ bin: candidate, version: typeof metadata.version === 'string' ? metadata.version : '' });
      } catch {
        candidates.push({ bin: candidate, version: '' });
      }
    }
    const preferredVersion = process.env.DSH_VERSION ?? '0.2.0-rc.2';
    const preferred = candidates.find((candidate) => candidate.version === preferredVersion);
    if (preferred) return preferred.bin;
    const newest = candidates.sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true })).at(-1);
    if (newest) return newest.bin;
  } catch {
    // The API returns a clear unavailable state if DSH is not installed here.
  }
  return join(npxRoot, 'missing', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
}
