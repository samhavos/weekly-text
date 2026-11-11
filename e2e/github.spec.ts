import type { Route } from '@playwright/test';
import { test, expect, sampleCsv } from './fixtures.ts';

for (const { status, remaining, hint } of [
  { status: 401, remaining: '10', hint: 'The token is invalid or expired.' },
  { status: 403, remaining: '0', hint: 'GitHub rate limit reached.' },
  { status: 403, remaining: '10', hint: 'The token lacks access' },
  { status: 404, remaining: '10', hint: 'Check the repo, path, and ref.' },
  { status: 500, remaining: '10', hint: 'GitHub may be temporarily unavailable.' },
]) {
  test(`HTTP ${status} with ${remaining} remaining shows a useful hint and edit link`, async ({ page, github }) => {
    github.respond({ body: '', status, headers: { 'x-ratelimit-remaining': remaining } });
    await page.goto('?repo=org/sprints&refresh=0');
    await expect(page.getByRole('heading',
      { name: `Couldn't load sprint names (HTTP ${status}).`, exact: true })).toBeVisible();
    await expect(page.locator('body')).toContainText(hint);
    await expect(page.getByRole('link', { name: 'Edit names' })).toHaveAttribute('href',
      'https://github.com/org/sprints/edit/main/sprints.csv');
  });
}

test('network failures are visible', async ({ page }) => {
  await page.route('https://api.github.com/**', (route) => route.abort('failed'));
  await page.goto('?repo=org/sprints&refresh=0');
  await expect(page.getByRole('heading', { name: /Couldn't reach GitHub/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit names' })).toBeVisible();
});

test('malformed CSV failures are visible', async ({ page, github }) => {
  github.respond({ body: 'date,name\n2026-10-05,"not closed' });
  await page.goto('?repo=org/sprints&refresh=0');
  await expect(page.getByRole('heading', { name: /Invalid CSV/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit names' })).toBeVisible();
});

test('GitHub requests and edit links are encoded without leaking the dummy token', async ({ page, github }) => {
  const token = 'example-token-only-for-tests';
  const query = new URLSearchParams({
    repo: 'org/sprints', path: 'team names/sprints #1+.csv', ref: 'feature/new names',
    token, now: '2026-10-05', refresh: '0',
  });
  await page.goto(`?${query}`);
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  expect(github.requests).toHaveLength(1);
  const request = github.requests[0];
  if (!request) throw new Error('Expected a GitHub request.');
  const url = new URL(request.url());
  expect(url.pathname).toBe('/repos/org/sprints/contents/team%20names/sprints%20%231%2B.csv');
  expect(url.searchParams.get('ref')).toBe('feature/new names');
  expect(request.headers()['authorization']).toBe(`Bearer ${token}`);
  expect(request.headers()['accept']).toBe('application/vnd.github.raw+json');
  expect(request.headers()['x-github-api-version']).toBe('2022-11-28');
  expect(request.headers()['referer']).toBeUndefined();
  const link = page.getByRole('link', { name: 'Edit names' });
  await expect(link).toHaveAttribute('href',
    'https://github.com/org/sprints/edit/feature%2Fnew%20names/team%20names/sprints%20%231%2B.csv');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect.poll(() => page.evaluate(() => Object.values(localStorage))).toEqual([sampleCsv]);
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).not.toContain(token);
});

test('polling changes the DOM only when the visible view changes', async ({ page, github }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+02:00') });
  await page.goto('?repo=org/sprints&refresh=1');
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const observer = await page.locator('.wallboard').evaluateHandle((element) => {
    let count = 0;
    const mutations = new MutationObserver((records) => { count += records.length; });
    mutations.observe(element, { subtree: true, childList: true, attributes: true, characterData: true });
    return { count: () => count, stop: () => mutations.disconnect() };
  });
  const queuedUpdate = sampleCsv + '2026-10-19,Another hidden future\n';
  github.respond({ body: queuedUpdate });
  await page.clock.fastForward(60_000);
  await expect.poll(() => page.evaluate(() => Object.values(localStorage))).toEqual([queuedUpdate]);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(github.requests).toHaveLength(2);
  expect(await observer.evaluate((watcher) => watcher.count())).toBe(0);
  github.respond({ body: sampleCsv.replace('Friday Deploy', 'Updated name') });
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('heading', { name: 'Updated name' })).toBeVisible();
  expect(github.requests).toHaveLength(3);
  expect(await observer.evaluate((watcher) => watcher.count())).toBeGreaterThan(0);
  await expect(page.locator('body')).not.toContainText('Future name must stay hidden');
  await expect(page.locator('body')).not.toContainText('Another hidden future');
  await observer.evaluate((watcher) => watcher.stop());
  await observer.dispose();
});

test('a later failed fetch preserves the last good data and warns', async ({ page, github }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.clock.install();
  await page.goto('?repo=org/sprints&now=2026-10-05&refresh=1');
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  github.respond({ body: '', status: 503 });
  await page.clock.fastForward(60_000);
  await expect.poll(() => warnings.join('\n')).toContain('refresh failed; keeping the last good data.');
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  await expect(page.locator('.history li')).toHaveText(['Merge Conflict', 'Bugs Bunny']);
});

test('a failed initial fetch recovers on the next poll', async ({ page, github }) => {
  await page.clock.install();
  github.respond({ body: '', status: 401 });
  await page.goto('?repo=org/sprints&now=2026-10-05&refresh=1');
  await expect(page.getByRole('heading', { name: /HTTP 401/ })).toBeVisible();
  github.respond({ body: sampleCsv });
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  expect(github.requests).toHaveLength(2);
});

test('cached CSV renders on reload before the next fetch completes', async ({ page }) => {
  await page.goto('?repo=org/sprints&now=2026-10-05&refresh=0');
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.values(localStorage))).toEqual([sampleCsv]);
  const pending: Route[] = [];
  await page.route('https://api.github.com/**', (route) => { pending.push(route); });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  await expect.poll(() => pending.length).toBe(1);
  const request = pending[0];
  if (!request) throw new Error('Expected a pending GitHub request.');
  await request.fulfill({
    contentType: 'text/plain',
    body: sampleCsv.replace('Friday Deploy', 'Fresh from GitHub'),
  });
  await expect(page.getByRole('heading', { name: 'Fresh from GitHub' })).toBeVisible();
});

