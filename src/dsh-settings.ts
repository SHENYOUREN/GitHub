import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DEEPSEEK_WORKSPACE } from './workspace.js';

export interface DshSettingsSnapshot {
  available: boolean;
  provider: string | null;
  model: string | null;
  reasoningEffort: string | null;
  workspaceRoot: string;
  uiUrl: string;
  source: 'session-last-used' | 'profile-default' | 'fallback';
  sessionId: string | null;
}

export class DshSettingsReader {
  private runtimeCacheKey = '';
  private runtimeCache: { provider: string; model: string; reasoningEffort: string | null; sessionId: string } | null = null;

  constructor(
    private readonly home = process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    private readonly workspaceRoot = process.env.DSH_WORKSPACE ?? DEFAULT_DEEPSEEK_WORKSPACE,
    private readonly uiUrl = process.env.DSH_UI_URL ?? 'http://127.0.0.1:3080',
  ) {}

  get(): DshSettingsSnapshot {
    const runtime = this.readLatestRuntimeSelection();
    if (runtime) {
      return {
        available: true,
        ...runtime,
        workspaceRoot: this.workspaceRoot,
        uiUrl: this.uiUrl,
        source: 'session-last-used',
      };
    }
    const profilePath = join(this.home, 'profiles', 'web', 'cordis.patch.yml');
    if (!existsSync(profilePath)) {
      return {
        available: false,
        provider: null,
        model: null,
        reasoningEffort: null,
        workspaceRoot: this.workspaceRoot,
        uiUrl: this.uiUrl,
        source: 'fallback',
        sessionId: null,
      };
    }

    try {
      const source = readFileSync(profilePath, 'utf8');
      const block = source.match(/- id:\s*agent-default-model\b[\s\S]*?(?=\n- id:|\n- insert:|$)/)?.[0] ?? '';
      const value = (name: string) => block.match(new RegExp(`^\\s*${name}:\\s*["']?([^\\r\\n"']+)`, 'm'))?.[1]?.trim() ?? null;
      return {
        available: true,
        provider: value('provider'),
        model: value('model'),
        reasoningEffort: value('reasoningEffort'),
        workspaceRoot: this.workspaceRoot,
        uiUrl: this.uiUrl,
        source: 'profile-default',
        sessionId: null,
      };
    } catch {
      return {
        available: false,
        provider: null,
        model: null,
        reasoningEffort: null,
        workspaceRoot: this.workspaceRoot,
        uiUrl: this.uiUrl,
        source: 'fallback',
        sessionId: null,
      };
    }
  }

  private readLatestRuntimeSelection() {
    const directory = join(this.home, 'storages', 'session_projcache', 'sessions');
    try {
      const recent = readdirSync(directory)
        .filter((name) => name.endsWith('.json'))
        .map((name) => ({ name, modified: statSync(join(directory, name)).mtimeMs }))
        .sort((left, right) => right.modified - left.modified)
        .slice(0, 100);
      if (!recent.length) return null;
      const cacheKey = recent.map((entry) => `${entry.name}:${entry.modified}`).join('|');
      if (cacheKey === this.runtimeCacheKey) return this.runtimeCache;
      for (const entry of recent) {
        try {
          const parsed = JSON.parse(readFileSync(join(directory, entry.name), 'utf8')) as { record?: { rows?: unknown[] | Record<string, unknown> } };
          const container = parsed.record?.rows;
          const rows = Array.isArray(container) ? container : container && typeof container === 'object' ? Object.values(container) : [];
          let selection: { provider?: unknown; model?: unknown; reasoningEffort?: unknown } | undefined;
          for (let index = rows.length - 1; index >= 0; index -= 1) {
            const row = rows[index] as { val?: { lastUsed?: typeof selection }; modelSelection?: { val?: { lastUsed?: typeof selection } } };
            const lastUsed = row.val?.lastUsed ?? row.modelSelection?.val?.lastUsed;
            if (lastUsed) { selection = lastUsed; break; }
          }
          if (typeof selection?.provider !== 'string' || typeof selection.model !== 'string') continue;
          this.runtimeCacheKey = cacheKey;
          this.runtimeCache = {
            provider: selection.provider,
            model: selection.model,
            reasoningEffort: typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : null,
            sessionId: entry.name.replace(/\.json$/, ''),
          };
          return this.runtimeCache;
        } catch {
          // A projection can be mid-write; continue to the next valid recent session.
        }
      }
      this.runtimeCacheKey = cacheKey;
      this.runtimeCache = null;
      return null;
    } catch {
      return null;
    }
  }

  async status() {
    const settings = this.get();
    let webReachable = false;
    try {
      await fetch(settings.uiUrl, { signal: AbortSignal.timeout(1_500), redirect: 'manual' });
      webReachable = true;
    } catch {
      webReachable = false;
    }
    return { ...settings, webReachable };
  }
}
