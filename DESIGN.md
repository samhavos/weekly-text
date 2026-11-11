# Sprint Names Wallboard — Design

A small static web app, embedded full-panel in a Grafana dashboard. It shows the
current sprint's name, the past names stacked above it, and keeps queued future
names hidden. The names live in a CSV file in a GitHub repo, and people edit
them on github.com. All fetching and rendering happens in the browser.

## 1. Goals and non-goals

**Goals**

- Show the current sprint name in large text, horizontally centred, just below
  the vertical centre of the panel.
- Show previous names above it in sequence, getting smaller and fainter. Show as
  many as fit, fading out towards the top.
- Let people queue future names in the CSV. They are never displayed.
- Show `???` when no name has been set for the current period.
- Show a link straight to the GitHub edit page for the CSV.
- Configure everything through query parameters, so embedding is just one URL.
- Pure client-side rendering with no backend. React and React DOM are the only
  runtime libraries (an implementation-time choice for ease of iteration).
- Work when served from any sub-path (the deployment is
  `https://samhavos.github.io/weekly-text/`).
- Nice to have: update in place (new data, week rollover) without a reload.

**Non-goals**

- Editing from inside the app. All edits happen on github.com.
- Managing who can edit. Repo permissions are handled in GitHub, outside the app.
- Keeping queued names truly secret. Anyone who can view the dashboard can get
  the token from the iframe URL and read the file. Queued names are hidden from
  the display only, not from people who go looking.

## 2. Data source

### 2.1 CSV format

The data is a single CSV file (default `sprints.csv`) in a GitHub repo you
control:

```csv
date,name
2026-09-14,Sprinty McSprint
2026-09-21,Bugs Bunny
2026-09-28,Merge Conflict
2026-10-05,Friday Deploy
2026-10-12,"Works On My Machine, Again"
```

- **Columns are positional.** The first column is the date in strict
  `YYYY-MM-DD` format, parsed as a local date. The second is the name. Extra
  columns (e.g. `suggested_by`) are allowed and ignored.
- **A row is skipped** if its date doesn't parse or its name is empty after
  trimming. This drops the header row and blank lines without special handling.
- **Order:** rows can be in any order. The app sorts them by date, and when two
  rows share a date the later row in the file wins.
- **Parsing:** a small built-in RFC 4180 parser handles:
  - quoted fields and `""` escapes;
  - CRLF and LF line endings;
  - a leading UTF-8 BOM.

  Malformed quoting never fails the file: stray quotes are kept as literal
  text, and an opening quote that is never properly closed is treated as a
  literal character so it can't swallow later rows.
- **What editors see:** GitHub shows the CSV as a searchable table and warns
  when a row is malformed, which gives people some validation for free.

In practice every date is a Monday, but the app doesn't enforce that.

### 2.2 Fetching

The app reads the file through the GitHub REST contents API, which works from
the browser without help (CORS: `Access-Control-Allow-Origin: *`, and
`Authorization` is allowed):

```
GET https://api.github.com/repos/{repo}/contents/{path}?ref={ref}
Accept: application/vnd.github.raw+json
Authorization: Bearer {token}          // omitted if no token is given
X-GitHub-Api-Version: 2022-11-28
```

- **Raw content:** the `raw` media type returns the file contents directly, so
  there's no base64 JSON envelope to unwrap.
- **Caching:** the fetch uses `cache: "no-cache"`. The browser revalidates with
  the stored `ETag`, so an unchanged file comes back as a cheap `304`. Edits
  show up on the next refresh, after at most about 60 s of API-side caching.
- **Rate limits:**
  - with a PAT: 5,000 requests per hour, far more than a 5-minute poll needs;
  - without one (public repos only): 60 requests per hour **per IP**. Several
    viewers behind one office IP could hit that, which is another reason to use
    a token.
- **Why not `raw.githubusercontent.com`?** It doesn't reliably handle CORS
  preflight for authenticated requests, so the app uses `api.github.com`.

