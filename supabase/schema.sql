-- laxdb — Supabase schema, step 1 of docs/supabase-migration.md
--
-- Column names are the dataset's own keys, quoted. `public/data.json` is still written by the
-- importer, and the loader maps nothing: a rename here would be a mapping table that can drift,
-- and the last time a field sat outside a list (gaa/svp) 1,287 rows silently lost it. Snake_case
-- views can be added later for query ergonomics; the tables stay lossless.
--
-- No foreign keys on purpose: seasons reference box clubs that exist only as ids in a source, so a
-- FK would reject rows the dataset legitimately holds. Indexes carry the reads instead.
--
-- Run:  node scripts/apply-schema.mjs      (idempotent)

create extension if not exists pg_trgm;

/* ------------------------------- read model ------------------------------- */

create table if not exists public.leagues (
  "id"         text primary key,
  "name"       text,
  "short"      text,
  "level"      text,
  "type"       text,
  "country"    text,
  "tier"       integer,
  "strength"   numeric,
  "standings"  jsonb,
  "polls"      jsonb,
  "ratings"    jsonb
);

create table if not exists public.teams (
  "id"         text primary key,
  "name"       text,
  "shortName"  text,
  "slug"       text,
  "leagueId"   text,
  "conference" text,
  "colors"     jsonb,
  "record"     jsonb,
  "staff"      jsonb,
  "logo"       text
);

create table if not exists public.players (
  -- The primary key is `slug`, not `id`: four people in the current dataset share an id with a
  -- namesake at the same club (the id is derived from name + club, and the importer resolves the
  -- *slug* collision, not the id). Slug is unique across all 26,234 rows and is what every route
  -- uses. `id` stays as an indexed column so the CMS override keys keep resolving.
  "slug"         text primary key,
  "id"           text not null,
  "firstName"    text,
  "lastName"     text,
  "name"         text,
  "position"     text,
  "positionName" text,
  "hand"         text,
  "heightIn"     integer,
  "weightLb"     integer,
  "dob"          text,
  "birthplace"   jsonb,
  "classYear"    integer,
  "gradYear"     integer,
  "teamId"       text,
  "leagueId"     text,
  "jersey"       integer,
  "status"       text,
  "scouting"     jsonb,
  "photo"        text,
  "experience"   integer,
  "highSchool"   text
);

create table if not exists public.seasons (
  -- `playerSlug` leads the key for the same reason it is the player key: two namesakes at one club
  -- can share a season, a league and a type (one skater line, one goalie line).
  "playerSlug" text not null,
  "playerId" text not null,
  "ord"      integer not null default 0,
  "season"   integer not null,
  "teamId"   text not null,
  "leagueId" text not null,
  "type"     text not null,
  "gp" integer, "gs" integer, "g" integer, "a" integer, "pts" integer,
  "sh" integer, "gb" integer, "to" integer, "ct" integer,
  "foW" integer, "foA" integer, "pen" integer, "min" integer,
  "ga" integer, "sv" integer, "w" integer, "l" integer,
  "gaa" numeric, "svp" numeric,
  primary key ("playerSlug", "season", "teamId", "leagueId", "type")
);

-- added 2026-11-25 after the first load: the client's `.find()` picks the first of a player's rows
-- for a season, so the ordinal is what makes a split season resolve to the same row in both modes
alter table public.seasons add column if not exists "ord" integer not null default 0;

-- Everything that is not a row of the three above: history (champions, programmes, Tewaaraton,
-- All-Americans, records) and the dataset meta block. One jsonb body per key, so a shape the
-- database does not model yet is still carried rather than dropped.
create table if not exists public.snapshots (
  "key"       text primary key,
  "body"      jsonb not null,
  "updated_at" timestamptz not null default now()
);

-- Career totals per player, so the similarity pool is one row per player instead of 53k season
-- rows. The loader never writes this; Postgres maintains it.
create or replace view public.player_career as
select
  p."slug", p."id", p."name", p."position", p."positionName", p."heightIn",
  p."teamId", p."leagueId", p."photo",
  coalesce(sum(s."gp"), 0)::int   as "gp",
  coalesce(sum(s."g"), 0)::int    as "g",
  coalesce(sum(s."a"), 0)::int    as "a",
  coalesce(sum(s."sh"), 0)::int   as "sh",
  coalesce(sum(s."gb"), 0)::int   as "gb",
  coalesce(sum(s."to"), 0)::int   as "to",
  coalesce(sum(s."ct"), 0)::int   as "ct",
  coalesce(sum(s."pen"), 0)::int  as "pen",
  coalesce(sum(s."sv"), 0)::int   as "sv",
  coalesce(sum(s."ga"), 0)::int   as "ga",
  coalesce(sum(s."min"), 0)::int  as "min",
  coalesce(sum(s."foW"), 0)::int  as "foW",
  coalesce(sum(s."foA"), 0)::int  as "foA",
  coalesce(sum(s."w"), 0)::int    as "w",
  coalesce(sum(s."l"), 0)::int    as "l",
  count(s.*)::int                 as "seasons"
