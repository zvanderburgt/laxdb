# CMS — in-place editing on the live pages

An admin-only editor that runs **on the site itself**. You navigate to a page as a visitor would, one
floating dock appears along the bottom, and every editorial field on the page becomes clickable and
editable where it sits. There is no `/admin` route, no form that mirrors the page, and no second copy
of the truth.

The dock is the compare tray's twin. Same geometry, same frosted surface, same shadow, same action
cluster — it differs in what it carries, not in how it looks (`.tray` + `.tray-cms`).

**Preview:** `docs/cms-preview.html` is a static still of the whole surface (hovered field, edited
bio, both bars stacked) and `docs/cms-dock-desktop.png` / `docs/cms-dock-phone.png` are captures of it
at 1440 and 390. Measured from those: the dock is 846×50 at 1440 and 366×50 at 390 — the same 50px as
the tray — and `scrollWidth === clientWidth` at both widths.

**Status.** Phases 0–2 are built and verified — locally against a filesystem store, and against a
deployed draft on real Netlify Blobs. The dock, select mode, the inline field editor and the review
sheet all work end to end: sign in, click a field, type, save, review, publish, reload and the value is
live. What remains is Phase 3 (structured + people + media controls), Phase 4 (per-version history UI,
flags, the orphan report) and Phase 5 (hardening).

**The one constraint everything else follows from:** `public/data.json` is generated. It is rebuilt
by `scripts/rebuild-all.sh` from feeds, and a raw re-import already resets logos and headshots. The
CMS therefore never writes to the dataset. It writes a small **override layer** keyed by stable
entity ids and reapplies it in memory after the dataset normalises. Re-scraping the world must not
cost one word of editorial work.

---

## 1. The editor surface

Three pieces, in the order the editor meets them.

### 1.1 The dock

A fixed frosted bar at the bottom centre, exactly the compare tray: `--nav-bg` with 24px blur and
180% saturation, 1px `--hairline-strong`, 16px radius, `--shadow-lg`, the `trayin` entrance (0.28s,
12px rise), 50px tall. Below 640px it spans the width with 12px insets — the tray's documented phone
behaviour.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ● Editing   Zach Miller · bio ×   Hometown ×   Photo ×      3 unsaved        │
│                                              Undo  Discard  [ Review · 3 ]   │
└──────────────────────────────────────────────────────────────────────────────┘
     left: what changed this session          right: one ghost, one primary
```

- **Left — the change stack.** One chip per edited field, `×` discards it. This is the tray's
  `tray-people` slot: same 8px gap, same 13px/500, same `tray-x` hit area. Visible count.
- **Right — the action cluster.** `Undo` and `Discard` are `btn btn-ghost btn-sm`; `Review · n` is the
  one `btn btn-primary btn-sm`. One blue element, per the One Varsity Rule.
- **Mode chip.** A 6px status dot (`--accent`) + "Editing" in the tray's 13px/500. It is the only
  thing that says the page is live-editable; everything else on the page looks untouched.
- **Exit.** `×` on the far right clears pending state (with a confirm when there is any) and drops to
  viewer mode. `⌘⇧E` toggles back.

At ≤900px the change stack and its divider hide (the dock carries more than the tray, so it sheds
earlier); at ≤640px `Discard` folds into the review sheet and the bar keeps mode, count, `Undo` and
`Review`. The state is never lost by hiding a control — the count is the receipt.

Stacking: `.app:has(.tray-cms) .tray:not(.tray-cms) { bottom: 86px }` — 18 from the bottom, plus the
dock's 50 and 18 of air. The compare tray can be showing on a player page at the same time, and two
bottom bars at `bottom: 18px` would overlap. The existing `main { padding-bottom: 84px }` rule keys
off `.tray`, which the dock carries, so page content already clears it. Note the Netlify badge
(`#nl-badge-frame`, 211×64, fixed bottom-right) is hidden below 640px but sits exactly where the
dock's right end lands at 1024–1440 — check that collision, do not pad around it.

### 1.2 Select mode

