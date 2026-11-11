import { test as base, expect } from '@playwright/test';
import type { Request } from '@playwright/test';

interface GitHubResponse {
  body: string;
  status?: number;
  headers?: Record<string, string>;
}

interface GitHubMock {
  respond: (response: GitHubResponse) => void;
  requests: Request[];
}

export const sampleCsv = `date,name
2026-09-21,Bugs Bunny
2026-09-28,Merge Conflict
2026-10-05,Friday Deploy
2026-10-12,Future name must stay hidden
`;

export const test = base.extend<{ github: GitHubMock }>({
  github: [async ({ page }, use) => {
    let response: GitHubResponse = { body: sampleCsv };
    const requests: Request[] = [];
    await page.route('https://api.github.com/**', async (route) => {
      requests.push(route.request());
      await route.fulfill({
        status: response.status ?? 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'x-ratelimit-remaining',
          ...response.headers,
        },
        body: response.body,
      });
    });
    await use({
      requests,
      respond: (next) => { response = next; },
    });
  }, { auto: true }],
});

export { expect };
