import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheKey, readCache, writeCache } from '../src/cache.ts';
import { parseConfig } from '../src/config.ts';

test('cache keys separate sources and never contain the token', () => {
  const config = parseConfig('?repo=org/repo&token=example-secret');
  const rotated = { ...config, token: 'another-token' };
  assert.ok(!cacheKey(config).includes('example-secret'));
  assert.equal(cacheKey(config), cacheKey(rotated));
  assert.notEqual(cacheKey(config), cacheKey({ ...config, ref: 'other' }));
  assert.notEqual(cacheKey(config), cacheKey({ ...config, path: 'other.csv' }));
  assert.notEqual(cacheKey(config), cacheKey({ ...config, repo: 'org/other' }));
});

test('CSV can be read and written without persisting config or tokens', (t) => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const config = parseConfig('?repo=org/repo&token=example-secret');
  assert.equal(readCache(config), null);
  writeCache(config, 'date,name');
  assert.equal(readCache(config), 'date,name');
  assert.deepEqual([...values.values()], ['date,name']);
});

test('blocked storage reports a warning but does not stop the app', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => { throw new Error('Blocked'); },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const warning = t.mock.method(console, 'warn', () => {});
  const config = parseConfig('?repo=org/repo');
  assert.equal(readCache(config), null);
  assert.doesNotThrow(() => writeCache(config, 'date,name'));
  assert.equal(warning.mock.callCount(), 2);
});
