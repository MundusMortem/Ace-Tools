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
- Progress discs show current progress in blue, the remaining gap in glowing red, and excess continuing clockwise from 12 o’clock over a complete blue lap. Green shows up to one extra goal lap; the remaining/over-target amount always shows the full numeric difference in each card’s selected units. Exceeding a goal adds a gold border and glow.
- Other visitors refresh shared data every 15 seconds while the page is visible.

The shared code and password provide basic access control. Use stronger values for sensitive data. The source repository is public by the user's choice.

## Barcode scanner

Every Ace Tools header has the shared scanner icon. Its native/ZXing camera and
photo decoder is retained from Mundus Apps Macro Tracker (source revision and
licenses in `dist/scanner/vendor/README.md`). Only the decoder asset path changes;
the original app is untouched. Camera access requires HTTPS, permission, and an
available connected camera. Photo and typed UPC/EAN/GTIN entry are fallbacks.
Frames/photos are decoded locally; only barcode digits go to the Worker lookup API.

UPCitemdb identifies matching items and supplied model numbers. The backend checks
matching retailer GTIN structured data for Ace/True Value item numbers, preferring
Ace, and verifies live product prices when retailer pages permit it. Ace barcode
search is attempted directly before catalog tracking links. If a matching catalog
link resolves to an Ace item number but the product page is blocked, that number
is displayed as a catalog match; no price is verified from the catalog link. Unconfirmed retailer item numbers are marked not verified; absence is not a claim
that the retailer does not sell the item. Only the three lowest distinct merchants with verified, available, new USD item prices
are shown. Every displayed price comes from a fresh, matching retailer product page;
prices expire after five minutes. Unverified catalog prices, stale prices, used items,
member-only offers, out-of-stock items, and other currencies are excluded. Ace nested
UnitPriceSpecification values are supported. Tracking wrappers are unwrapped to approved
HTTPS retailer URLs without fetching the tracker. Check times and direct merchant links
remain visible. Item prices
exclude tax/shipping and local store pricing can differ. No claim of an exhaustive
market search is made. Unknown items and provider failures retain direct store and
shopping search links.

UPCitemdb's signup-free trial allows 100 combined requests/day. The app caches
lookups for five minutes and reserves at most 90 uncached requests/day, with a per-IP
burst limit. Quota/provider errors are explicit; no paid subscription is created.
Retailer fetches are restricted to approved public hosts, refuse unsafe redirects,
have bounded response sizes, and require exact barcode matches before trusting data.

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
node tests/products.test.mjs
node tests/camera.test.mjs
python3 scripts/build-worker.py
```

Requires Python 3 and Node 24. The API tests run all migration SQL against an isolated in-memory SQLite database. Browser preview requires the supported managed preview/browser tools.

## Deployment

Pushes to GitHub `main` publish `dist/` through the Pages workflow. Backend changes also require packaging `outputs/site/` from the exact pushed Sites source commit, saving the version, and deploying through Sites. Keep the API origin in `dist/higher-ground-dashboard/dashboard.mjs` and the Worker CORS allowlist aligned with both frontend origins.

The Sites project and GitHub repository share source but have separate deployments. Static Pages hosting cannot run the shared database API on its own.