test('blocked localStorage warns but does not prevent rendering', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get: () => { throw new DOMException('Blocked', 'SecurityError'); },
    });
  });
  await page.goto('?repo=org/sprints&now=2026-10-05&refresh=0');
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  await expect.poll(() => warnings.length).toBe(2);
  expect(warnings.every((warning) => warning.includes('browser storage is unavailable'))).toBe(true);
});

for (const queued of [true, false]) {
  test(`local midnight ${queued ? 'activates a queued name' : 'expires a stale name'} without refetching`,
    async ({ page, github }) => {
      await page.clock.install({ time: new Date('2026-10-04T23:59:30+02:00') });
      if (!queued) github.respond({ body: 'date,name\n2026-09-28,Merge Conflict' });
      await page.goto('?repo=org/sprints&refresh=0');
      await expect(page.getByRole('heading', { name: 'Merge Conflict' })).toBeVisible();
      await page.clock.fastForward(60_000);
      await expect(page.getByRole('heading',
        { name: queued ? 'Friday Deploy' : '???', exact: true })).toBeVisible();
      await expect(page.locator('.history li').first()).toHaveText('Merge Conflict');
      await page.clock.fastForward(3_600_000);
      expect(github.requests).toHaveLength(1);
    });
}

test('visibility events recompute immediately and fetch only when overdue', async ({ page, github }) => {
  await page.clock.install({ time: new Date('2026-10-04T23:59:30+02:00') });
  await page.goto('?repo=org/sprints&refresh=5');
  await expect(page.getByRole('heading', { name: 'Merge Conflict' })).toBeVisible();
  await page.clock.setSystemTime(new Date('2026-10-05T00:00:01+02:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  expect(github.requests).toHaveLength(1);
  github.respond({ body: sampleCsv.replace('Friday Deploy', 'Refreshed on visibility') });
  await page.clock.setSystemTime(new Date('2026-10-05T00:05:01+02:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Refreshed on visibility' })).toBeVisible();
  expect(github.requests).toHaveLength(2);
});

test('a stalled first request reports its timeout', async ({ page }) => {
  await page.clock.install();
  await page.route('https://api.github.com/**', () => {});
  await page.goto('?repo=org/sprints&refresh=0');
  await expect(page.getByRole('heading', { name: 'Loading sprint names...' })).toBeVisible();
  await page.clock.fastForward(30_001);
  await expect(page.getByRole('heading', { name: /request timed out/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit names' })).toBeVisible();
});
