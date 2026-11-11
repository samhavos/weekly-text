import type { Config } from './config.ts';

export function cacheKey(config: Pick<Config, 'repo' | 'ref' | 'path'>): string {
  return `weekly-text:csv:${JSON.stringify([config.repo, config.ref, config.path])}`;
}

export function readCache(config: Config): string | null {
  try {
    return localStorage.getItem(cacheKey(config));
  } catch {
    console.warn('Sprint names: browser storage is unavailable; continuing without cached data.');
    return null;
  }
}

export function writeCache(config: Config, text: string): void {
  try {
    localStorage.setItem(cacheKey(config), text);
  } catch {
    console.warn('Sprint names: browser storage is unavailable; data could not be cached.');
  }
}
