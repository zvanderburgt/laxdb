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
  "ord"        integer not null default 0,
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
  "careerLine"   jsonb,
  "ord"          integer not null default 0
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
alter table public.leagues add column if not exists "ord" integer not null default 0;
alter table public.players add column if not exists "ord" integer not null default 0;

-- jsonb does not keep key order: it stores objects sorted, so a page that prints
-- "Committee #2 · RPI #1 · Coaches #1" would reorder itself the moment the data arrived from
-- Postgres instead of data.json. These are the columns whose key order a reader can see.
alter table public.teams   alter column "record"    type json using "record"::json;
alter table public.teams   alter column "pollRanks" type json using "pollRanks"::json;
alter table public.teams   alter column "colors"    type json using "colors"::json;
alter table public.teams   alter column "staff"     type json using "staff"::json;
alter table public.teams   alter column "history"   type json using "history"::json;
alter table public.teams   alter column "franchise" type json using "franchise"::json;
alter table public.leagues alter column "standings" type json using "standings"::json;
alter table public.leagues alter column "polls"     type json using "polls"::json;
alter table public.leagues alter column "ratings"   type json using "ratings"::json;
alter table public.players alter column "scouting"  type json using "scouting"::json;

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
  p."birthplace" ->> 'city' as "city",
  -- the spotlight ranks on the best season inside the player's own competition
  pk."peakPts", pk."peakSeason", coalesce(pk."gp", 0) as "peakGp"
from public.players p
left join public.player_current c on c."playerSlug" = p."slug"
left join public.player_career pc on pc."slug" = p."slug"
left join public.player_peak pk on pk."playerSlug" = p."slug" and pk."leagueId" = p."leagueId";

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

-- The leaders page ranks inside one competition. Two shapes it needs that the season table cannot
-- answer directly: which seasons a league published, and a player's career totals *within* that
-- league (a man can play college and pro; those careers must not be added together).
create or replace view public.league_seasons as
select distinct "leagueId", "season" from public.seasons;

create or replace view public.career_by_league as
select
  s."leagueId", s."playerSlug",
  coalesce(sum(s."gp"), 0)::int  as "gp",
  coalesce(sum(s."g"), 0)::int   as "g",
  coalesce(sum(s."a"), 0)::int   as "a",
  coalesce(sum(s."pts"), 0)::int as "pts",
  coalesce(sum(s."sh"), 0)::int  as "sh",
  coalesce(sum(s."gb"), 0)::int  as "gb",
  coalesce(sum(s."ct"), 0)::int  as "ct",
  coalesce(sum(s."foW"), 0)::int as "foW",
  coalesce(sum(s."foA"), 0)::int as "foA",
  coalesce(sum(s."sv"), 0)::int  as "sv",
  coalesce(sum(s."ga"), 0)::int  as "ga",
  coalesce(sum(s."w"), 0)::int   as "w",
  coalesce(sum(s."l"), 0)::int   as "l"
from public.seasons s
group by 1, 2;

-- One row per leaderboard entry, name included: joining identity in the function meant players whose
-- *current* league differs from the league they played in (a college man in a summer box league) went
-- missing from the board.
create or replace view public.leader_season as
select s."leagueId", s."season", s."ord", p."slug", p."name", p."position", p."positionName",
       p."photo", coalesce(s."teamId", p."teamId") as "teamId",
       s."gp", s."g", s."a", s."pts", s."sh", s."gb", s."ct",
       s."foW", s."foA", s."sv", s."ga", s."w", s."l", p."leagueId" as "playerLeague"
from public.seasons s
join public.players p on p."slug" = s."playerSlug";

create or replace view public.leader_career as
select c."leagueId", p."slug", p."name", p."position", p."positionName", p."photo", p."teamId",
       c."gp", c."g", c."a", c."pts", c."sh", c."gb", c."ct",
       c."foW", c."foA", c."sv", c."ga", c."w", c."l", p."leagueId" as "playerLeague"
from public.career_by_league c
join public.players p on p."slug" = c."playerSlug";

-- The Opp-adj board weights every game by the opponent's Elo over the 1500 baseline, which resolves
-- to one number per player per season. It is computed at load time from the game log the importer
-- writes, so the page never fetches games.json.
create table if not exists public.player_adj (
  "playerSlug" text not null,
  "season"     text not null,
  "games"      integer,
  "raw"        numeric,
  "adjusted"   numeric,
  "avgOppElo"  numeric,
  "ranked"     integer,
  primary key ("playerSlug", "season")
);

-- A league page is one competition's current season: every player whose league this is, with the
-- season row the page means by `currentSeason()` (the last one, not the newest — see seasons."ord").
create or replace view public.league_player_current as
select p."leagueId" as "playerLeague", p."slug", p."name", p."position", p."positionName",
       p."photo", c."teamId", c."season",
       c."gp", c."g", c."a", c."pts", c."sh", c."gb", c."ct",
       c."foW", c."foA", c."sv", c."ga", c."w", c."l", p."birthplace", p."highSchool",
       -- the club the page prints is his current one, not the one on his last season row
       p."teamId" as "playerTeamId", p."classYear"
