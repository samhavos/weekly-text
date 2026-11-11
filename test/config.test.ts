import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, parseConfig } from '../src/config.ts';

test('defaults allow the setup screen with no repo', () => {
  assert.deepEqual(parseConfig(''), {
    repo: null, path: 'sprints.csv', ref: 'main', token: null, staleDays: 7,
    maxHistory: Infinity, refreshMs: 300_000, theme: 'auto', edit: true, now: null, demo: false,
  });
});

test('query parameters are decoded and all supported options are wired', () => {
  const config = parseConfig('?repo=org%2Frepo&path=data%2Fnames.csv&ref=release%2Fv1'
    + '&token=example&stale=14&history=3&refresh=0.5&theme=dark&edit=0&demo=1&now=2026-10-05');
  assert.equal(config.repo, 'org/repo');
  assert.equal(config.path, 'data/names.csv');
  assert.equal(config.ref, 'release/v1');
  assert.equal(config.token, 'example');
  assert.equal(config.staleDays, 14);
  assert.equal(config.maxHistory, 3);
  assert.equal(config.refreshMs, 30_000);
  assert.equal(config.theme, 'dark');
  assert.equal(config.edit, false);
  assert.equal(config.demo, true);
  assert.equal(config.now?.getDate(), 5);
  assert.equal(config.now?.getHours(), 0);
});

test('zero values disable polling/history and permit immediate staleness', () => {
  const config = parseConfig('?refresh=0&history=0&stale=0');
  assert.equal(config.refreshMs, 0);
  assert.equal(config.maxHistory, 0);
  assert.equal(config.staleDays, 0);
});

test('invalid inputs produce actionable errors without echoing tokens', () => {
  for (const query of ['repo=bad', 'repo=a/b/c', 'repo=../repo', 'path=', 'path=/sprints.csv',
    'path=a/../b', 'ref=', 'stale=-1', 'stale=1.5', 'history=NaN', 'history=',
    'history=1e2', 'refresh=-1', 'refresh=99999999999', 'refresh=0.0001',
    'theme=other', 'now=2026-02-30', 'now=', 'edit=false', 'demo=yes']) {
    assert.throws(() => parseConfig(`?${query}&token=do-not-echo`),
      (error: unknown) => error instanceof ConfigError && !error.message.includes('do-not-echo'),
      query);
  }
});
