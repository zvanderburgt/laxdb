import React, { Suspense, useEffect } from "react";
import { CompareProvider, Link, RouterProvider, ThemeProvider, useRoute } from "./lib/app";
import { leagueById, playerBySlug, teamBySlug } from "./lib/data";
import { CompareTray, Footer, Nav } from "./components/Chrome";
import Home from "./pages/Home";
import Players from "./pages/Players";
import PlayerPage from "./pages/PlayerPage";
import { TeamPage, TeamsPage } from "./pages/Teams";
import { LeaguePage, LeaguesPage } from "./pages/Leagues";
import ComparePage from "./pages/Compare";
import MyRoster from "./pages/MyRoster";
import History from "./pages/History";
import Origins from "./pages/Origins";
import Leaders from "./pages/Leaders";
import Scores from "./pages/Scores";
import Versus from "./pages/Versus";
import Game from "./pages/Game";
import { Empty } from "./components/ui";
import { startEditing, stopEditing, useCms, useDataRevision } from "./lib/cms";

// the editor surface is lazily loaded: an anonymous visitor never downloads it
const Editor = React.lazy(() => import("./components/cms/Editor"));

/** The way in: ⌘⇧E anywhere, or a `?edit=1` query on any route. */
function Cms() {
  const cms = useCms();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (cms.mode === "off") startEditing();
        else stopEditing();
      }
    };
    window.addEventListener("keydown", onKey);
    const query = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    if (query.get("edit") === "1") startEditing();
    return () => window.removeEventListener("keydown", onKey);
  }, [cms.mode]);

  if (cms.mode === "off") return null;
  return (
    <Suspense fallback={null}>
      <Editor />
    </Suspense>
  );
}

function titleFor(path: string) {
  const seg = path.split("/").filter(Boolean);
  if (seg.length === 0) return "LAXDB — The lacrosse player database";
  if (seg[0] === "player") return `${playerBySlug.get(seg[1] ?? "")?.name ?? "Player"} · LAXDB`;
  if (seg[0] === "team") return `${teamBySlug.get(seg[1] ?? "")?.name ?? "Team"} · LAXDB`;
  if (seg[0] === "league") return `${leagueById.get(seg[1] ?? "")?.name ?? "League"} · LAXDB`;
  const label = {
    players: "Players", teams: "Teams", leagues: "Leagues", compare: "Compare",
    "my-roster": "My roster", history: "History", origins: "Origins", leaders: "Leaders", scores: "Scores", vs: "Head to head", game: "Game",
  }[seg[0]];
  return label ? `${label} · LAXDB` : "LAXDB";
}

function Routes() {
  const { path } = useRoute();
  // the editor mutates the dataset in place; this is what tells React to paint the new value
  useDataRevision();
  const seg = path.split("/").filter(Boolean);

  useEffect(() => {
    document.title = titleFor(path);
  }, [path]);

  let page: React.ReactNode;
  if (seg.length === 0) page = <Home />;
  else if (seg[0] === "players") page = <Players />;
  else if (seg[0] === "player") page = <PlayerPage />;
  else if (seg[0] === "teams") page = <TeamsPage />;
  else if (seg[0] === "team") page = <TeamPage />;
  else if (seg[0] === "leagues") page = <LeaguesPage />;
  else if (seg[0] === "league") page = <LeaguePage />;
  else if (seg[0] === "compare") page = <ComparePage />;
  else if (seg[0] === "my-roster") page = <MyRoster />;
  else if (seg[0] === "history") page = <History />;
  else if (seg[0] === "origins") page = <Origins />;
  else if (seg[0] === "leaders") page = <Leaders />;
  else if (seg[0] === "scores") page = <Scores />;
  else if (seg[0] === "vs") page = <Versus />;
  else if (seg[0] === "game") page = <Game />;
  else
    page = (
      <div className="page">
        <Empty title="Page not found" body="The link you followed doesn’t exist in this build." />
        <div style={{ textAlign: "center" }}>
          <Link to="/" className="btn btn-primary">Back home</Link>
        </div>
      </div>
    );

  return (
    <div className="app">
      <Nav />
      <main key={path}>{page}</main>
      <CompareTray />
      <Cms />
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider>
        <CompareProvider>
          <Routes />
        </CompareProvider>
      </RouterProvider>
    </ThemeProvider>
  );
}
