import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiUrl, editUrl, fetchCsv, GitHubError } from '../src/github.ts';
import { parseConfig } from '../src/config.ts';

test('API and edit URLs encode nested paths, refs, and special characters', () => {
  const source = { repo: 'some-org/sprints', ref: 'feature/new names',
    path: 'team names/sprints #1+?.csv' };
  assert.equal(apiUrl(source),
    'https://api.github.com/repos/some-org/sprints/contents/team%20names/sprints%20%231%2B%3F.csv?ref=feature%2Fnew+names');
  assert.equal(editUrl(source),
    'https://github.com/some-org/sprints/edit/feature%2Fnew%20names/team%20names/sprints%20%231%2B%3F.csv');
  assert.equal(new URL(apiUrl(source)).searchParams.get('ref'), source.ref);
});

test('fetch uses raw CSV, revalidation, optional bearer auth, and an abort signal', async (t) => {
  const signal = new AbortController().signal;
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls.push(init);
    return new Response('date,name\n2026-10-05,Friday Deploy');
  });
  const config = parseConfig('?repo=org/repo&token=example');
  assert.match(await fetchCsv(config, signal), /Friday Deploy/);
  assert.deepEqual(calls[0], {
    headers: {
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: 'Bearer example',
    },
    signal, cache: 'no-cache', referrerPolicy: 'no-referrer',
  });
  await fetchCsv({ ...config, token: null }, signal);
  assert.ok(!('Authorization' in (calls[1]?.headers ?? {})));
});

test('HTTP errors distinguish invalid tokens, access, missing files, and rate limits', async (t) => {
  for (const [status, remaining, pattern, needsAttention] of [
    [401, '10', /invalid or expired/, true],
    [403, '0', /rate limit/, true],
    [403, '10', /lacks access/, true],
    [404, '10', /repo, path, and ref/, true],
    [500, '10', /temporarily unavailable/, false],
  ] as const) {
    t.mock.method(globalThis, 'fetch', async () => new Response('', {
      status, headers: { 'x-ratelimit-remaining': remaining },
    }));
    await assert.rejects(fetchCsv(parseConfig('?repo=org/repo'), new AbortController().signal),
      (error: unknown) => error instanceof GitHubError && error.status === status
        && error.needsAttention === needsAttention
        && error.message.includes(`HTTP ${status}`) && pattern.test(error.hint));
    t.mock.restoreAll();
  }
});

test('network errors are clear and do not reveal request URLs or tokens', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('secret request detail'); });
  await assert.rejects(fetchCsv(parseConfig('?repo=org/repo&token=example'), new AbortController().signal),
    { message: "Couldn't reach GitHub. Check your connection and try again." });
});

test('aborted requests preserve the abort error', async (t) => {
  const controller = new AbortController();
  const reason = new Error('Timed out');
  controller.abort(reason);
  t.mock.method(globalThis, 'fetch', async () => { throw reason; });
  await assert.rejects(fetchCsv(parseConfig('?repo=org/repo'), controller.signal), reason);
});
