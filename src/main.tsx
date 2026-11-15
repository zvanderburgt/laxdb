import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadDataset } from "./lib/data";
import { loadOverrides } from "./lib/overrides";
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

// the dataset is several megabytes, so the shell paints before it lands: theme first (or a
// dark-mode reader gets a white flash), then a skeleton shaped like the page
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

loadDataset()
  .then(() => loadOverrides())
  .then(() => {
    root.render(
      <React.StrictMode>
        <Boundary>
          <App />
        </Boundary>
      </React.StrictMode>
    );
  })
  .catch((err) => {
    root.render(
      <div style={{ padding: 48, fontFamily: "system-ui", color: "#1d1d1f" }}>
        <h1 style={{ fontSize: 24 }}>Couldn't load the player database</h1>
        <p style={{ color: "#6e6e73" }}>{String(err)}</p>
      </div>
    );
  });
