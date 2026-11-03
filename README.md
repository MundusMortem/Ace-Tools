# Ace Tools

A static, dependency-free tool hub with a glossy dark and red theme.

## Pages

- `dist/index.html`: landing page and tool links.
- `dist/special-orders/index.html`: Special Orders scaffold.
- `dist/screen-pricing/index.html`: Screen Pricing scaffold.
- `dist/higher-ground-dashboard/index.html`: Higher Ground Dashboard scaffold.

Tool pages are unconfigured scaffolds. Replace them with tool implementations, or change the three landing-page links to existing tool URLs.

## Local preview

Run `python3 -m http.server 8080 --directory dist` and open http://localhost:8080.

## Private GitHub repository and public GitHub Pages

Create a **private** repository named `ace-tools`, push this source, then choose **GitHub Actions** under Settings → Pages. The included workflow publishes only `dist/` on pushes to `main`.

GitHub Pages from a private repository requires a supported paid plan (GitHub Pro, Team, or Enterprise). Set the Pages site audience to public where the setting is available. Repository privacy and site access are separate. Published HTML, CSS, and browser code are publicly downloadable; never put secrets in `dist/`.

If the GitHub plan does not support Pages from private repositories, retain private GitHub source and use the public Sites deployment.

Run `python3 scripts/check.py` before pushing.
