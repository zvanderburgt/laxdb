import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadDataset, requestPlans } from "./lib/data";
import { loadOverrides } from "./lib/overrides";
import { fingerprint, readEntry, readSeed, writeEntry } from "./lib/cache";
import { installPrefetch, warmOnIdle } from "./lib/prefetch";
import { AppSkeleton, LoadError } from "./components/ui";
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
      <LoadError
        title="This page failed to render"
        body="The data arrived but this page could not draw it. Another route, or a reload, will work — the error is logged to the console."
        error={this.state.error}
        onRetry={() => window.location.reload()}
      />
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

/**
 * The failure a visitor can act on.
 *
 * The old path replaced the document with a paragraph of raw error text and no control of any kind:
 * whatever the cause — a 500, a hung query, a body that was not the slice — the visitor's page was
 * gone and the only move was to edit the URL. Now the skeleton has already been on screen, the page
 * names what failed, and Retry runs the boot again from under a fresh skeleton.
 */
function showLoadError(err: unknown): void {
  console.error("[laxdb] boot failed:", err);
  const message = err instanceof Error ? err.message : String(err);
  const route = window.location.pathname + window.location.search;
  const kind = /did not answer within/.test(message)
    ? "The request timed out: the database was asked for this page's numbers and nothing came back. Trying again is worth it — the first attempt is often a cold start."
    : /answered 5\d\d/.test(message)
      ? "The database is answering with errors right now, which is usually a short outage. Try again in a moment."
      : /answered 4\d\d/.test(message)
        ? "The database rejected this page's request. A reload will not help until that is fixed; the home page asks a different question and may still work."
        : /no data source|no slice/i.test(message)
          ? "The database answered, but with nothing this page could draw."
          : "The request to the database failed before it returned anything.";

  root.render(
    <React.StrictMode>
      <LoadError body={kind} route={route} error={err} onRetry={() => retryBoot()} />
    </React.StrictMode>
  );
}

/** Retry from the skeleton, so the second attempt also shows that it is trying. */
function retryBoot(): void {
  root.render(
    <React.StrictMode>
      <AppSkeleton />
    </React.StrictMode>
  );
  boot().catch(showLoadError);
}

let prefetchInstalled = false;

/**
 * Boot order, cheapest source first.
 *
 * The build bakes the landing page's slice into this document, and every other route keeps its last
 * payload in IndexedDB — so a revisit paints without waiting on a function that may be cold, and the
 * live copy replaces it only when the bytes actually changed. The CMS overrides run beside this,
 * never in front of the first paint; a failed revalidation leaves the stored copy on screen instead
 * of an error page.
 *
 * Three outcomes, and all three leave a usable screen: fresh data (paint), a stored copy that could
 * not be revalidated (paint the copy, keep the warning in the console), or nothing at all (the boot
 * error screen with a retry).
 */
async function boot(): Promise<void> {
  if (!prefetchInstalled) {
    prefetchInstalled = true;
    installPrefetch();
  }

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
    warmOnIdle();
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
    // a stored copy is still on screen, so this failure costs freshness, not the page
    if (paintedHash !== null) {
      console.warn("[laxdb] revalidation failed; the stored copy stays on screen", failure);
      return;
    }
    throw failure ?? new Error("this page has no data source");
  }
  if (freshHash !== paintedHash || !overridesReady) paint();
  warmOnIdle();
}

boot().catch(showLoadError);
