import React from "react";
import ReactDOM from "react-dom/client";
import "@juninmd/sonido/styles.css";
import "./ui/sonido-bridge.css";
import App from "./App";

// Sonido reads its palette from `data-theme`; the app itself follows the OS color scheme.
const scheme = window.matchMedia("(prefers-color-scheme: light)");
const applyTheme = () => {
  document.documentElement.dataset.theme = scheme.matches ? "light" : "dark";
};
applyTheme();
scheme.addEventListener("change", applyTheme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