### 2.3 Token hygiene

The PAT ends up in the Grafana dashboard JSON and the iframe URL, so treat it as
readable by every dashboard viewer:

- **Use a fine-grained PAT:**
  - scoped to **only the data repo**;
  - **Contents: Read-only** (Metadata: Read-only is added automatically);
  - with an expiry date.
- **Org approval:** your org may need to approve fine-grained PATs that access
  org-owned repos.
- **Repo contents:** keep the data repo free of anything sensitive, since the
  token can read all of it. A dedicated tiny repo, or this app repo, is ideal.
- **Never commit the token**, not even inside a dashboard JSON or the app
  repo. GitHub secret scanning will flag it, and if it reaches a public
  repo GitHub will revoke it. It should exist only in Grafana's panel config.
- **Referrer:** the page sets `<meta name="referrer" content="no-referrer">`,
  so the URL with the token in it is never sent as a `Referer`.
- **Expiry:** when the token expires, the app shows a clear `401` hint (§5.5).
  To rotate, edit the Grafana panel URL.

## 3. Schedule logic

All dates are compared as **local calendar dates** in the browser's timezone.
This is a pure function, `computeView(rows, now, opts)`, and it gets unit tests.

```
today   = local calendar date of `now`
rows    = valid rows, stable-sorted by date ascending
past    = rows where row.date <= today        // a row dated today is current from 00:00
queue   = rows where row.date >  today        // ignored, never rendered
latest  = last(past)

if latest is missing, or daysBetween(latest.date, today) >= staleDays:
    current = "???"
    history = past                            // latest moves up into history
else:
    current = latest.name
    history = past without latest

history = reverse(history)                    // most recent first (closest to current)
history = history.slice(0, maxHistory)        // if a cap is configured
```

- `staleDays` defaults to **7**. With weekly Monday rows, a name stays current
  until the following Monday 00:00. If nothing is queued by then, the display
  flips to `???`.
- `daysBetween` counts calendar days through `Date.UTC(y, m, d)` on the local
  date parts, so DST changes can't cause off-by-one errors.
- Weeks that showed `???` leave **no entry in history**. The app is stateless,
  so history only ever contains real CSV rows.
- Backfilling works for free: if someone commits a row for this week while
  `???` is showing, it becomes current on the next fetch.

Worked example (today = Mon 2026-10-05, staleDays = 7):

| CSV contains up to…           | Current         | History (top → bottom)                         |
|-------------------------------|-----------------|------------------------------------------------|
| …2026-10-05 Friday Deploy     | Friday Deploy   | Sprinty McSprint, Bugs Bunny, Merge Conflict   |
| …2026-09-28 Merge Conflict    | ???             | Sprinty McSprint, Bugs Bunny, Merge Conflict   |
| …2026-10-01 Late Addition     | Late Addition   | …, Merge Conflict                              |

## 4. Configuration (query parameters)

| Param     | Required | Default       | Meaning                                                                    |
|-----------|----------|---------------|----------------------------------------------------------------------------|
| `repo`    | yes¹     | —             | `owner/name` of the repo holding the CSV.                                  |
| `path`    | no       | `sprints.csv` | Path to the CSV within the repo.                                           |
| `ref`     | no       | `main`        | Branch (or tag/SHA) to read from and to link edits to.                     |
| `token`   | no²      | —             | Fine-grained PAT (see §2.3).                                               |
| `stale`   | no       | `7`           | Days after a row's date before the display falls back to `???`.            |
| `history` | no       | ∞             | Maximum number of past names shown. Leave unset to fill the space.         |
| `refresh` | no       | `5`           | Minutes between re-fetches. `0` disables re-fetching.                      |
| `theme`   | no       | `auto`        | `auto` \| `dark` \| `light`. See §5.3.                                     |
| `edit`    | no       | `1`           | `0` hides the edit link.                                                   |
| `now`     | no       | —             | Testing only: pretend today is `YYYY-MM-DD`.                               |
| `demo`    | no       | —             | `demo=1` uses built-in sample data in place of GitHub (local dev, screenshots). |