Pressing the mode chip (or moving the pointer over the page while the dock is focused) turns the
document into a pick surface. Editable elements are marked once, in the app, with a registry
attribute:

```tsx
<h1 data-cms="player.bio.name" data-cms-id={p.id}>{p.name}</h1>
<p  data-cms="player.bio.text" data-cms-id={p.id}>{p.bio}</p>
```

On hover: `outline: 2px solid var(--accent-soft); outline-offset: 2px` plus a 12px field label chip
carrying the field's own name ("Bio", "Hometown", "Photo") — the house focus-ring look, and the label
is the affordance, so the outline is never the only signal. The chip is a **fixed-position node on
`body`**, like `TermFor`: cards are `overflow: hidden`, so a tip absolutely positioned inside the card
is clipped.

Chip placement is measured, not guessed: **above the element's top-left** by default; flip **below**
when there is less than 34px of clearance above it or the element sits in the top 80px of the viewport.
The still caught the failure case — anchored above-left, an `h1` with a breadcrumb over it put the
label on top of the breadcrumb. Never let the chip cover page chrome or a control; it may cover the
element's own padding.

Click → inline edit. Nothing about the page's layout changes: an input is positioned over the
element's measured rect (`.cms-shadow-input`), carrying the design system's field geometry — 38px,
11px radius, hairline border, accent border + 3px `--accent-soft` ring on focus. A textarea gets the
element's height, or 3 lines, whichever is larger.

Why an overlay input rather than `contenteditable`: no markup surgery inside a React tree, the
browser's own caret, selection and undo keep working, and the commit boundary is a single value — not
a DOM subtree diff.

**Commit ⇄ cancel.** `⌘↵` / `Ctrl+↵` commits, `Esc` cancels, blur cancels (never silently saves).
`Escape` is bound on the container and stops propagation, not on the input alone — the same trap the
palette hit.

Move between fields with `]` / `[` (next/previous in DOM order), which is what makes a page-wide pass
feel like fill-in-the-blanks rather than hunting.

### 1.3 The review sheet

`Review · n` opens the command palette's exact sheet — centred 560px, 18px radius, `--shadow-lg`,
28%-black blurred overlay, `Escape` closes the dialog itself. It lists every pending change as
`Entity · field` with `before → after`, a per-row revert, and the one primary `Publish` at the
footer. After a publish it becomes the receipt: version number, count, and a link to the same page
without the dock.

### 1.4 Field types

The registry names a type; the dock chooses the control. Callers never pick a widget.

| Type | Control | Used by |
| --- | --- | --- |
| `text` | shadow `<input>` | name, high school, hometown, region, conference, jersey |
| `prose` | shadow `<textarea>`, 1.62 line height, live character count, 2,000 cap | bio, scouting report |
| `rich` | same textarea + a two-button row (bold, note) → `**`/`*` marks rendered by the page | scouting report |
| `number` | input + unit preview in the label chip (`72 in · 6'0"`, `185 lb`) | heightIn, weightLb |
| `date` | `<input type="date">` + computed age beside it | dob |
| `select` | the design system's 38px select with a painted chevron | hand, position, classYear |
| `people` | row editor in a popover sheet: add / remove / reorder, one line per entry | staff, awards, strengths, draft |
| `image` | file picker → square crop → upload (see 5.4) | photo, logo, team colors picker |
| `flag` | read-only value + "Flag for re-import" | every stat field |

### 1.5 What the dock deliberately does not edit

**Statistics.** A hand-edited point total breaks Elo, the leaders boards, peer ranks, similarity,
returning production and every champion join — the numbers are the product and they are derived.
A stat cell in select mode shows its value and offers `Flag for re-import`, which appends to the flag
queue the next data pass reads. (If a wrong value must be pinned, that is a feed repair with evidence,
not an override.)

**Derived fields.** `positionName`, `slug`, `seasons`, `record`, `pollRanks`, `elo`, `sos`,
`franchise` names and `history` are computed. Their inputs are editable; their outputs are not.

---

## 2. Field registry — what is editable, where

One table in `src/lib/cms-registry.ts` maps `cms.field.path` → `{ entity, path, type, label, max }`.
Adding a field later is one row plus one `data-cms` attribute.

