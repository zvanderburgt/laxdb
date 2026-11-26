import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadDataset, requestPlans } from "./lib/data";
import { loadOverrides } from "./lib/overrides";
import { fingerprint, readEntry, readSeed, writeEntry } from "./lib/cache";
import { installPrefetch } from "./lib/prefetch";
import { AppSkeleton } from "./components/ui";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

/**
 * A render error in one page must not blank the whole document. Without this, an exception
 * inside a route unmounts the tree and leaves an empty <body> — no message, no way back.
 */
class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[laxdb] render failed:", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 48, fontFamily: "system-ui", color: "#1d1d1f", maxWidth: 720 }}>
        <h1 style={{ fontSize: 22, fontWeight: 650 }}>This page failed to render</h1>
        <p style={{ color: "#6e6e73", fontSize: 14 }}>{String(this.state.error.message)}</p>
        <p>
          <a href="/" style={{ color: "#0b6bcb" }}>Back to LAXDB</a>
        </p>
      </div>
    );
  }
}

// theme first, or a dark-mode reader gets a white flash under a page that paints from cache
const saved = localStorage.getItem("laxdb-theme");
document.documentElement.dataset.theme =
  saved === "dark" || saved === "light"
    ? saved
    : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

root.render(
  <React.StrictMode>
    <AppSkeleton />
  </React.StrictMode>
);

function paint(): void {
  root.render(
    <React.StrictMode>
      <Boundary>
        <App />
      </Boundary>
    </React.StrictMode>
  );
}

function showLoadError(err: unknown): void {
  root.render(
    <div style={{ padding: 48, fontFamily: "system-ui", color: "#1d1d1f" }}>
      <h1 style={{ fontSize: 24 }}>Couldn't load the player database</h1>
      <p style={{ color: "#6e6e73" }}>{String(err)}</p>
    </div>
  );
}

/**
 * Boot order, cheapest source first.
 *
 * The build bakes the landing page's slice into this document, and every other route keeps its last
 * payload in IndexedDB — so a revisit paints without waiting on a function that may be cold, and the
 * live copy replaces it only when the bytes actually changed. The CMS overrides run beside this,
 * never in front of the first paint; a failed revalidation leaves the stored copy on screen instead
 * of an error page.
 */
async function boot(): Promise<void> {
  installPrefetch();

  const plans = requestPlans();

  let overridesReady = false;
  const overrides = loadOverrides().then(() => {
    overridesReady = true;
  });
  overrides.catch(() => {});

  if (!plans.length) {
    // /players draws its own rows and has no slice to cache; an unmapped route throws here
    await loadDataset();
    await overrides;
    paint();
    return;
  }

  let paintedHash: number | null = null;

  const seed = readSeed();
  if (seed) {
    const match = plans.find((candidate) => candidate.key === seed.key);
    if (match && match.apply(seed.text)) paintedHash = fingerprint(seed.text);
  }
  if (paintedHash === null) {
    for (const candidate of plans) {
      const entry = await readEntry(candidate.key);
      if (entry && candidate.apply(entry.text)) {
        paintedHash = entry.hash;
        break;
      }
    }
  }
  if (paintedHash !== null) {
    // give the overrides a moment to land, but never hold the first paint on them
    await Promise.race([overrides.catch(() => {}), new Promise((done) => setTimeout(done, 300))]);
    paint();
  }

  let freshHash: number | null = null;
  let failure: unknown = null;
  for (const candidate of plans) {
    try {
      const text = await candidate.fetch();
      if (!candidate.apply(text)) continue;
      freshHash = fingerprint(text);
      void writeEntry(candidate.key, text);
      break;
    } catch (err) {
      failure = err;
    }
  }

  await overrides;
  if (freshHash === null) {
    if (paintedHash === null) throw failure ?? new Error("this page has no data source");
    console.warn("[laxdb] revalidation failed; the stored copy stays on screen", failure);
    return;
  }
  if (freshHash !== paintedHash || !overridesReady) paint();
}

boot().catch(showLoadError);
