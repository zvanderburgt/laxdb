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

echo "── D1 bios from archived per-season rosters (2022-2025)"
python3 scripts/fetch-d1-rosters.py --apply || true

echo "── box bios (GameSheet: dob, hometown, height/weight, jersey, photos, club logos)"
python3 scripts/fetch-gamesheet.py --apply || true

echo "── repair (negatives, duplicate clubs, orphan teams)"
python3 scripts/repair-data.py

echo "── club renames (Wikipedia lineage, e.g. Elora Mohawks -> Elora Hawks)"
python3 scripts/fetch-franchises.py --apply || true

echo "── re-merge duplicates now that dobs and club identity are known"
python3 scripts/merge-now.py

echo "── box positions (Forward / Transition / Defense from GameSheet + Digitalshift)"
python3 scripts/fetch-positions.py --apply

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