**Player** (`entity: "player"`)

| Path | Type | Notes |
| --- | --- | --- |
| `name` | text | rewrites `name` **and** re-derives `slug` only on an explicit "fix link" (a slug change moves a shared URL) |
| `firstName`, `lastName` | text | 40 cap |
| `bio` | prose | the write-locally field; 2,000 cap |
| `scouting.report` | rich | + `scouting.author`, `scouting.date` |
| `scouting.grades` | people | key → 20–80 slider row |
| `strengths` | people | ordered list, 6 cap |
| `highSchool` | text | 80 cap |
| `birthplace.city/state/country` | text | country from a short list, never free text |
| `dob` | date | 1930–today; prints computed age |
| `hand` | select | Left / Right / unset |
| `heightIn`, `weightLb` | number | 55–96 in, 100–350 lb (the feed range gates, kept) |
| `jersey` | text | 0–99 |
| `position` | select | the `positionOrder` codes |
| `classYear` | select | resolved against the newest season, not the roster's |
| `commit`, `draft` | people | one entry each |
| `awards` | people | year + title + team |
| `photo` | image | 224×224, 30% from the top, same path as `save_image()` |
| `status` | select | active / retired / unknown |

**Team** (`entity: "team"`): `name`, `shortName`, `city`, `region`, `conference`, `colors`
(two swatches, contrast-checked against the page), `logo` (image), `staff` (people), `franchise.names`
(people + year range).

**League** (`entity: "league"`): `name`, `short`, `level`, `type` (field/box), `country`. Standings,
ratings and polls stay derived; a poll is pinned by re-running `fetch-rankings.py`, not by editing a row.

**Site** (`entity: "site"`): hero headline and subhead, the featured-player list, the announcement
banner. These have no feed at all, which makes them the first thing that proves the layer works.

---

## 3. Data flow

Publishing is **draft → preview → publish**: what an editor sees on the page is their draft, and what
a visitor sees is the last promoted document. Nothing an editor does is public until they say so.

```
   feeds ──► scripts/rebuild-all.sh ──► public/data.json ──┐
                                                           │
   editor ──► dock (pending, in memory, live-previewed) ───┤
                │ POST /api/draft                           │
                ▼                                           │
        Blobs "draft" ─────────────────────────────────┐   │
                │ POST /api/publish                   │   │
                ▼                                     │   │
        Blobs "overrides" + versions/v<n>.json ───┐   │   │
                                                  │   │   │
   visitor ──► GET /api/overrides ────────────────┴───┴───┼──► loadDataset()
                (edge-cached 60s)                          │        │
                                                           │        ▼
                                              applyOverrides(data) ──► render
```

**Boot.** `loadDataset()` → `loadOverrides()` → render. The overrides fetch is its own tiny request
with a 1.2s ceiling; on failure the app renders the feed data and says nothing. It must never join the
`data.json` request — that file is already the slowest paint on the site.

**Applying.** `applyOverrides(doc)` mutates the entity objects in place, once at boot for the published
document and again for the draft when the browser is signed in. In place, because every page, memo and
derived index already holds those references: copying would leave peers, similarity and the leaders
boards reading the feed value while the hero shows the edit. A path is `entity.field.subfield`;
`undefined` means "no override, use the feed value", which is also how a revert is expressed.

**Drafting.** One `POST /api/draft` per field carries `{patch}`. The function validates against the
registry (known path, type, range, length), sets the field on `draft` and returns the pending count.
The client updates its own copy immediately, so the page under the editor shows the change before any
round trip.

**Preview.** `GET /api/overrides?draft=1` returns published + draft merged, and only answers a valid
session. The editor's browser reads that instead of the public document, so the page they are editing
*is* the preview — there is no second preview surface to keep in sync.

**Publishing.** `POST /api/publish` promotes the whole draft in one Blob write: merge into `overrides`,
bump `version`, write `versions/v<n>.json`, clear `draft`. Public visitors pick it up from the edge
cache within 60s — no rebuild, no deploy. The draft records the `baseVersion` it started from, so a
second tab (or device) that published in between gets a 409 and keeps its draft rather than silently
clobbering.

