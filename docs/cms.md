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

```
      feeds ──► scripts/rebuild-all.sh ──► public/data.json ──┐
                                                              ├─► loadDataset()
   editor ──► dock (pending map, in memory, live-previewed) ──┤        │
                │ publish                                     │        ▼
                ▼                                             │   applyOverrides(data)
     POST /.netlify/functions/edits ──► Blobs "overrides" ─────┘        │
                                         + Blobs "revisions"           ▼
                                                                   render
```

**Boot.** `loadDataset()` → `loadOverrides()` → render. The overrides fetch is its own tiny request
with a 1.2s ceiling; on failure the app renders the feed data and says nothing. It must never join
the `data.json` request — that file is already the slowest paint on the site.

**Applying.** `applyOverrides()` is a pure function used in two places: once at boot for the whole
store, and once per commit so the page under the editor updates immediately without a refetch. A path
is `entity.field.subfield`; `undefined` means "no override, use the feed value", which is also how a
revert is expressed.

**Publishing.** One `POST /edits` carries the batch. The function validates each patch against the
registry (known path, correct type, length and range caps), writes the entity's key, appends a
revision record, and returns the new version. The client then clears pending and refetches
`/overrides?v=<version>` once. Public visitors pick it up from the edge cache within 60s — no
rebuild, no deploy.

**Revisions.** Append-only: `{v, at, by, entity, id, path, before, after}`. Undo is either "drop this
path" (back to the feed) or "reapply revision N". Both are one row in the inspector, and neither is
possible from a mutable "current value" store — which is why the log exists before the UI needs it.

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

Netlify Functions v2 (Web `Request`/`Response`, Node 20), one handler per route:

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/session` | POST | passphrase | sign in |
| `/session` | GET | cookie | `{ exp, csrf }` — the dock's probe; 401 when signed out |
| `/session` | DELETE | cookie | sign out |
| `/overrides` | GET | none | the whole store, `ETag` + `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=600` |
| `/edits` | POST | cookie | validate + publish a batch, append revisions |
| `/edits` | GET | cookie | revisions for one entity (`?entity=player:zach-miller-2`) |
| `/media` | POST | cookie | image upload → `{ url }` |
| `/flags` | POST | cookie | flag a feed field for the next data pass |

Shared `_lib/`: `auth.ts` (sign/verify/rate-limit), `store.ts` (one interface, two backends — Blobs in
production, a filesystem dir in dev), `schema.ts` (the registry mirrored as a validator, generated from
`src/lib/cms-registry.ts` so there is exactly one field list), `http.ts` (JSON, CORS-off, error shape).

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

`scripts/deploy-netlify.py` zips `dist/` and posts it. Functions are not part of that zip today, so
the deploy grows one step:

1. `node scripts/build-functions.mjs` — esbuild each `netlify/functions/*.ts` to
   `netlify/functions-build/*.mjs`, bundling `@netlify/blobs`, externalising nothing else.
2. `deploy-netlify.py` adds those files to the zip under `netlify/functions/` (and refuses to deploy
   if the build directory is missing while `netlify.toml` declares functions — a silent
   function-less deploy is the failure mode that costs an evening).
3. After a successful deploy, smoke-test: `GET /.netlify/functions/session` must be `401`, and
   `GET /.netlify/functions/overrides` must parse. Non-401/200 fails the deploy.

Alternative if the zip route refuses to register functions: enable build-from-Git on the site and let
Netlify run `npm run build`. That changes the data workflow (a 16 MB `data.json` in git becomes the
build input), so take it only if the zip path genuinely dead-ends.

### 5.6 Local development

`npm i -D netlify-cli`, then `netlify dev` proxies Vite at 5173 and mounts `/.netlify/functions/*`
with a real Blobs context. `CMS_STORE=fs` switches `store.ts` to `data/cms-store/` so a dev pass cannot
touch production overrides. No second copy of the handlers, no mock server to drift.

---

## 6. Phases

Each phase ships on its own and leaves the site working for visitors. The acceptance test is the line
that decides it is done.

**Phase 0 — plumbing (½ session).** Env vars + `cms-secret.mjs`; `/session` POST/GET/DELETE;
`build-functions.mjs` + zip packaging; smoke test in the deploy script. *Done when* a signed-out
`curl` gets 401, a signed-in browser keeps a cookie, and a fresh deploy reports the function present.

**Phase 1 — the override layer, read-only (1 session).** `src/lib/overrides.ts`, `applyOverrides()` in
`loadDataset()`, `/overrides` with edge cache, `public/overrides.json` fallback, `cms-snapshot.py`.
No UI. *Done when* a hand-written `overrides.json` with one player bio and one team colour renders on
the live site, and `rebuild-all.sh` leaves it in place.

**Phase 2 — the dock + text fields (1–2 sessions).** `.tray-cms`, mode chip, change stack, select mode,
shadow input, `POST /edits` with validation and revisions. Fields: player `name`/`bio`/`highSchool`,
site hero copy. *Done when* a bio edited in place on production survives a hard reload, a second
browser sees it within 60s, `Esc` cancels, and re-running the D1 importer changes nothing.

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

---

## 8. Open questions

1. **Publish model.** Immediate publish (as designed) or draft → preview → publish with a second
   cookie-gated read (`?draft=1`) so the live page only ever shows reviewed copy? Draft adds a state
   machine and roughly a session; immediate is what an in-place editor usually means.
2. **Which copy.** Phase 2 starts with player bio + hero headline. Teams, leagues and the site banner
   are Phase 3 — should any of them come earlier?
3. **Media storage.** Blobs (same origin, no new account) versus the repo (`public/media/`, committed —
   free CDN, but every upload is a commit and a deploy). Blobs is assumed here.
