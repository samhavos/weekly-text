# Sprint names wallboard

A small, transparent React wallboard for a Grafana panel. The current sprint
name sits just below the centre, with older names fading upwards. Future names
stay off the display. Data comes directly from a CSV in GitHub; there is no
backend, router, UI kit, or external font.

## Run locally

Use Node.js **22.18+** (or 24+) and npm:

```sh
npm ci
npm run dev
```

Open the printed local URL. With no parameters, the app shows a setup hint.
For a working preview without a repository or token:

```text
http://127.0.0.1:5173/?demo=1&now=2026-10-05&theme=light
```

Demo data is fixed, dated September-November 2026. Set `now` to step through
it, or omit `now` to use today's local date. Demo mode makes no API requests.
The background is deliberately transparent, including in demo mode.

```sh
npm test          # Node's test runner, including Europe/Oslo DST boundaries
npm run build    # TypeScript checks, then Vite output in docs/
npm run preview  # preview the production build
```

React and React DOM are the only runtime libraries. TypeScript, its type
definitions, Vite, and Playwright are development dependencies. All application code,
including the CSV parser and calendar logic, lives in [src/](./src/).

### Browser regression tests

Browser tests are stored in [e2e/](./e2e/), not run as ad hoc browser scripts.
Install Playwright's Chromium browser once after `npm ci`, then run:

```sh
npx playwright install chromium
npm run test:e2e
```

The command type-checks and builds the app, then runs the stored tests against
that production output at both `/` and `/weekly-text/`. Playwright starts and
stops two local Vite preview servers automatically, using ports 4173 and 4174.
Tests use isolated browser contexts and mocked GitHub responses; they need no
real repository, PAT, or existing browser storage.

Coverage includes responsive sizing and long-name fitting, themes and iframe
color-scheme inheritance, queued-name hiding, edit links, error hints, token
hygiene, cached/blocked storage, polling without unnecessary DOM mutations,
request timeouts, local-midnight rollover, and visibility changes. Fake clocks
keep rollover and polling tests fast without real-time sleeps. Failed tests
save traces and screenshots under the ignored `test-results/` directory.

To run a subset, pass Playwright arguments through the script:

```sh
npm run test:e2e -- --project=sub-path --grep "local midnight"
```

On a fresh Linux CI machine, `npx playwright install --with-deps chromium` also
installs the required system libraries (and may need administrator privileges).
The tests do not replace checks against your real Grafana instance or private
repository permissions.

## Set up the data

Copy [examples/sprints.csv](./examples/sprints.csv) to `sprints.csv` in your
chosen GitHub repository. Edit the dates and names:

```csv
date,name
2026-09-28,Merge Conflict
2026-10-05,Friday Deploy
2026-10-12,"Works On My Machine, Again"
```

- Column one is a strict, real `YYYY-MM-DD` **local calendar date**; column two
  is the name. Extra columns are ignored.
- Names are trimmed. Invalid dates and empty names are skipped, as are headers
  and blank lines. Quoted commas, escaped quotes (`""`), multiline fields,
  LF/CRLF, and a UTF-8 BOM are supported. Malformed quoting never breaks the
  board: stray or unclosed quotes are shown as literal text.
- Order does not matter. The last valid row for a duplicate date wins.
- The newest row dated today or earlier is current for seven calendar days
  by default. After that, the display shows `???`; that row moves into history.
  Missing weeks do not create history entries.
- Future names are not rendered, but **are not secret**: viewers can inspect
  the data, browser storage, or the token.

GitHub renders the file as a table. The bottom-right **Edit names** link opens
the CSV's GitHub editor in a new tab; GitHub handles write permissions.

## Configure the panel URL

Example for a public repository:

```text
https://samhavos.github.io/weekly-text/?repo=your-org/sprint-names
```

| Parameter | Default | Meaning |
| --- | --- | --- |
| `repo` | required unless demo | GitHub `owner/name`. |
| `path` | `sprints.csv` | Repository-relative CSV path. |
| `ref` | `main` | Branch, tag, or commit; also used by the edit link. |
| `token` | none | Fine-grained read-only PAT; needed for private repos. |
| `stale` | `7` | Calendar days until a name becomes stale; non-negative integer. |
| `history` | unlimited | Maximum previous names; non-negative integer, `0` hides history. |
| `refresh` | `5` | Minutes between fetches, including fractional minutes; `0` disables subsequent fetches. |
| `theme` | `auto` | `auto`, `dark` (white text), or `light` (`#24292e`). |
| `edit` | `1` | `0` hides the edit link. |
| `now` | today | Testing override, strict `YYYY-MM-DD` in local time. |
| `demo` | `0` | `1` uses built-in sample data instead of GitHub. |

