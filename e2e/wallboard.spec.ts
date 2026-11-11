import { test, expect } from './fixtures.ts';

test('setup links to a working demo without requesting GitHub', async ({ page, github }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your sprint names, here.' })).toBeVisible();
  await page.getByRole('link', { name: 'Preview with sample names' }).click();
  await expect(page.getByRole('heading', { name: 'Friday Deploy', exact: true })).toBeVisible();
  expect(github.requests).toHaveLength(0);
});

for (const viewport of [
  { width: 1200, height: 700 },
  { width: 400, height: 220 },
  { width: 250, height: 120 },
  { width: 1600, height: 250 },
]) {
  test(`production layout and assets at ${viewport.width}x${viewport.height}`, async ({ page, github }) => {
    const assets: { url: string; status: number; type: string }[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    page.on('response', (response) => {
      if (/\.(js|css)$/.test(response.url())) {
        assets.push({
          url: response.url(),
          status: response.status(),
          type: response.headers()['content-type'] ?? '',
        });
      }
    });
    await page.setViewportSize(viewport);
    await page.goto('?demo=1&now=2026-10-05&theme=light');
    await expect(page.getByRole('heading', { name: 'Friday Deploy', exact: true })).toBeVisible();
    await expect(page.locator('.history li')).toHaveText([
      'Merge Conflict', 'Bugs Bunny', 'Sprinty McSprint',
    ]);

    const top = await page.locator('.current').evaluate((element) => element.getBoundingClientRect().top);
    expect(top).toBeCloseTo(viewport.height * 0.515, 0);
    const positions = await page.locator('.history li').evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top));
    expect(positions).toEqual([...positions].sort((a, b) => b - a));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expect.poll(() => page.locator('[data-fit]').evaluateAll((lines) =>
      lines.every((line) => line.scrollWidth <= line.clientWidth))).toBe(true);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('body')).not.toContainText('Works On My Machine');
    expect(github.requests).toHaveLength(0);
    expect(errors).toEqual([]);
    expect(assets.some((asset) => asset.type.includes('javascript'))).toBe(true);
    expect(assets.some((asset) => asset.type.includes('css'))).toBe(true);
    for (const asset of assets) {
      expect(asset.status).toBe(200);
      expect(new URL(asset.url).pathname).toMatch(new RegExp(`^${new URL(page.url()).pathname}assets/`));
    }
  });
}

test('long CSV names fit after resizes and render as text, not markup', async ({ page, github }) => {
  const name = '<img src=x onerror=alert(1)> ' + 'VeryLongName'.repeat(20);
  github.respond({
    body: `date,name\n2026-09-28,${'LongHistory'.repeat(20)}\n2026-10-05,${name}\n2026-10-12,Hidden future`,
  });
  await page.goto('?repo=org/sprints&now=2026-10-05&refresh=0');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  for (const viewport of [
    { width: 1200, height: 700 },
    { width: 250, height: 120 },
    { width: 800, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.locator('[data-fit]').evaluateAll((lines) =>
      lines.every((line) => line.scrollWidth <= line.clientWidth))).toBe(true);
    const fontSize = await page.locator('.current h1').evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeLessThan(Math.min(viewport.width * 0.12, viewport.height * 0.2));
  }
  await expect(page.locator('.wallboard img, .wallboard script')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Hidden future');
});

for (const { theme, preference, color } of [
  { theme: 'dark', preference: 'light', color: 'rgb(255, 255, 255)' },
  { theme: 'light', preference: 'dark', color: 'rgb(36, 41, 46)' },
  { theme: 'auto', preference: 'dark', color: 'rgb(255, 255, 255)' },
  { theme: 'auto', preference: 'light', color: 'rgb(36, 41, 46)' },
] as const) {
  test(`theme=${theme} with ${preference} preference stays transparent`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: preference });
    await page.goto(`?demo=1&now=2026-10-05&theme=${theme}`);
    await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('color', color);
    await expect(page.locator('html')).toHaveCSS('color-scheme', theme === 'auto' ? 'light dark' : theme);
    for (const selector of ['html', 'body']) {
      await expect(page.locator(selector)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
  });
}

for (const scheme of ['dark', 'light'] as const) {
  test(`auto theme follows a ${scheme} iframe embedder`, async ({ page }) => {
    // Forced media emulation overrides prefers-color-scheme in every frame.
    await page.emulateMedia({ colorScheme: null });
    await page.route('**/embed-test', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<html style="color-scheme:${scheme}"><body>
        <iframe title="Sprint names" src="./?demo=1&amp;now=2026-10-05"
          style="width:800px;height:400px;border:0"></iframe>
        </body></html>`,
    }));
    await page.goto('./embed-test');
    await expect(page.locator('iframe')).toHaveCSS('color-scheme', scheme);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
    await expect(frame.locator('html')).toHaveCSS('color',
      scheme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(36, 41, 46)');
    await expect(frame.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });
}

test('history and edit query options control their rendered surfaces', async ({ page }) => {
  await page.goto('?repo=org/sprints&now=2026-10-05&history=1&edit=0&refresh=0');
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  await expect(page.locator('.history li')).toHaveText(['Merge Conflict']);
  await expect(page.getByRole('link', { name: 'Edit names' })).toHaveCount(0);
  await page.goto('?repo=org/sprints&now=2026-10-05&history=0&refresh=0');
  await expect(page.getByRole('heading', { name: 'Friday Deploy' })).toBeVisible();
  await expect(page.locator('.history li')).toHaveCount(0);
});

for (const [label, body] of [
  ['empty', 'date,name\njunk,ignored'],
  ['all-future', 'date,name\n2026-10-12,Hidden future'],
] as const) {
  test(`${label} CSV renders ??? with no history`, async ({ page, github }) => {
    github.respond({ body });
    await page.goto('?repo=org/sprints&now=2026-10-05&refresh=0');
    await expect(page.getByRole('heading', { name: '???', exact: true })).toBeVisible();
    await expect(page.locator('.history li')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Hidden future');
  });
}

test('invalid configuration keeps the valid edit link and requested theme', async ({ page, github }) => {
  await page.goto('?repo=org/sprints&refresh=wrong&theme=dark');
  await expect(page.getByRole('heading', { name: 'Check the panel URL' })).toBeVisible();
  await expect(page.locator('body')).toContainText('"refresh" must be a non-negative number.');
  await expect(page.getByRole('link', { name: 'Edit names' })).toHaveAttribute('href',
    'https://github.com/org/sprints/edit/main/sprints.csv');
  await expect(page.locator('html')).toHaveCSS('color', 'rgb(255, 255, 255)');
  expect(github.requests).toHaveLength(0);
});