**Revisions.** Every publish and every revert writes a full snapshot (`versions/v<n>.json`, last 20
kept) plus a row in `versions/index`. Revert is `POST /api/revert {entity, id, path?}`: dropping the
override *is* the feed value, and it publishes a version like any other change, so the history shows
the revert instead of the override quietly disappearing. "Restore version N" is the same document with
a higher version number.

### Override shape

```json
{
  "version": 41,
  "generated": "2026-11-14T02:11:00Z",
  "entities": {
    "player:zach-miller-2": {
      "rev": 41,
      "updatedAt": "2026-11-14T02:10:55Z",
      "fields": {
        "bio": "Two-way midfielder out of…",
        "hand": "Left",
        "heightIn": 72,
        "photo": "/media/player/zach-miller-2.webp"
      }
    },
    "team:cornell-big-red": { "rev": 12, "fields": { "colors": ["#b31b1b", "#f0e6c8"] } }
  }
}
```

Keys are `entityType:entityId`, never slug or array index — merges re-slug a profile and a rebuilt
dataset reorders everything. An override whose id no longer exists is **kept and reported**
(`scripts/cms-report.py`), never auto-pruned: a merge can reintroduce the id under a new one, and
silently deleting editorial work is worse than a stale key. `scripts/cms-rekey.py` maps old→new ids
from `merge-now.py`'s report after a merge pass.

---

## 4. Auth

Single editor, one passphrase, no user table. The session is a signed cookie; the SPA gate is
convenience only.

- **Sign in.** `POST /session { passphrase }` → compared against `ADMIN_PASSPHRASE_HASH`
  (scrypt, salt+hash in one env value — generated by `scripts/cms-secret.mjs`, never typed into a
  chat) with `crypto.timingSafeEqual`. Success sets
  `Set-Cookie: cms=<HMAC-SHA256({sub,iat,exp})>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`.
  Failure: 1s delay, 5 attempts per IP per 15 min (Blobs counter), 401 with no detail.
- **Every write re-verifies.** `edits`, `media`, `flags`, `GET /edits` all parse and verify the cookie
  server-side. A forged or expired cookie is 401. Deleting the dock's DOM grant nothing.
- **CSRF.** `SameSite=Strict` plus an `Origin` header check against the site's own origin on every
  POST; the session payload also carries a per-session `csrf` value that the client echoes in
  `X-CMS-CSRF`. Cheap, and it survives a future custom domain.
- **Secrets.** `ADMIN_PASSPHRASE_HASH`, `ADMIN_SESSION_SECRET` (32 random bytes) and an optional
  `CMS_ALLOW` (a comma-separated admin user list, for later) live in Netlify env vars, set in the
  Netlify UI — not in the repo, not in chat, not in `.env` on this box.
- **Sign out.** `DELETE /session` clears the cookie and the `laxdb.cms` hint. Session TTL is 12h;
  there is no refresh, so a tab left open overnight asks again.
- **The hint.** The cookie is HttpOnly, so the client cannot see it. A non-secret
  `laxdb.cms=1` localStorage flag decides whether to probe `/session` at all — an anonymous visitor
  makes **zero** CMS requests and never downloads the editor bundle (`React.lazy`). If the probe
  401s, the flag is cleared and the dock never mounts.

Threat model, stated plainly: this protects against strangers and search engines, not against someone
who has the passphrase. There is no "published by" identity beyond `by: "editor"` in the revision log.
If a second editor is ever added, the same cookie grows a `sub` and the revision log starts
disagreeing usefully.

---

## 5. Infrastructure

### 5.1 Function surface