¹ Not required when `demo=1`.
² Required for private repos. Optional for public repos, but recommended
because of rate limits.

Example embed URL:

```
https://samhavos.github.io/weekly-text/?repo=<org>/sprint-names&token=github_pat_…
```

## 5. Presentation

### 5.1 Layout

```
┌──────────────────────────────────────────────┐
│               Sprinty McSprint               │  ← faded out by the mask
│                  Bugs Bunny                  │
│                Merge Conflict                │  ← history (smaller, lower opacity)
├ ─ ─ ─ ─ ─ ─ ─ ─ vertical centre ─ ─ ─ ─ ─ ─ ─┤
│                FRIDAY DEPLOY                 │  ← current (large, bold, full opacity)
│                                              │
│                                ✎ Edit names  │  ← edit link (small, faint)
└──────────────────────────────────────────────┘
```

- **Current name**: its top edge sits a small gap below 50% of the viewport
  height. Bold, centred, full opacity.
- **History**: a column filling 0–50% of the height, bottom-aligned
  (`flex-direction: column; justify-content: flex-end`). The most recent name
  sits right above the current one and older names stack upwards. Anything
  that doesn't fit is clipped (`overflow: hidden`).
- **Fade**: the history column has reduced opacity (≈0.5) plus a vertical
  `mask-image: linear-gradient(transparent, black)`. Names get fainter towards
  the top and disappear smoothly instead of being cut off. Because everything is
  done with opacity, the "grey" adapts to whatever the text colour is.
- **Sizing** (CSS custom properties, easy to tune):
  - Current: `font-size: min(12vw, 20vh)`.
  - History: about 0.6× the current size, i.e. "slightly smaller".
  - All names are `white-space: nowrap`. If a long name overflows the width, a
    small fit-text routine shrinks that line's font size until it fits. It runs
    again on `ResizeObserver` callbacks.
- **Font**: the system sans-serif stack
  (`system-ui, -apple-system, "Segoe UI", Roboto, Inter, sans-serif`). No
  external requests.

### 5.2 Edit link

- **Target:** `https://github.com/{repo}/edit/{ref}/{path}`. This is GitHub's
  web editor for the CSV.
  - People with write access commit directly or open a PR.
  - Anyone else gets GitHub's usual fork-and-propose flow.
  - GitHub, not the app, decides who can do what.
- **Look:** small text (`✎ Edit names`) in the bottom-right corner, in the theme
  text colour at ≈0.35 opacity, rising to full opacity on hover and focus.
  - It's always visible rather than hover-only, so people browsing the
    dashboard can find it. On a wallboard TV it's just a faint label.
- **Behaviour:** opens with `target="_blank" rel="noopener noreferrer"`. GitHub
  refuses to be framed, so it can't open inside the iframe.
  - If Grafana ever wraps the panel in a sandboxed iframe, popups need to be
    allowed for the link to work.
- **Visibility:** shown whenever `repo` is set, including in error states, so a
  broken CSV can be fixed straight from the dashboard. `edit=0` hides it.

### 5.3 Background

The page is transparent (`html, body { background: transparent }`). Panel
transparency is turned on in Grafana, so the dashboard shows through.

### 5.4 Theme and text colour

CSS can't inherit across an iframe boundary, and the Grafana origin is
cross-origin, so the app can't read Grafana's styles. The plan:

- **`theme=auto` (default)**: set `color-scheme: light dark` on `:root` and pick
  the text colour with `@media (prefers-color-scheme: …)`.
  - Per spec, `prefers-color-scheme` inside an iframe follows the **embedding
    `<iframe>` element's used colour scheme**, not the OS. If Grafana sets
    `color-scheme` to match its theme, the colour follows Grafana's theme
    automatically.
  - To verify during implementation: what current Grafana does with
    `color-scheme`, and how Chrome/Firefox behave.
