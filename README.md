# Ace Tools

Glossy dark tool hub with a shared Higher Ground dashboard.

## Dashboard

The GitHub Pages frontend and the Sites frontend use the same Sites Worker API and persistent D1 database. No dashboard records are stored in Git or browser storage. Session storage holds only the visitor access code and the expiring admin session.

- Enter the lowercase visitor code to reveal the dashboard.
- Enter build mode with the configured admin credentials.
- Add or edit a metric, category, positive goal, and current number.
- Each number update records the previous value and change history.
- In-progress cards sort first; categories filter the shared cards.
- Choose absolute numbers, percentages, or US dollars per card. Enter 25 for 25%; percentage changes are shown in percentage points (pp). Formats apply to current, goal, previous numbers, and history.
- Progress discs show current progress in blue, the remaining gap in glowing red, and excess in green. Exceeding a goal adds a gold border and glow.
- Other visitors refresh shared data every 15 seconds while the page is visible.

The shared code and password provide basic access control. Use stronger values for sensitive data. The source repository is public by the user's choice.

## Source

- `dist/`: static frontend published to GitHub Pages.
- `worker/index.js`: API, access checks, persistent writes, and static route handler.
- `drizzle/`: immutable D1 schema migrations.
- `.openai/hosting.json`: Sites identity and database binding.
- `scripts/build-worker.py`: bundles static assets and the Worker into `outputs/site/`.
- `tests/dashboard.test.mjs`: API integration tests against SQLite and progress/sort checks.

## Runtime configuration

Store `ADMIN_PASSWORD`, `VIEW_CODE`, and a random `SESSION_SECRET` in Sites runtime secrets. The username is `admin`. Passwords and signing keys must never be placed in static files, Git, or frontend build variables. The Worker reads `env.DB` from the Sites-provisioned D1 binding. Sites applies migrations before deployment.

## Checks and builds

```sh
python3 scripts/check.py
node tests/dashboard.test.mjs
python3 scripts/build-worker.py
```

Requires Python 3 and Node 24. The API tests run all migration SQL against an isolated in-memory SQLite database. Browser preview requires the supported managed preview/browser tools.

## Deployment

Pushes to GitHub `main` publish `dist/` through the Pages workflow. Backend changes also require packaging `outputs/site/` from the exact pushed Sites source commit, saving the version, and deploying through Sites. Keep the API origin in `dist/higher-ground-dashboard/dashboard.mjs` and the Worker CORS allowlist aligned with both frontend origins.

The Sites project and GitHub repository share source but have separate deployments. Static Pages hosting cannot run the shared database API on its own.
