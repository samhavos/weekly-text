import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SprintRow } from '../src/csv.ts';
import { parseLocalDate, daysBetween } from '../src/dates.ts';
import { computeView, sameView } from '../src/schedule.ts';

function date(value: string): Date {
  const result = parseLocalDate(value);
  assert.ok(result);
  return result;
}

function row(value: string, name: string): SprintRow {
  return { date: date(value), name };
}

test('no rows or only future rows show ??? with no history', () => {
  assert.deepEqual(computeView([], date('2026-10-05')), { current: '???', history: [] });
  assert.deepEqual(computeView([row('2026-10-06', 'Hidden')], date('2026-10-05')),
    { current: '???', history: [] });
});

test('a row becomes current at local midnight and future names never enter the view', () => {
  const rows = [
    row('2026-09-28', 'Merge Conflict'),
    row('2026-10-05', 'Friday Deploy'),
    row('2026-10-12', 'Hidden'),
  ];
  assert.deepEqual(computeView(rows, new Date(2026, 9, 4, 23, 59, 59)),
    { current: 'Merge Conflict', history: [] });
  assert.deepEqual(computeView(rows, new Date(2026, 9, 5, 0)),
    { current: 'Friday Deploy', history: ['Merge Conflict'] });
});

test('day six remains current; day seven moves the name into history', () => {
  const rows = [row('2026-09-28', 'Older'), row('2026-10-05', 'Latest')];
  assert.deepEqual(computeView(rows, date('2026-10-11')),
    { current: 'Latest', history: ['Older'] });
  assert.deepEqual(computeView(rows, date('2026-10-12')),
    { current: '???', history: ['Latest', 'Older'] });
  assert.deepEqual(computeView(rows, date('2026-11-12')),
    { current: '???', history: ['Latest', 'Older'] });
});

test('unsorted input and duplicates are handled without mutating input', () => {
  const rows = [
    row('2026-10-05', 'Replaced'),
    row('2026-09-21', 'Oldest'),
    row('2026-10-12', 'Hidden'),
    row('2026-09-28', 'Older'),
    row('2026-10-05', 'Latest'),
  ];
  const before = [...rows];
  assert.deepEqual(computeView(rows, date('2026-10-05')),
    { current: 'Latest', history: ['Older', 'Oldest'] });
  assert.deepEqual(rows, before);
});

test('history cap, zero history, and custom stale periods work', () => {
  const rows = [row('2026-09-21', 'Oldest'), row('2026-09-28', 'Older'), row('2026-10-05', 'Latest')];
  assert.deepEqual(computeView(rows, date('2026-10-05'), { maxHistory: 1 }),
    { current: 'Latest', history: ['Older'] });
  assert.deepEqual(computeView(rows, date('2026-10-12'), { maxHistory: 0 }),
    { current: '???', history: [] });
  assert.equal(computeView(rows, date('2026-10-12'), { staleDays: 14 }).current, 'Latest');
  assert.equal(computeView(rows, date('2026-10-05'), { staleDays: 0 }).current, '???');
});

test('backfilling replaces ??? without inventing entries for missed weeks', () => {
  const rows = [row('2026-09-14', 'Old'), row('2026-10-05', 'Backfilled')];
  assert.deepEqual(computeView(rows, date('2026-10-05')),
    { current: 'Backfilled', history: ['Old'] });
});

test('calendar-day differences cross Oslo DST transitions without off-by-one errors', () => {
  assert.equal(process.env.TZ, 'Europe/Oslo');
  assert.notEqual(date('2026-03-23').getTimezoneOffset(), date('2026-03-30').getTimezoneOffset());
  assert.notEqual(date('2026-10-19').getTimezoneOffset(), date('2026-10-26').getTimezoneOffset());
  for (const [from, to] of [['2026-03-23', '2026-03-30'], ['2026-10-19', '2026-10-26']]) {
    assert.ok(from && to);
    assert.equal(daysBetween(date(from), date(to)), 7);
    assert.equal(computeView([row(from, 'Stale')], date(to)).current, '???');
  }
  assert.equal(daysBetween(date('2026-12-31'), date('2027-01-01')), 1);
});

test('view equality includes the complete ordered history', () => {
  const view = { current: 'Name', history: ['A', 'B'] };
  assert.ok(sameView(view, { current: 'Name', history: ['A', 'B'] }));
  assert.ok(!sameView(view, { current: 'Changed', history: ['A', 'B'] }));
  assert.ok(!sameView(view, { current: 'Name', history: ['B', 'A'] }));
  assert.ok(!sameView(view, { current: 'Name', history: ['A'] }));
});