from public.players p
join public.player_current c on c."playerSlug" = p."slug";

-- Two numbers the hero prints: how many players and what their careers add up to.
create or replace view public.league_totals as
select p."leagueId",
       count(*)::int as "players",
       coalesce(sum(pc."g"), 0)::int as "careerGoals"
from public.players p
left join public.player_career pc on pc."slug" = p."slug"
group by 1;

-- "Where they come from": the counts behind the two lists, aggregated in SQL rather than by shipping
-- 3,000 birthplaces to the browser.
create or replace view public.league_origins as
select "leagueId", 'school' as "kind", btrim("highSchool") as "label", count(*)::int as "n"
from public.players
where "highSchool" is not null and btrim("highSchool") <> ''
group by 1, 2, 3
union all
select "leagueId", 'town',
       btrim(concat_ws(', ', "birthplace" ->> 'city', "birthplace" ->> 'state')),
       count(*)::int
from public.players
where "birthplace" ->> 'city' is not null
group by 1, 2, 3;

-- Each player's own game log, which the importer writes to games.json. One row per game so the
-- player page can ask for one player and the team page can ask for a roster's season at once.
create table if not exists public.player_games (
  "playerSlug" text not null,
  "ord"        integer not null,
  "season"     text not null,
  "date"       text not null,
  "opponent"   text,
  "result"     text,
  "g"          integer,
  "a"          integer,
  "gb"         integer,
  "ct"         integer,
  "sv"         integer,
  "ga"         integer,
  "foW"        integer,
  "foA"        integer,
  primary key ("playerSlug", "ord")
);

-- A club page asks four separate questions of the same rows: which seasons it played, who led each
-- one, who is on the roster now, and where those players came from.
create or replace view public.team_seasons as
select coalesce(s."teamId", p."teamId") as "teamId", s."season",
       count(distinct s."playerSlug")::int as "players",
       (array_agg(s."leagueId" order by s."ord"))[1] as "leagueId"
from public.seasons s
join public.players p on p."slug" = s."playerSlug"
where coalesce(s."teamId", p."teamId") is not null
group by 1, 2;

create or replace view public.team_season_leader as
select distinct on ("teamId", "season")
       "teamId", "season", "slug", "name", "pts"
from public.leader_season
where "teamId" is not null
order by "teamId", "season", "pts" desc nulls last;

create or replace view public.team_roster as
select coalesce(s."teamId", p."teamId") as "teamId", p."slug", p."name", p."position",
       p."positionName", p."photo", p."classYear",
       coalesce(pc."gp", 0)::int as "gp", coalesce(pc."g", 0)::int as "g",
       coalesce(pc."a", 0)::int as "a", coalesce(pc."g", 0) + coalesce(pc."a", 0) as "pts",
       (select count(*)::int from public.seasons x where x."playerSlug" = p."slug") as "seasons",
       -- careerTotals(p).pts is the sum of goals and assists, not of any published total
       (select coalesce(sum(coalesce(x."g", 0)) + sum(coalesce(x."a", 0)), 0)::int
          from public.seasons x where x."playerSlug" = p."slug") as "careerPts",
       -- the row `currentSeason()` means: the player's last one, whose points the page ranks on
       -- the PTS column prints the published points where the feed has them, goals plus assists
       -- only as a fallback (the row on the page is `currentSeason(p).pts`)
       (select coalesce(c."pts", coalesce(c."g", 0) + coalesce(c."a", 0))::int
          from public.player_current c where c."playerSlug" = p."slug") as "seasonPts",
       (select coalesce(c."gp", 0)::int
          from public.player_current c where c."playerSlug" = p."slug") as "seasonGp",
       (select coalesce(c."g", 0)::int from public.player_current c where c."playerSlug" = p."slug") as "seasonG",
       (select coalesce(c."a", 0)::int from public.player_current c where c."playerSlug" = p."slug") as "seasonA",
       (select coalesce(c."gb", 0)::int from public.player_current c where c."playerSlug" = p."slug") as "seasonGb",
       (select coalesce(c."ct", 0)::int from public.player_current c where c."playerSlug" = p."slug") as "seasonCt",
       p."ord"
from public.seasons s
join public.players p on p."slug" = s."playerSlug"
left join public.player_career pc on pc."slug" = p."slug"
where coalesce(s."teamId", p."teamId") is not null
group by coalesce(s."teamId", p."teamId"), p."slug", p."name", p."position", p."positionName",
         p."photo", p."classYear", pc."gp", pc."g", pc."a";

create or replace view public.team_origins as
select "teamId", 'school' as "kind", btrim("highSchool") as "label", count(*)::int as "n"
from public.players
where "teamId" is not null and "highSchool" is not null and btrim("highSchool") <> ''
group by 1, 2, 3
union all
select "teamId", 'town',
       btrim(concat_ws(', ', "birthplace" ->> 'city', "birthplace" ->> 'state')), count(*)::int
from public.players
where "teamId" is not null and "birthplace" ->> 'city' is not null
group by 1, 2, 3;

