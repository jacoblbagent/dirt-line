# Headless verification

Playwright-core driving swiftshader Chromium against the served game. Needs
`playwright-core` installed somewhere (the scripts resolve it from the caller's
node_modules), e.g.:

```bash
mkdir -p /tmp/verify && cd /tmp/verify && npm init -y && npm i playwright-core@1.49.1
cp ~/Code/dirt-jumps/tests/verify.js /tmp/verify/ && cd /tmp/verify && node verify.js
```

- `verify.js` — 63 mechanic checks against `http://127.0.0.1:5187` (override with `APP_URL`).
- `deployed-check.js` — smoke test a deployed URL: dig → pour → pack → plan → save/load.
- `shots.js` — builds a jump line in-page and captures review screenshots.

Chromium path is hard-coded near the top of each script
(`~/.cache/ms-playwright/chromium-1243/...`) — adjust if the revision changes.