- **`theme=dark|light`**: an explicit override for when `auto` guesses wrong.
  It sets both `color-scheme` and the text colour.
- **Colours**: dark text is white (`#fff`), as the brief asks. Light text uses
  Grafana's light primary text colour (`#24292e`).
- **Transparency gotcha**: browsers paint an **opaque** backdrop behind an
  iframe whose document colour scheme differs from its embedder's. If a
  white/black box appears behind the text, the `theme` setting and Grafana's
  theme disagree.

### 5.5 Non-happy states

All of these are small, muted and centred, never a full-screen error:

| State                         | Display                                                                         |
|-------------------------------|---------------------------------------------------------------------------------|
| `repo` missing                | A short setup hint listing the params.                                          |
| First fetch fails             | `Couldn't load sprint names (HTTP 401)`, plus a hint for the status code (below). |
| Later fetch fails             | Keep showing the last good data and log a `console.warn`. For HTTP 4xx (e.g. expired token), also show a small notice with the hint until a fetch succeeds. |
| CSV has no valid rows         | Current = `???`, no history.                                                    |

Hints by status code:

- **401:** the token is invalid or expired.
- **403:** if `x-ratelimit-remaining: 0`, it's the rate limit. Otherwise the
  token lacks access, or the org hasn't approved it.
- **404:** the repo, path or ref is wrong, or the token can't see the repo.
  GitHub returns 404 rather than 403 for private repos the token can't access.

All CSV text is inserted with `textContent`, never `innerHTML`.

## 6. Runtime behaviour

1. **Start-up.** Parse the config. If cached CSV text exists in `localStorage`,
   render it immediately. This avoids a blank flash when Grafana reloads the
   panel.
   - The cache is keyed by `repo`+`ref`+`path` and never stores the token.
   - Every read and write is wrapped in try/catch, because third-party iframe
     storage may be partitioned or blocked.
2. **First fetch.** Fetch the CSV → parse the rows → `computeView` → render →
   update the cache.
3. **Every `refresh` minutes:** re-fetch, then re-render **only if the computed
   view changed**, so the display doesn't flicker.
4. **Every 60 s:** recompute from the rows already in memory. This catches the
   Monday midnight rollover (or the stale → `???` flip) without a fetch.
5. **On `visibilitychange` back to visible:** recompute right away, and re-fetch
   if the last fetch is older than the refresh interval.

## 7. Implementation

### 7.1 Stack

React with TypeScript (ES modules), HTML and CSS. React was chosen during
implementation for ease of understanding and iteration; React and React DOM
are the only runtime dependencies. There is no router, UI kit, or state library.
Use **Vite as a development/build dependency**, with npm and a committed
`package-lock.json`. TypeScript checks run before production builds, including
in the deployment script. Node.js 22.18+ (or 24+) runs the TypeScript unit tests
directly without a separate test framework or transpiler.

### 7.2 Repository layout

```
index.html            # loads ./src/main.tsx (relative paths only)
vite.config.ts        # base: "./", build.outDir: "docs"
tsconfig.json         # strict type checks for app, tests, and build config
src/
  main.tsx            # bootstrap and configuration errors
  App.tsx             # React wallboard, fit-text, edit link, setup/errors
  useSprints.ts       # fetch lifecycle, timers, cached startup, stable updates
  config.ts           # query param parsing + validation
  github.ts           # contents API fetch, error → hint mapping, edit URL
  csv.ts              # RFC 4180 parser + row extraction (date/name)
  dates.ts            # strict local dates and DST-safe calendar arithmetic
  schedule.ts         # pure computeView()
  cache.ts            # guarded localStorage, token-free keys
  demo.ts             # fixed sample CSV for previews
  style.css
test/
  schedule.test.ts    # node:test (built-in), covers §3 incl. stale, ties, DST
  csv.test.ts         # quoting, CRLF, BOM, junk/header rows, date parsing
  config.test.ts      # defaults and validation
  github.test.ts      # URLs, request headers, status/error hints
  cache.test.ts       # source isolation, token exclusion, blocked storage
e2e/
  fixtures.ts         # isolated Playwright contexts and mocked GitHub API
  wallboard.spec.ts   # layout, assets, fitting, themes, setup, query options
  github.spec.ts      # errors, auth/cache hygiene, refresh, rollover, visibility
playwright.config.ts  # Chromium projects for root and /weekly-text/ builds
scripts/
  deploy.sh           # builds main into docs/, pushes origin/deploy, restores branch
docs/                 # generated Vite output; ignored on source branches
examples/
  sprints.csv         # starter file for the data repo
package.json          # Vite dev/build/preview scripts, "test": "node --test"
package-lock.json     # pins build dependencies; install with npm ci
README.md             # setup: data repo, PAT, deployment, Grafana embed snippet
```

