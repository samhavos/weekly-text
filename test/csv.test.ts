import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, parseSprints } from '../src/csv.ts';
import { parseLocalDate } from '../src/dates.ts';

test('CSV supports BOM, CRLF, quoted commas, escaped quotes, and extra fields', () => {
  const rows = parseSprints('\uFEFFdate,name,author\r\n'
    + '2026-10-05," Works On My Machine, Again ",Sam\r\n'
    + '2026-10-12,"The ""Final"" Fix",Someone\r\n');
  assert.deepEqual(rows.map((row) => row.name), [
    'Works On My Machine, Again', 'The "Final" Fix',
  ]);
  assert.equal(rows[0]?.date.getDate(), 5);
  assert.equal(rows[0]?.date.getHours(), 0);
});

test('CSV supports multiline fields, empty fields, and trailing newlines', () => {
  assert.deepEqual(parseCsv('a,"b\nc",\n,,""\n'), [
    ['a', 'b\nc', ''], ['', '', ''],
  ]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('a,b'), [['a', 'b']]);
  assert.deepEqual(parseCsv('"a"\r\n"b"'), [['a'], ['b']]);
});

test('invalid dates, headers, blank lines, and empty names are skipped', () => {
  assert.deepEqual(parseSprints('date,name\n\n'
    + '2026-02-30,No\n5/10/2026,No\n2026-1-01,No\n'
    + '2026-10-05,"  "\n2026-10-06\n2026-10-07, Valid \n')
    .map((row) => row.name), ['Valid']);
});

test('dates are strict, local calendar dates including leap years', () => {
  for (const invalid of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01',
    '2026-01-00', '2026-01-32', ' 2026-01-01', '2026-01-01 ', '2026-01-01T00:00:00']) {
    assert.equal(parseLocalDate(invalid), null, invalid);
  }
  const date = parseLocalDate('2024-02-29');
  assert.ok(date);
  assert.equal(date.getFullYear(), 2024);
  assert.equal(date.getMonth(), 1);
  assert.equal(date.getDate(), 29);
  assert.equal(parseLocalDate('0099-01-01')?.getFullYear(), 99);
});

test('rows are sorted and the last valid row for a date wins', () => {
  const rows = parseSprints('2026-10-12,Later\n2026-10-05,Old\n'
    + '2026-10-05,Replacement\n2026-10-05,\n');
  assert.deepEqual(rows.map((row) => row.name), ['Replacement', 'Later']);
});

test('malformed quoting is kept as literal text instead of failing the file', () => {
  assert.deepEqual(parseCsv('a,b"c'), [['a', 'b"c']]);
  assert.deepEqual(parseCsv('"a"x,b'), [['ax', 'b']]);
  assert.deepEqual(parseCsv('"unclosed'), [['"unclosed']]);
  assert.deepEqual(parseCsv('"a""'), [['"a""']]);
  assert.deepEqual(parseCsv('a,"'), [['a', '"']]);
  assert.deepEqual(parseSprints('date,name\n2026-09-21,The "Best" Sprint\n2026-09-28,Fine\n')
    .map((row) => row.name), ['The "Best" Sprint', 'Fine']);
});

test('an unclosed quote does not swallow later rows', () => {
  const rows = parseSprints('date,name\n'
    + '2026-10-05,"Forgot the closing quote\n'
    + '2026-10-12,Plain\n'
    + '2026-10-19,"Quoted, Properly"\n'
    + '2026-10-26,"Also unclosed\n');
  assert.deepEqual(rows.map((row) => row.name), [
    '"Forgot the closing quote', 'Plain', 'Quoted, Properly', '"Also unclosed',
  ]);
});

test('names remain plain text, including HTML-looking content', () => {
  assert.equal(parseSprints('2026-10-05,<script>alert(1)</script>')[0]?.name,
    '<script>alert(1)</script>');
});
