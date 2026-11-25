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
  "logo"       text,
  "city"       text,
  "cityName"   text,
  "region"     text,
  "elo"        numeric,
  "sos"        numeric,
  "history"    jsonb,
  "pollRanks"  jsonb,
  "franchise"  jsonb
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
  "highSchool"   text,
  "careerLine"   jsonb
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

-- added after the first load: these were in data.json and had no column, so the loader dropped them
-- silently (3,212 players carry a careerLine; 81 teams a city; 64 an Elo and a strength of schedule)
alter table public.teams add column if not exists "city" text;
alter table public.teams add column if not exists "cityName" text;
alter table public.teams add column if not exists "region" text;
alter table public.teams add column if not exists "elo" numeric;
alter table public.teams add column if not exists "sos" numeric;
alter table public.teams add column if not exists "history" jsonb;
alter table public.teams add column if not exists "pollRanks" jsonb;
alter table public.teams add column if not exists "franchise" jsonb;
alter table public.players add column if not exists "careerLine" jsonb;

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

-- The players table's row, and the two numbers a list row needs: his latest season line and his
-- career rates. One view so the list route is a single read instead of a join it cannot express.
-- `currentSeason()` in the client is `seasons[seasons.length - 1]`, i.e. the last row the importer
-- wrote for him, which is not always the newest season. The ordinal is what makes the two agree.
create or replace view public.player_current as
select distinct on (s."playerSlug") s.*
from public.seasons s
order by s."playerSlug", s."ord" desc;

create or replace view public.season_span as
select min("season")::int as "lo", max("season")::int as "hi" from public.seasons;

create or replace view public.player_list as
select
  p."slug", p."id", p."name", p."position", p."positionName", p."teamId", p."leagueId",
  p."classYear", p."photo", p."birthplace" ->> 'state' as "state", p."highSchool",
  c."season", c."gp", c."g", c."a", c."pts", c."gb", c."sh", c."foW", c."foA", c."sv", c."ga",
  round((pc."g" + pc."a")::numeric / greatest(pc."gp", 1), 2) as "ppg",
  p."birthplace" ->> 'city' as "city"
from public.players p
left join public.player_current c on c."playerSlug" = p."slug"
left join public.player_career pc on pc."slug" = p."slug";

-- The leading scorer per competition: `distinct on` in SQL so the page asks for 19 rows instead of
-- ordering 26k to keep the first of each league.
create or replace view public.league_top_scorer as
select distinct on ("leagueId")
  "slug", "id", "name", "position", "positionName", "teamId", "leagueId", "photo", "pts"
from public.player_list
where "pts" is not null and "pts" > 0
order by "leagueId", "pts" desc nulls last, "slug";

-- What a directory card prints next to the crest: how many players have appeared for the club and
-- what their careers add up to. Both are aggregates the browser used to compute over 26k players.
create or replace view public.team_totals as
select
  r."teamId",
  count(*)::int as "players",
  coalesce(sum(pc."g" + pc."a"), 0)::int as "pts"
from (select distinct "teamId", "playerSlug" from public.seasons) r
join public.player_career pc on pc."slug" = r."playerSlug"
group by 1;

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

-- The CMS's unit of truth is a *document*, not a row: one JSON object holds every editorial field,
-- keyed entity:field, and publish promotes a draft to published in one write. Slicing that into rows
-- would fragment a tested lifecycle to gain queries nobody asked for, so the store keeps the shape it
-- already has and only its substrate changes — Netlify Blobs (token expiry, no backups) to Postgres.
drop table if exists public.overrides;
drop table if exists public.revisions;

create table if not exists public.cms_store (
  "store"      text not null,                  -- cms | media
  "key"        text not null,                  -- overrides | draft | versions/v12.json | media path
  "value"      text not null,
  "updatedAt"  timestamptz not null default now(),
  primary key ("store", "key")
);

/* --------------------------- grants and RLS ------------------------------- */
-- Auto-grant is off at project creation (docs/supabase-migration.md D1): every table needs an
-- explicit grant. Reads run server-side on the secret key, so only service_role is granted —
-- the browser never queries these tables directly.

grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.leagues, public.teams, public.players, public.seasons, public.snapshots,
  public.editors, public.cms_store
  to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.player_career, public.player_current, public.player_list, public.season_span,
  public.league_top_scorer, public.team_totals to service_role;

-- The CMS talks to the store through the function, never directly from the browser.
grant select on public.players, public.teams, public.leagues to authenticated;

alter table public.leagues        enable row level security;
alter table public.teams          enable row level security;
alter table public.players        enable row level security;
alter table public.seasons        enable row level security;
alter table public.snapshots      enable row level security;
alter table public.editors        enable row level security;
alter table public.cms_store      enable row level security;

-- No policies on the read model: RLS on + no policy = deny for anon/authenticated, which is the
-- intended posture. service_role bypasses RLS entirely, and it is the only role that touches
-- cms_store (the admin API holds it, the browser never does).
