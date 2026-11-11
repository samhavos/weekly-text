import { useEffect, useState } from 'react';
import type { Config } from './config.ts';
import { parseSprints } from './csv.ts';
import type { SprintRow } from './csv.ts';
import { computeView, sameView } from './schedule.ts';
import type { SprintView } from './schedule.ts';
import { fetchCsv } from './github.ts';
import { readCache, writeCache } from './cache.ts';
import { demoCsv } from './demo.ts';

interface LoadState {
  view: SprintView | null;
  error: Error | null;
}

function initialRows(config: Config): SprintRow[] | null {
  if (config.demo) return parseSprints(demoCsv);
  if (!config.repo) return null;
  const cached = readCache(config);
  if (cached === null) return null;
  try {
    return parseSprints(cached);
  } catch {
    console.warn('Sprint names: cached CSV is malformed; fetching a fresh copy.');
    return null;
  }
}

export function useSprints(config: Config): LoadState {
  const [initial] = useState(() => initialRows(config));
  const [state, setState] = useState<LoadState>(() => ({
    view: initial === null ? null : computeView(initial, config.now ?? new Date(), config),
    error: null,
  }));

  useEffect(() => {
    if (!config.repo && !config.demo) return;
    let rows = initial;
    let active = true;
    let inFlight = false;
    let lastFetch = 0;
    let controller: AbortController | null = null;

    const recompute = () => {
      if (rows === null) return;
      const view = computeView(rows, config.now ?? new Date(), config);
      setState((previous) => previous.view && sameView(previous.view, view) && !previous.error
        ? previous
        : { view, error: null });
    };

    const refresh = async () => {
      if (config.demo || inFlight) return;
      inFlight = true;
      lastFetch = Date.now();
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => {
        request.abort(new Error("Couldn't load sprint names: the GitHub request timed out."));
      }, 30_000);
      try {
        const text = await fetchCsv(config, request.signal);
        const nextRows = parseSprints(text);
        if (!active) return;
        rows = nextRows;
        recompute();
        writeCache(config, text);
      } catch (error) {
        if (!active) return;
        const failure = error instanceof Error ? error : new Error("Couldn't load sprint names.");
        if (rows !== null) {
          console.warn('Sprint names: refresh failed; keeping the last good data.', failure.message);
        } else {
          setState({ view: null, error: failure });
        }
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
    };

    void refresh();
    const rolloverTimer = setInterval(recompute, 60_000);
    const refreshTimer = !config.demo && config.refreshMs > 0
      ? setInterval(() => { void refresh(); }, config.refreshMs)
      : null;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      recompute();
      if (config.refreshMs > 0 && Date.now() - lastFetch >= config.refreshMs) void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(rolloverTimer);
      if (refreshTimer !== null) clearInterval(refreshTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [config, initial]);

  return state;
}
