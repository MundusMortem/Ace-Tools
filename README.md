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
Ace. Ace barcode search is attempted directly before catalog tracking links, including
when the catalog has no matching item. After those attempts miss, up to two Ace
search-result product links are checked concurrently within a shared 2.5-second
budget; exact GTIN verification is still required. If a matching catalog link resolves
to an Ace item number but the product page is blocked, that number is displayed as
a catalog match. Unconfirmed retailer item numbers are marked not verified; absence
is not a claim that the retailer does not sell the item. When Ace supplies no item number, Klem's public Ace dealer catalog is checked with a 2.5-second budget. An exact barcode match supplies a labeled, selectable dealer SKU; it never imports automatically. The standalone scanner also offers Copy Ace SKU. True Value is checked only
when Ace returns no item number, within a two-second budget. No retailer price
lookup or comparison is performed. Item lookups are cached for five minutes.
Unknown items and provider failures retain direct store search links.

UPCitemdb's signup-free trial allows 100 combined requests/day. The app caches
lookups for five minutes and reserves at most 90 uncached requests/day, with a per-IP
burst limit. Quota/provider errors are explicit; no paid subscription is created.
Retailer fetches are restricted to approved public hosts, refuse unsafe redirects,
have bounded response sizes, and require exact barcode matches before trusting data.

## Special Orders

The Special Orders tab uses the shared barcode scanner. Verified Ace item numbers
fill the SKU field directly. An Ace catalog match can be selected in the scanner.
Stock orders include the QOH reminder. Customer orders require a positive whole
quantity, notes, and customer name and contact info. The form confirms a send and
requires an explicit action to start another order. Retries reuse the order
reference. The backend retains delivery markers for 48 hours and blocks resends
when delivery is uncertain.

The Google Apps Script backend lives in `apps-script/special-orders.gs`. To activate
the tab, update the Apps Script project behind the `endpoint` in
`dist/special-orders/orders.mjs` with that file. In **Project Settings → Script
properties**, set:

- `SPECIAL_ORDER_RECIPIENTS` to the current Shorewood Ace order inbox for the first deployment.
- `SPECIAL_ORDER_ADMIN_PASSWORD` to the store's chosen admin PIN.

In **Deploy → Manage deployments**, edit the existing web app and select a new
version to keep its URL. The web app must execute as the store account with
MailApp permission and be accessible to the public form. If using a separate
deployment, update the frontend endpoint. The tab checks the backend protocol
before posting so the original handler cannot receive admin requests. The
original standalone HTML can still submit valid orders at the same URL. Retry
protection uses an order reference supplied by the Ace Tools tab.

Sign in to **Admin** as `admin` to change recipients. Changes apply to all users and
persist in Script Properties. Keep the PIN and recipient settings out of Git.

## Screen Pricing

The Screen Pricing tab calculates screen and glass estimates with an itemized
breakdown. Width comes before length. Admin uses the same credentials as Special
Orders. All material, labor and add-on rates and the percentage adjustment are
shared and stored in Apps Script. The original rates are used until the first save.

Screen Pricing uses the same deployed Apps Script web app as Special Orders.
Deploy the updated script from the existing sender account before publishing the
frontend. Keep both frontend endpoint URLs aligned when moving the deployment.

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
node tests/special-orders.test.mjs
python3 scripts/build-worker.py
```

Requires Python 3 and Node 24. The API tests run all migration SQL against an isolated in-memory SQLite database. Browser preview requires the supported managed preview/browser tools.

## Deployment

Pushes to GitHub `main` publish `dist/` through the Pages workflow. Backend changes also require packaging `outputs/site/` from the exact pushed Sites source commit, saving the version, and deploying through Sites. Keep the API origin in `dist/higher-ground-dashboard/dashboard.mjs` and the Worker CORS allowlist aligned with both frontend origins.

The Sites project and GitHub repository share source but have separate deployments. Static Pages hosting cannot run the shared database API on its own.