The app is implemented. See README.md for local setup, query parameters, and
deployment instructions. Invalid query parameters are reported explicitly;
malformed CSV quoting is parsed leniently (§2.1) rather than failing the board.
Nonzero refresh intervals are constrained to one second through the browser's
maximum timer delay. Requests time out after 30 seconds; later failures keep
the last good data, with a small notice for HTTP 4xx errors (§5.5).

### 7.3 Sub-path safety

- Source asset references are relative (`./src/…`), and Vite's `base: "./"`
  keeps generated asset URLs relative too. The app has no root-absolute paths,
  no client-side routing and no service worker.
- Config is read from `location.search` only, so the mount path doesn't matter.
- `docs/` is self-contained. GitHub Pages serves it at `/weekly-text/`, not
  `/weekly-text/docs/`. Relative asset URLs also allow it to be mounted at a
  different sub-path without rebuilding.
- The data is fetched at runtime from the GitHub API, not baked into the build.
  An edit to the CSV therefore needs no app redeploy.
- Test the production output both at `/` and mounted under `/weekly-text/`
  using a local static server; a Vite dev-server check alone is not enough.

### 7.4 Grafana embed

Use a Text panel in HTML mode with transparency turned on:

```html
<iframe src="https://samhavos.github.io/weekly-text/?repo=<org>/sprint-names&token=github_pat_…"
        style="border:0;width:100%;height:100%"></iframe>
```

Depending on the Grafana version and config, iframes in Text panels may need
`disable_sanitize_html = true`. The README will cover this. GitHub Pages sends
no `X-Frame-Options` header, so framing is allowed.

### 7.5 GitHub Pages deployment

- **Hosting:** this repo is a GitHub Pages **project site**, published at
  `https://samhavos.github.io/weekly-text/`; no parent Pages repo or submodule
  is involved.
- **Pages settings:** after the first deployment creates the remote branch,
  choose **Settings → Pages → Build and deployment → Deploy from a branch**,
  branch **`deploy`**, folder **`/docs`**.
- **Build config:** when scaffolding the app, set Vite's `base` to `"./"` and
  `build.outDir` to `"docs"` so `npm run build` matches deployment. Vite
  otherwise defaults to base `"/"` and output directory `"dist"`, which do
  not match this workflow.
- **Prerequisites:** a committed app, a local `main` branch, Git, Node.js/npm
  compatible with the installed Vite, and push access to `origin`. On `main`,
  run `npm ci` to install the locked build dependencies. Commit or stash all
  source changes before deploying. The script does not install dependencies.
- **Run:** `bash scripts/deploy.sh`. It fetches `origin`, resets the local
  `deploy` branch to **local `main`**, and runs
  `npx --no-install vite build --base=./ --outDir docs --emptyOutDir`.
  Fetching does **not** pull or merge `origin/main`: update local `main`
  yourself first if needed. Changes present only on another branch are not
  deployed.
- **Type safety:** the script runs `npx --no-install tsc --noEmit` before Vite,
  matching the checks in `npm run build`.