from public.players p
left join public.seasons s on s."playerSlug" = p."slug"
group by 1,2,3,4,5,6,7,8,9;

/* --------------------------------- indexes -------------------------------- */

create index if not exists players_id_idx        on public.players ("id");
create index if not exists players_team_idx      on public.players ("teamId");
create index if not exists players_league_idx    on public.players ("leagueId");
create index if not exists players_league_pos_idx on public.players ("leagueId", "position");
create index if not exists players_name_trgm_idx on public.players using gin ("name" gin_trgm_ops);

create index if not exists seasons_player_idx    on public.seasons ("playerId");
create index if not exists seasons_playerslug_idx on public.seasons ("playerSlug");
create index if not exists seasons_team_idx      on public.seasons ("teamId");
create index if not exists seasons_league_season_idx on public.seasons ("leagueId", "season");
create index if not exists seasons_team_season_idx   on public.seasons ("teamId", "season");

create index if not exists teams_slug_idx        on public.teams ("slug");
create index if not exists teams_league_idx      on public.teams ("leagueId");
create index if not exists teams_conference_idx  on public.teams ("conference");

/* ----------------------------- CMS write model ---------------------------- */
-- The override layer keeps its shape from docs/cms.md: a value keyed by entity + field path,
-- reapplied over the dataset after every import, so re-scraping never costs editorial work.

create table if not exists public.editors (
  "userId"    uuid primary key,
  "note"      text,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.overrides (
  "entityType" text not null,
  "entityId"   text not null,
  "path"       text not null,
  "value"      jsonb,
  "updatedAt"  timestamptz not null default now(),
  "updatedBy"  text,
  primary key ("entityType", "entityId", "path")
);

create table if not exists public.revisions (
  "id"        bigserial primary key,
  "doc"       jsonb not null,
  "author"    text,
  "createdAt" timestamptz not null default now()
);

/* --------------------------- grants and RLS ------------------------------- */
-- Auto-grant is off at project creation (docs/supabase-migration.md D1): every table needs an
-- explicit grant. Reads run server-side on the secret key, so only service_role is granted —
-- the browser never queries these tables directly.

grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.leagues, public.teams, public.players, public.seasons, public.snapshots,
  public.editors, public.overrides, public.revisions
  to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.player_career to service_role;

-- The CMS is the one place a browser talks to these tables: signed-in editors, own rows only.
grant select on public.players, public.teams, public.leagues to authenticated;
grant select, insert, update, delete on public.overrides to authenticated;
grant select, insert on public.revisions to authenticated;

alter table public.leagues        enable row level security;
alter table public.teams          enable row level security;
alter table public.players        enable row level security;
alter table public.seasons        enable row level security;
alter table public.snapshots      enable row level security;
alter table public.editors        enable row level security;
alter table public.overrides      enable row level security;
alter table public.revisions      enable row level security;

-- No policies on the read model: RLS on + no policy = deny for anon/authenticated, which is the
-- intended posture. service_role bypasses RLS entirely.
drop policy if exists "editors read overrides" on public.overrides;
create policy "editors read overrides" on public.overrides
  for select to authenticated
  using (exists (select 1 from public.editors e where e."userId" = auth.uid()));

drop policy if exists "editors write overrides" on public.overrides;
create policy "editors write overrides" on public.overrides
  for insert to authenticated
  with check (
    exists (select 1 from public.editors e where e."userId" = auth.uid())
    and "updatedBy" = auth.uid()::text
  );

drop policy if exists "editors update overrides" on public.overrides;
create policy "editors update overrides" on public.overrides
  for update to authenticated
  using (exists (select 1 from public.editors e where e."userId" = auth.uid()))
  with check ("updatedBy" = auth.uid()::text);

drop policy if exists "editors delete overrides" on public.overrides;
create policy "editors delete overrides" on public.overrides
  for delete to authenticated
  using (exists (select 1 from public.editors e where e."userId" = auth.uid()));

drop policy if exists "editors read revisions" on public.revisions;
create policy "editors read revisions" on public.revisions
  for select to authenticated
  using (exists (select 1 from public.editors e where e."userId" = auth.uid()));

drop policy if exists "editors append revisions" on public.revisions;
create policy "editors append revisions" on public.revisions
  for insert to authenticated
  with check (
    exists (select 1 from public.editors e where e."userId" = auth.uid())
    and "author" = auth.uid()::text
  );
