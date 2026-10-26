#!/usr/bin/env bash
# Builds the LIVE www.illtip.com package into ./live/:
#   - the React app (live backend, served at /, indexable)
#   - files from the old Angular site that must keep working: /.well-known (iOS/Android app links),
#     favicon.ico, and /assets (landing page for /information, images referenced by emails).
# Usage: scripts/package-live.sh /path/to/illtip-frontend
set -euo pipefail
OLD="${1:-../illtip-frontend}"
node build.mjs --prod --base=/
rm -rf live && mkdir -p live
cp -r "$OLD/src/assets" live/assets
cp -r "$OLD/src/.well-known" live/.well-known
cp "$OLD/src/favicon.ico" live/favicon.ico
cp -r dist/* live/
# Public pages pre-rendered for Google (title, description, text without JS) + sitemap.xml + robots.txt.
NODE_PATH="${NODE_PATH:-/opt/npm-tools/node_modules}" node scripts/prerender.mjs live
# The app is a single-page app: the web server must try the pre-rendered page, then fall back to index.html
# (nginx: try_files $uri $uri/index.html /index.html).
echo "live/ ready: $(du -sh live | cut -f1)"