-- Every game a club's players appear in, matched to the season they played it for that club.
create or replace view public.team_game_rows as
select distinct s."teamId", g."playerSlug", g."season", g."date", g."opponent", g."result"
from public.player_games g
join public.seasons s on s."playerSlug" = g."playerSlug" and s."season"::text = g."season"
where s."teamId" is not null and g."result" is not null;

-- What the club hero prints: the season totals of the players whose current club this is, using the
-- same `currentSeason()` rule as everything else (the last row, not the newest).
create or replace view public.team_current_totals as
select p."teamId",
       max(c."gp")::int as "gp", coalesce(sum(c."g"), 0)::int as "g",
       coalesce(sum(c."sh"), 0)::int as "sh", coalesce(sum(c."sv"), 0)::int as "sv",
       coalesce(sum(c."ga"), 0)::int as "ga", coalesce(sum(c."foW"), 0)::int as "foW",
       coalesce(sum(c."foA"), 0)::int as "foA"
from public.players p
join public.player_current c on c."playerSlug" = p."slug"
where p."teamId" is not null
group by 1;

-- Record books, All-America lists and award winners carry printed names, not ids, so the history page
-- has to resolve a few hundred names against 26,234 players. The key and the rank are the same ones
-- `playerByName()` uses: letters only, and a portrait plus career length breaking ties.
create or replace view public.player_lookup as
select
  regexp_replace(lower(p."name"), '[^a-z]', '', 'g') as "key",
  p."slug", p."name",
  (case when p."photo" is null then 0 else 1000 end)
    + (select count(*)::int from public.seasons x where x."playerSlug" = p."slug") as "rank"
from public.players p;

-- "Active players climbing the record book": only Division I seasons count, only a career that
-- starts inside our window is complete enough to project, and the board's lowest printed figure is
-- the bar. The arithmetic is in the endpoint; this is the per-player aggregate it needs.
create or replace view public.climb_window as
select
  min("season")::int as "first", max("season")::int as "last"
from public.seasons where "leagueId" = 'ncaa-d1';

create or replace view public.d1_climb as
select p."slug", p."name", p."position", p."positionName", p."photo", p."teamId",
       count(*)::int as "seasons",
       min(s."season")::int as "firstSeason",
       (array_agg(coalesce(s."teamId", p."teamId") order by s."season" desc))[1] as "lastTeam",
       sum(coalesce(s."pts", coalesce(s."g", 0) + coalesce(s."a", 0)))::int as "careerPts",
       coalesce(sum(s."g"), 0)::int as "careerG",
       coalesce(sum(s."a"), 0)::int as "careerA",
       max(coalesce(s."pts", coalesce(s."g", 0) + coalesce(s."a", 0)))::int as "bestPts",
       coalesce(max(s."g"), 0)::int as "bestG",
       coalesce(max(s."a"), 0)::int as "bestA",
       bool_or(s."season" = (select max("season") from public.seasons where "leagueId" = 'ncaa-d1')
               and coalesce(s."gp", 0) > 0) as "active"
from public.players p
join public.seasons s on s."playerSlug" = p."slug"
where s."leagueId" = 'ncaa-d1'
group by p."slug", p."name", p."position", p."positionName", p."photo", p."teamId";

-- The origins page is an aggregate of one competition's players: the state they were born in, the
-- school they came from, and the programme they reached. 6,900 rows, not 26,234 players.
create or replace view public.d1_origins as
select p."teamId",
       coalesce(p."birthplace" ->> 'state', '') as "state",
       coalesce(p."highSchool", '') as "school",
       p."ord" as "seq"
from public.players p
where p."leagueId" = 'ncaa-d1';

-- The spotlight ranks a player on his *best* season inside a competition, not on his latest one, and
-- only where he actually played (12 games in that league).
create or replace view public.player_peak as
select s."playerSlug", s."leagueId",
       max(coalesce(s."pts", coalesce(s."g", 0) + coalesce(s."a", 0)))::int as "peakPts",
       (array_agg(s."season" order by coalesce(s."pts", coalesce(s."g", 0) + coalesce(s."a", 0)) desc))[1] as "peakSeason",
       sum(coalesce(s."gp", 0))::int as "gp"
from public.seasons s
group by 1, 2;

-- The home page's "players to know" strip: the six attackers with the biggest careers across field
-- and pro field, in that order.
create or replace view public.featured_attackers as
select p."slug", p."id", p."name", p."position", p."positionName", p."teamId", p."leagueId", p."photo",
       (coalesce(pc."g", 0) + coalesce(pc."a", 0))::int as "careerPts"
from public.players p
join public.player_career pc on pc."slug" = p."slug"
where p."position" = 'A' and p."leagueId" in ('ncaa-d1', 'pll')
order by "careerPts" desc
limit 6;

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
  public.league_top_scorer, public.team_totals, public.league_seasons, public.career_by_league, public.leader_season, public.leader_career, public.player_adj,
                public.league_player_current, public.league_totals, public.league_origins, public.player_games,
                public.team_seasons, public.team_season_leader, public.team_roster, public.team_origins, public.player_lookup,
                public.climb_window, public.d1_climb, public.d1_origins, public.player_peak, public.featured_attackers,
                public.team_current_totals,
                public.team_game_rows to service_role;

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
