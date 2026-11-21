import React, { useMemo, useState } from "react";
import { Link } from "../lib/app";
import { data, leagueById } from "../lib/data";
import { BlockList, Card, Empty, Segmented } from "../components/ui";

type Row = {
  key: string;
  name: string;
  role: string;
  teamId: string;
  teamName: string;
  teamSlug: string;
  conference: string;
  leagueId: string;
  leagueName: string;
  head: boolean;
};

/** A head-coach role, however the school's page words it ("Head Men's Lacrosse Coach"). */
const isHead = (role: string) => /head/i.test(role);

/**
 * Who runs each program. Every staff row we hold, grouped by programme, searchable by name or club
 * — the coach directory LaxGrid publishes, built from the school pages the importer already reads.
 * Coverage is honest at the top of the page: several competitions publish no staff list at all.
 */
export default function Coaches() {
  const [q, setQ] = useState("");
  const [league, setLeague] = useState("all");
  const [view, setView] = useState<"program" | "name">("program");

  const { rows, covered, total, leagues } = useMemo(() => {
    const rows: Row[] = [];
    let covered = 0;
    for (const t of data.teams) {
      const staff = t.staff ?? [];
      if (staff.length) covered += 1;
      const lg = leagueById.get(t.leagueId);
      staff.forEach((s, i) => {
        rows.push({
          key: `${t.id}-${i}-${s.name}`,
          name: s.name,
          role: s.role,
          teamId: t.id,
          teamName: t.name,
          teamSlug: t.slug,
          conference: t.conference ?? "",
          leagueId: t.leagueId,
          leagueName: lg?.short ?? lg?.name ?? "",
          head: isHead(s.role),
        });
      });
    }
    const leagues = [...new Set(rows.map((r) => r.leagueId))]
      .map((id) => ({ id, label: leagueById.get(id)?.short ?? leagueById.get(id)?.name ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { rows, covered, total: data.teams.length, leagues };
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const picked = rows.filter((r) => {
      if (league !== "all" && r.leagueId !== league) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.role.toLowerCase().includes(needle) ||
        r.teamName.toLowerCase().includes(needle)
      );
    });
    const sorted = [...picked].sort((a, b) => {
      if (view === "name") return a.name.localeCompare(b.name);
      // by programme: conference, then club, then the head coach first
      const byConf = a.conference.localeCompare(b.conference);
      if (byConf) return byConf;
      const byTeam = a.teamName.localeCompare(b.teamName);
      if (byTeam) return byTeam;
      if (a.head !== b.head) return a.head ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [rows, q, league, view]);

  if (!rows.length) {
    return (
      <div className="page">
        <Empty title="No staff on file yet" body="The importer has not read a staff page for any competition." />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Directory</div>
          <h1>Coaches</h1>
          <p className="muted">
            {rows.length.toLocaleString()} people across {covered} of {total} programs · staff as the
            school athletics pages publish it
          </p>
        </div>
        <Segmented
          ariaLabel="Sort"
          options={[
            { value: "program", label: "By program" },
            { value: "name", label: "A–Z" },
          ]}
          value={view}
          onChange={(v) => setView(v as "program" | "name")}
        />
      </div>

      <div className="filterbar">
        <div className="filter-search">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12.8 12.8L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, role or program"
            aria-label="Search coaches"
          />
          {q ? (
            <button className="clear-x" onClick={() => setQ("")} aria-label="Clear">
              ×
            </button>
          ) : null}
        </div>

        <div className="pos-pills">
          <button className={`pill ${league === "all" ? "is-on" : ""}`} onClick={() => setLeague("all")}>
            All competitions
          </button>
          {leagues.map((l) => (
            <button
              key={l.id}
              className={`pill ${league === l.id ? "is-on" : ""}`}
              onClick={() => setLeague(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <Card padded={false} className="standings-card">
        <div className="card-toolbar">
          <div>
            <h3 className="card-title">
              {list.length.toLocaleString()} {list.length === 1 ? "person" : "people"}
            </h3>
            <p className="muted small">
              {league === "all" ? "Every competition with a staff page" : leagueById.get(league)?.name}
              {q.trim() ? ` · matching “${q.trim()}”` : ""}
            </p>
          </div>
        </div>

        {/* phones: one block per person, grouped under the competition */}
        <BlockList
          motionKey={`${view}|${league}|${q}`}
          rows={list.slice(0, 400).map((r) => ({
            key: r.key,
            group: view === "program" ? [r.conference || r.leagueName].filter(Boolean).join("") : undefined,
            primary: <span className={r.head ? "strong" : ""}>{r.name}</span>,
            meta: r.role,
            cells: [
              {
                label: "Program",
                value: (
                  <Link to={`/team/${r.teamSlug}`} className="cell-link">
                    {r.teamName}
                  </Link>
                ),
              },
              { label: "Competition", value: r.leagueName },
            ],
          }))}
        />
        {list.length > 400 ? <div className="table-note">Showing the first 400 — narrow the search.</div> : null}

        <div className="table-scroll hide-sm">
          <table className="data-table">
            <thead>
              <tr>
                <th>Coach</th>
                <th>Role</th>
                <th>Program</th>
                <th className="col-detail">Conference</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 400).map((r) => (
                <tr key={r.key}>
                  <td className={r.head ? "strong" : ""}>{r.name}</td>
                  <td className="muted small">{r.role}</td>
                  <td>
                    <Link to={`/team/${r.teamSlug}`} className="cell-link">
                      {r.teamName}
                    </Link>
                  </td>
                  <td className="muted small col-detail">{r.conference || r.leagueName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-note">
          Staff lists come from each program's own athletics page, so a programme that publishes none
          (most of the box leagues, the MCLA) is simply absent rather than empty.
        </div>
      </Card>
    </div>
  );
}
