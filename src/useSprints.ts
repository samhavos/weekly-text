import { useEffect, useState } from 'react';
import type { Config } from './config.ts';
import { parseSprints } from './csv.ts';
import type { SprintRow } from './csv.ts';
import { computeView, sameView } from './schedule.ts';
import type { SprintView } from './schedule.ts';
import { fetchCsv, GitHubError } from './github.ts';
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
  return cached === null ? null : parseSprints(cached);
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

    const recompute = (fetched = false) => {
      if (rows === null) return;
      const view = computeView(rows, config.now ?? new Date(), config);
      setState((previous) => {
        // Only a successful fetch clears a GitHub error; clock-driven recomputes keep it.
        const error = fetched ? null : previous.error;
        return previous.view && sameView(previous.view, view) && previous.error === error
          ? previous
          : { view, error };
      });
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
        recompute(true);
        writeCache(config, text);
      } catch (error) {
        if (!active) return;
        const failure = error instanceof Error ? error : new Error("Couldn't load sprint names.");
        if (rows === null) {
          setState({ view: null, error: failure });
          return;
        }
        console.warn('Sprint names: refresh failed; keeping the last good data.', failure.message);
        // Transient failures stay silent, but e.g. an expired token must be visible
        // even when cached or earlier names are still on screen.
        if (failure instanceof GitHubError && failure.needsAttention) {
          setState((previous) => previous.error?.message === failure.message
            ? previous
            : { ...previous, error: failure });
        }
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
    };

    void refresh();
    const rolloverTimer = setInterval(() => recompute(), 60_000);
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
