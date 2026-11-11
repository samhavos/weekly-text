import type { SprintRow } from './csv.ts';
import { calendarDay, daysBetween } from './dates.ts';

export interface ScheduleOptions {
  staleDays?: number;
  maxHistory?: number;
}

export interface SprintView {
  current: string;
  history: string[];
}

export function computeView(
  rows: readonly SprintRow[],
  now: Date,
  { staleDays = 7, maxHistory = Infinity }: ScheduleOptions = {},
): SprintView {
  const byDay = new Map<number, SprintRow>();
  const today = calendarDay(now);
  for (const row of rows) {
    const day = calendarDay(row.date);
    if (day <= today) byDay.set(day, row);
  }
  const past = [...byDay.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
  const latest = past.at(-1);
  const isCurrent = latest !== undefined && daysBetween(latest.date, now) < staleDays;
  return {
    current: isCurrent ? latest.name : '???',
    history: (isCurrent ? past.slice(0, -1) : past)
      .reverse()
      .slice(0, maxHistory)
      .map((row) => row.name),
  };
}

export function sameView(a: SprintView, b: SprintView): boolean {
  return a.current === b.current
    && a.history.length === b.history.length
    && a.history.every((name, index) => name === b.history[index]);
}
