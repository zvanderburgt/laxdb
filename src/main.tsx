import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadDataset } from "./lib/data";
import "./tailwind.css";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

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