- **Publish:** verify `docs/index.html`, add `docs/.nojekyll` to bypass Jekyll,
  force-add the ignored `docs/` output, commit it, and push `deploy` to
  `origin` using `--force-with-lease`. The branch contains the source snapshot
  plus the generated site, but Pages serves only `/docs`. It is a disposable
  deployment branch, not a place for independent source edits; its history is
  replaced on deployment, so branch rules must permit force pushes.
- **Checkout safety:** require a clean working tree and a source branch
  (neither detached HEAD nor `deploy`). Restore the original branch on both
  success and failure. Generated `docs/` remains ignored on source branches.
- **Copied-script review:** it could not be used verbatim here. It assumed
  missing Vite configuration, only checked for a directory rather than the
  built entry page, edited `.gitignore` unnecessarily, staged every change,
  and only returned to `main` after a successful push despite promising to
  restore the starting branch. The repo's script now supplies explicit build
  flags, uses the installed Vite rather than downloading one implicitly,
  stages only the generated output without changing ignore rules, and restores
  the starting branch through an exit trap.

The script has no repo-specific remote URL or project-path constant: `origin`
already points at `samhavos/weekly-text`, and the relative base handles the
project path. No custom GitHub Actions deployment workflow is required for
this branch-publishing approach. A live deployment still requires running the publishing script with push
access; local production builds can be checked with `npm run build`.

## 8. Testing

- **Unit tests** (`node --test`) for `computeView`:
  - empty file, all-future rows, row dated today, stale boundary (day 6 vs
    day 7), duplicate dates, unsorted input, `history` cap;
  - DST transitions, using `TZ=Europe/Oslo` on the test run.
- **Unit tests** for CSV parsing: quoted commas, escaped quotes, CRLF, BOM,
  trailing newline, header and junk rows, invalid dates (`2026-02-30`,
  `5/10/2026`).
- **Unit tests** for the GitHub URLs: the API URL and edit URL built from
  `repo`/`path`/`ref`, including paths with sub-directories and special
  characters.
- **Browser regression tests** live in `e2e/`; do not run them as ad hoc browser
  scripts. Run `npx playwright install chromium` once, then `npm run test:e2e`.
  The command builds and type-checks the app and runs Chromium against the
  production output at both `/` and `/weekly-text/`. Playwright owns the two
  preview servers and stops them when done. GitHub responses are mocked and
  browser contexts are isolated, so no real tokens or existing storage are used.
  Coverage includes responsive layout and asset URLs, long-name fitting, text
  escaping, hidden future names, themes/iframe color schemes, query options,
  edit links, status-specific errors and notices over cached data, lenient
  CSV quoting, token hygiene, cached/blocked storage,
  refresh recovery, unchanged-view DOM stability, timeout, local-midnight
  rollover, and visibility-triggered updates. Fake clocks avoid long waits;
  failure traces and screenshots go in ignored `test-results/`.
- **Manual checks**:
  - dark/light Grafana themes (checking for the opaque backdrop gotcha);
  - against a real private repo with a fine-grained PAT, including an expired
    or revoked token.

## 9. Defaults I picked (shout if any are wrong)

- Columns are positional (date, then name), not matched by header name.
- Default re-fetch interval is 5 minutes, with a 60 s rollover check.
- History renders at about 0.6× the current name's size and about 0.5 opacity,
  fading to nothing at the top.
- The edit link is always faintly visible in the bottom-right, and `edit=0`
  hides it.
- `ref` defaults to `main` rather than looking up the default branch, which
  saves an API call.
- `demo` and `now` params exist for development and testing.
- The last good CSV text is cached in `localStorage` to avoid blank flashes on
  reload.

## 10. Possible follow-ups (out of scope)

- A GitHub Action in the data repo that validates the CSV on PRs and pushes:
  every row parses, there are no duplicate dates, and it warns if nothing is
  queued for next Monday. It could reuse `src/csv.ts`.