**Built.** One Netlify Functions v2 module (`netlify/functions/api.ts`, `config.path = "/api/*"`) with
an internal router — one entry point keeps the bundle single and lets the same handlers run under a
plain Node server locally.

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/session` | POST | passphrase | sign in; 429 while rate-limited, 503 when unconfigured |
| `/api/session` | GET | cookie | `{ exp, csrf }` — the dock's probe; 401 when signed out |
| `/api/session` | DELETE | cookie | sign out |
| `/api/overrides` | GET | none | the published document, `ETag` + `s-maxage=60` |
| `/api/overrides?draft=1` | GET | cookie | published + draft merged — the editor's preview |
| `/api/draft` | GET | cookie | draft alone: `{ draft, fields, baseVersion }` |
| `/api/draft` | POST | cookie + csrf | stage one field `{ patch }` |
| `/api/draft` | DELETE | cookie + csrf | throw the draft away |
| `/api/publish` | POST | cookie + csrf | promote draft → published; 409 on empty or version conflict |
| `/api/revert` | POST | cookie + csrf | drop one field (or an entity's fields) back to the feed |
| `/api/history` | GET | cookie | version index, or `?version=n` for one snapshot |
| `/api/entity` | GET | cookie | every field set on one entity (`?key=player:p-…`) |
| `/api/meta` | GET | none | field count + store backend; a cheap liveness probe |
| `/api/media` | POST | cookie + csrf | image upload → `{ url }` — **phase 3** |
| `/api/flags` | POST | cookie + csrf | flag a feed field for the next data pass — **phase 4** |

Shared `netlify/lib/`: `auth.ts` (scrypt verify, HMAC session, cookie, rate limit, `configured()`),
`store.ts` (one `KV` interface, Blobs or a filesystem dir), `doc.ts` (the document, draft, publish,
revert, versions). The field list and the validator are the same file the client imports
(`src/lib/cms-registry.ts`), so there is exactly one field table and no schema to drift.

### 5.2 Where the bytes live

**Netlify Blobs.** Store `cms`: `overrides` (one document, ~40 KB for 1,000 fields — small enough to
send whole, which keeps the client trivially correct), `rev:<entity>:<n>` (append-only revisions),
`flags` (the queue). Store `media`: cropped images, served from the same origin through a `/media/*`
rewrite so no new CDN and no CORS.

Why Blobs and not Git: publishing must not require a build, and it must not put a GitHub token in a
browser. Why not a database: one editor, one document, no query ever needed.

### 5.3 Delivery and the fallback

`/overrides` is edge-cached for 60s with a 10-minute stale-while-revalidate window, so the read path
behaves like a static file and a hot page costs one function invocation per edge node per minute at
worst.

The same document is also written to `public/overrides.json` at each deploy (`scripts/cms-snapshot.py`),
and the client falls back to that file when the function call fails. A function outage therefore
degrades to "60-second-old edits stop arriving", never to a broken site.

### 5.4 Images

`/media` accepts a PNG/JPEG/WEBP up to 8 MB, crops **server-side** to a 224×224 square taking 30% from
the top, re-encodes to WebP and writes `media/player/<id>.webp` keyed by entity id — the same
contract as `save_image()`, so an uploaded headshot and a scraped one are indistinguishable in the
page. Club logos use the existing 96px path (and the extra-large 26px-radius crest at profile size).
The *only* correct place to crop is the shared helper: this repo has already shipped one portrait
fix that missed half the assets because two writers did their own resizing.

### 5.5 Deploy plumbing

**The zip path cannot ship this API — verified, not assumed.** Posting a zip of `dist/` to
`/sites/{id}/deploys` publishes anything at `netlify/functions/*` inside the zip as a *static file*:
`GET /netlify/functions/api.mjs` returned 200 with the bundle, `/api/session` 404'd, and the deploy
object still reported `available_functions: []`. The Functions v2 module (`export default`,
`config.path`) needs Netlify to package it, which only the CLI or a build does.

So the deploy is two steps and `deploy-netlify.py` does both:

1. `node scripts/build-functions.mjs` — esbuild `netlify/functions/api.ts` to
   `netlify/functions-build/api.mjs`, bundling `@netlify/blobs` (a zip deploy installs no
   `node_modules`, so the dependency has to travel inside the file).
2. `netlify deploy --dir dist --functions netlify/functions-build [--prod]` via
   `node_modules/.bin/netlify`, run by the script when a build exists. Without a functions build it
   falls back to the pure-API zip, which is still right for a site-only deploy.
3. After the deploy, `GET <deploy>/api/session` must answer `401`. A production deploy that misses it
   exits non-zero; a draft only warns.

`rebuild-all.sh` gained two steps before the build: `cms-snapshot.py` (write the published document to
`public/overrides.json`, the client's fallback) and `build-functions.mjs`.

**Environment variables** (`ADMIN_PASSPHRASE_HASH`, `ADMIN_SESSION_SECRET`, both generated by
`scripts/cms-secret.mjs --netlify`): set in the Netlify UI or through the account env API, then
redeploy — a function reads its environment at deploy time. On the Free plan they cannot be *marked*
secret (`is_secret: true` returns 422 for the `post_processing` scope) and env *scopes* are a paid
feature, so they live as ordinary site env vars. That is fine for a hash and a signing key on a
one-person account; on a paid plan, mark both secret and scope them to functions.

### 5.6 Local development

`npm i -D netlify-cli`, then `netlify dev` proxies Vite at 5173 and mounts `/.netlify/functions/*`
with a real Blobs context. `CMS_STORE=fs` switches `store.ts` to `data/cms-store/` so a dev pass cannot
touch production overrides. No second copy of the handlers, no mock server to drift.

---

## 6. Phases

Each phase ships on its own and leaves the site working for visitors. The acceptance test is the line
that decides it is done.

**Phase 0 — plumbing. ✅ shipped.** `cms-secret.mjs`; `/session` POST/GET/DELETE with scrypt, HMAC
cookie, rate limit and csrf; `build-functions.mjs` + the CLI deploy path; `cms-smoke.mjs` (30 checks)
wired into the deploy. Verified against a deployed draft: sign-in sets an HttpOnly SameSite=Strict
cookie, every anonymous write is 401, and Netlify Blobs is reachable from the function.

**Phase 1 — the override layer. ✅ shipped (read path).** `src/lib/overrides.ts`, `applyOverrides()` in
`loadDataset()`, `/overrides` with edge cache, `public/overrides.json` fallback, `cms-snapshot.py`,
plus the draft/publish/revert endpoints it needs. No UI. Verified locally: a published `site.heroTail`
and `player.heightIn` render on Home and the profile (6'7" from 79 in), and the full draft → publish →
revert cycle passes end-to-end on a deployed draft with real Blobs.

**Phase 2 — the dock + inline fields. ✅ shipped.** `.tray-cms`, hover overlay with a field label,
shadow input (text/prose/number/date/select), change stack, review sheet, sign-in panel, `⌘⇧E` and
`?edit=1` as the way in, editor chunk lazily loaded (`Editor-*.js`, 3.3 KB gzip). Verified in a real
browser: draft seeds from the server on reload, commit → chip → review → publish → reload, `Esc`
discards, a chip's `×` restores the published value, and the store is empty afterwards.

Two things this phase had to work out that the plan did not foresee:

- **The page has to be told a mutated object changed.** The layer writes through to the same objects
  the pages render (that is the whole point), so React never sees a new value. `bumpRevision()` in
  `src/lib/cms.ts` + one `useDataRevision()` call in `App`'s `Routes` is the repaint; copying the
  dataset instead would leave every derived index reading the feed value.
- **"Before" is the published value, not the feed value.** `feedValues` (first write per path) and
  `publishedValues` (the published document's fields) are both kept: a dropped draft edit restores the
  published value, while returning to the feed is the server-side `/api/revert`. Recomputing "before"
  from the live object after a reload just reads the override back, which is why it is captured.

**Phase 3 — structured + people + media (1–2 sessions).** number/date/select/people controls, `/media`
with the shared crop path, team and league fields, colour picker with a contrast warning. *Done when*
a portrait uploaded through the dock is 224×224 and matches `save_image()`'s output byte-for-byte in
dimensions, and a staff row can be added, reordered and removed in one publish.

**Phase 4 — review, undo, flags (1 session).** Review sheet, revision history per entity, per-field
revert, `Flag for re-import`, `cms-report.py` (orphaned overrides, flagged fields, stale photos).
*Done when* a change can be published, reverted to the previous value and reverted to the feed value,
each from the UI, with three revision rows to show for it.

**Phase 5 — hardening (1 session).** Rate limits, CSRF header, security headers in `netlify.toml`
(`frame-ancestors 'none'`, `X-Content-Type-Options`, a `connect-src` that allows the functions origin),
`aria` pass on dock/sheet/select mode, reduced-motion, phone pass. *Done when* the dock at 390px shows
actions only and `scrollWidth === clientWidth`, select mode is operable by keyboard alone, and a POST
without the CSRF header is rejected.

---

## 7. Failure modes worth designing against

- **Editing `data.json`.** The importer rebuilds it; the same pass resets every photo and logo it did
  not re-scrape. Overrides are the only safe write. State this at the top of the file and in the dock's
  first-run tooltip.
- **A client-side gate.** "The dock only renders when signed in" is not auth. The function verifies
  every write; `curl -X POST /edits` from a signed-out shell must 401.
- **Overrides keyed by slug, name or index.** Slugs are reassigned by the merge sort, array order
  changes every import. Ids only.
- **Silent pruning.** An override whose id vanished is reported, never deleted.
- **Stats as editable text.** Every derived number on the site would drift. Flag, don't edit.
- **Two bottom bars.** The compare tray and the dock both live at `bottom: 18px`, z-index 80. Shift
  the tray, and check the Netlify badge (`211×64` fixed bottom-right, an **id**, not a class) does not
  sit under the dock's right edge at 1024–1440.
- **The editor in the public bundle.** `React.lazy` behind the hint, or every visitor downloads a CMS.
- **Blocking the first paint on `/overrides`.** 1.2s ceiling, then render. The dataset is already the
  slowest thing on the page.
- **`data-cms` advertising the schema to everyone.** Render the attributes only when the CMS context
  is live, so the public DOM carries no field map.
- **Errors that look like saves.** A failed publish must leave pending state intact and say so in the
  dock (a `--red` dot on the count), never clear the stack.
- **Undo that isn't undo.** `⌘Z` inside a shadow input is the browser's text undo; the dock's
  "Undo" is the last *commit*. Two different actions, two different affordances — do not bind both to
  the same key.
- **Two attributes, not one.** `data-cms="player.hand"` says which field; `data-cms-value` carries the
  stored code when the printed text differs ("LH right-handed" → `L`, "Mar 21, 2000" → `2000-03-21`).
  Without the second, a select or date field commits the formatted string and the validator rejects it.
- **`animation-fill-mode: both` pinned the trays off-screen on phones.** `.tray` was centred with
  `transform: translateX(-50%)`, and `trayin`'s final keyframe carried the same transform — an
  animation's value beats a media query, so the phone tier's `transform: none` never applied and both
  the dock and the *existing compare tray* rendered at `x: -171` on a 390px screen. The fix is to
  centre with `left: 0; right: 0; margin-inline: auto; width: fit-content` and animate `translateY`
  only. Check it by measuring, not by looking: `getComputedStyle(tray).transform` still reads the
  matrix even when `left`/`right` are correct.

---

## 8. Decisions and open questions

Settled before Phase 0, and reflected above:

1. **Publish model: draft → preview → publish.** Staging is the default; a visitor only sees promoted
   work. `baseVersion` guards against a second tab or device publishing over the top (409, draft kept).
2. **Field order confirmed.** Player bio + hero copy first (Phase 2), teams/leagues/banner with the
   structured controls (Phase 3).
3. **Media in Netlify Blobs**, served from the site's own origin, cropped through the same 224×224 path
   the importer uses.

Still open:

1. **Who else edits.** One passphrase means one editor and `by: "editor"` in the history. A second
   person needs the cookie to carry a `sub` and the review sheet to show who changed what.
2. **Retention.** Snapshots are the last 20 versions; the revision *index* is unbounded. Fine for
   years at this volume — worth a cap when the first hundred versions land.
3. **Multi-tab preview.** Two tabs editing the same field both stage into one draft; last write wins
   inside the draft. The publish guard does not help there — a per-field `stagedAt` would.
