#!/usr/bin/env bash
# Full pipeline, in the only order that keeps the derived assets.
#
# A re-import rebuilds data.json from the school feeds, which resets `logo` and `photo`
# back to whatever the old in-import parsers could find (210 logos, 1,312 headshots).
# The top-up scripts below restore the full sets, so they must run after the import and
# before the build.
#
#   ./scripts/rebuild-all.sh            # use the HTTP cache
#   ./scripts/rebuild-all.sh --refresh  # refetch every page
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── import"
python3 scripts/fetch-real-data.py "$@"

echo "── logos (school marks, SVG rasterised in Chromium)"
python3 scripts/fetch-logos.py

echo "── headshots (both Sidearm roster card templates)"
python3 scripts/fetch-headshots.py

echo "── repair (negatives, duplicate clubs, orphan teams)"
python3 scripts/repair-data.py

echo "── previous-season records"
python3 scripts/fetch-historical-results.py 2026 2025 2024 2023 || true
python3 scripts/attach-history.py

echo "── polls (skips cleanly if the browser fetch is unavailable)"
python3 scripts/update-rankings.py || true

echo "── scores"
python3 scripts/fetch-scores.py 2026 2025 || true

echo "── integrity check"
python3 scripts/check-data.py

echo "── build"
npm run build

echo "── deploy"
python3 scripts/deploy-netlify.py
