import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadDataset } from "./lib/data";
import { AppSkeleton } from "./components/ui";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

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
  .then(() => {
    root.render(
      <React.StrictMode>
        <App />
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
