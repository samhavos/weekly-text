import type { Config } from './config.ts';

type Source = Pick<Config, 'repo' | 'path' | 'ref'>;

function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function apiUrl({ repo, path, ref }: Source): string {
  const url = new URL(`https://api.github.com/repos/${encodedPath(repo ?? '')}/contents/${encodedPath(path)}`);
  url.searchParams.set('ref', ref);
  return url.href;
}

export function editUrl({ repo, path, ref }: Source): string {
  return `https://github.com/${encodedPath(repo ?? '')}/edit/${encodeURIComponent(ref)}/${encodedPath(path)}`;
}

export class GitHubError extends Error {
  readonly hint: string;

  constructor(status: number, rateLimited: boolean) {
    super(`Couldn't load sprint names (HTTP ${status}).`);
    this.name = 'GitHubError';
    switch (status) {
      case 401:
        this.hint = 'The token is invalid or expired. Update the token in the panel URL.';
        break;
      case 403:
        this.hint = rateLimited
          ? 'GitHub rate limit reached. Wait for it to reset, or use a read-only token.'
          : 'The token lacks access, or your organization has not approved it.';
        break;
      case 404:
        this.hint = 'Check the repo, path, and ref. The token may not have access to this repository.';
        break;
      default:
        this.hint = 'GitHub may be temporarily unavailable. The app will retry on its next refresh.';
    }
  }
}

export async function fetchCsv(config: Config, signal: AbortSignal): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  let response: Response;
  try {
    response = await fetch(apiUrl(config), {
      headers,
      signal,
      cache: 'no-cache',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("Couldn't reach GitHub. Check your connection and try again.");
  }
  if (!response.ok) {
    throw new GitHubError(response.status, response.headers.get('x-ratelimit-remaining') === '0');
  }
  return response.text();
}