URL-encode parameter values, especially paths or refs containing spaces, `#`,
`&`, or `+`. Invalid parameters produce a setup error rather than quietly
changing behavior. Nonzero `refresh` values must be between one second
(`0.016666666666666666` minutes) and the browser timer maximum (approximately
35,791 minutes).

Fetching uses GitHub's raw Contents API and browser cache revalidation. The
last good CSV is cached in `localStorage` by repo/ref/path, **never by token**.
Blocked iframe storage does not prevent the app from working. Later fetch
failures retain the last good data and warn in the console; HTTP 4xx errors
(such as an expired token) also show a small notice with the hint, even over
cached data, until a fetch succeeds. An initial failure
shows an HTTP-specific hint; the edit link remains available. A refresh also
retries after first-load errors. With `refresh=0`, only the initial request
runs; reload to retry.

Calendar rollover is checked every 60 seconds even with fetching disabled.
Returning to a visible tab recomputes immediately and fetches if the refresh
interval has elapsed. Unchanged views are not re-rendered.

### Token hygiene

For private repositories, create a **fine-grained PAT**, limited to only the
data repository, with **Contents: Read-only** and an expiry. Organization-owned
repositories may require administrator approval. Prefer a dedicated repository
with no sensitive files: the token can read all its contents.

**Every dashboard viewer can read the iframe URL and token. Never commit a
token**, including in dashboard JSON. Enter it only in the Grafana panel
configuration. Public repositories work without one, but GitHub's unauthenticated
limit is 60 requests/hour **per IP**, shared by viewers behind an office network.
Authenticated requests usually allow 5,000/hour.

The app sends no referrer and does not include tokens in edit links, error
messages, or cache keys. A 401 means the token is invalid/expired. A 403 indicates
rate limiting or missing/unapproved access; a 404 can also mean the token
cannot see a private repository. Rotate tokens by changing the panel URL.

## Embed in Grafana

Use a **Text** panel in **HTML** mode with panel transparency enabled:

```html
<iframe
  title="Sprint names"
  src="https://samhavos.github.io/weekly-text/?repo=your-org/sprint-names&amp;theme=dark"
  style="border:0;width:100%;height:100%">
</iframe>
```

Some Grafana installations require `[panels] disable_sanitize_html = true`
to allow iframes in Text panels. This is a Grafana administrator setting with
broader implications; follow your deployment's policy. Sandboxed panels must
allow popups for the edit link to open GitHub.

`theme=auto` uses `prefers-color-scheme`, which in an iframe follows the
embedding element's used color scheme. Grafana's behavior depends on its
version and theme settings; check in your actual dashboard. If text is wrong,
set `theme=dark` or `theme=light` to match Grafana. A mismatched iframe color
scheme can produce an opaque background even though the app's CSS is transparent.

## Publish to GitHub Pages

The app uses relative asset URLs and works at any sub-path, including
`/weekly-text/`. CSV edits require no redeployment.

1. Commit the app on local `main` and run `npm ci`.
2. Ensure local `main` is up to date and the worktree is clean.
3. Run `bash scripts/deploy.sh` from a source branch.
4. In GitHub **Settings > Pages**, choose **Deploy from a branch**, branch
   **deploy**, folder **/docs**.

The script fetches `origin`, resets the disposable local `deploy` branch to
**local `main`**, type-checks and builds, adds `docs/.nojekyll`, and publishes
with `--force-with-lease`. It restores your starting branch on success or
failure. It does **not** update local `main` or install dependencies. Force
pushes must be allowed on `deploy`; do not keep independent work on that branch.
Generated output is ignored on source branches.

For the full behavior and rationale, see [DESIGN.md](./DESIGN.md). Real private
repository credentials and a deployed Grafana instance are needed to verify
your organization-specific access and embedding configuration.
