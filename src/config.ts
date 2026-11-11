import { parseLocalDate } from './dates.ts';

export interface Config {
  repo: string | null;
  path: string;
  ref: string;
  token: string | null;
  staleDays: number;
  maxHistory: number;
  refreshMs: number;
  theme: 'auto' | 'dark' | 'light';
  edit: boolean;
  now: Date | null;
  demo: boolean;
}

export type SourceConfig = Pick<Config, 'repo' | 'path' | 'ref' | 'edit'>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function numberParam(
  params: URLSearchParams,
  key: string,
  fallback: number,
  integer: boolean,
): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(value)
    || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new ConfigError(`"${key}" must be a non-negative ${integer ? 'integer' : 'number'}.`);
  }
  return value;
}

export function parseSource(params: URLSearchParams): SourceConfig {
  const repo = params.get('repo') || null;
  if (repo && (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)
    || repo.split('/').some((part) => part === '.' || part === '..'))) {
    throw new ConfigError('"repo" must be owner/name.');
  }
  const path = params.get('path') ?? 'sprints.csv';
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new ConfigError('"path" must be a file path relative to the repository.');
  }
  const ref = params.get('ref') ?? 'main';
  if (!ref.trim()) throw new ConfigError('"ref" cannot be empty.');
  const edit = params.get('edit');
  if (edit !== null && edit !== '0' && edit !== '1') {
    throw new ConfigError('"edit" must be 0 or 1.');
  }
  return { repo, path, ref, edit: edit !== '0' };
}

export function parseConfig(search: string): Config {
  const params = new URLSearchParams(search);
  const source = parseSource(params);
  const theme = params.get('theme') ?? 'auto';
  if (theme !== 'auto' && theme !== 'dark' && theme !== 'light') {
    throw new ConfigError('"theme" must be auto, dark, or light.');
  }
  const demo = params.get('demo');
  if (demo !== null && demo !== '0' && demo !== '1') {
    throw new ConfigError('"demo" must be 0 or 1.');
  }
  const rawNow = params.get('now');
  const now = rawNow === null ? null : parseLocalDate(rawNow);
  if (rawNow !== null && now === null) {
    throw new ConfigError('"now" must be a real date in YYYY-MM-DD format.');
  }
  const refreshMs = numberParam(params, 'refresh', 5, false) * 60_000;
  if (refreshMs > 2_147_483_647 || (refreshMs > 0 && refreshMs < 1_000)) {
    throw new ConfigError('"refresh" must be 0 or between 1/60 and 35791 minutes.');
  }
  return {
    ...source,
    token: params.get('token') || null,
    staleDays: numberParam(params, 'stale', 7, true),
    maxHistory: numberParam(params, 'history', Infinity, true),
    refreshMs,
    theme,
    now,
    demo: params.get('demo') === '1',
  };
}
