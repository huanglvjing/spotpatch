import { StrictMode, type JSX } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

function App(): JSX.Element {
  return (
    <main className="page-shell">
      <section className="profile-card">
        <span className="avatar" aria-hidden="true">
          SP
        </span>
        <div className="user-info">
          <h1>SpotPatch Playground</h1>
          <p>Select this content after the development plugin is enabled.</p>
        </div>
      </section>
    </main>
  );
}

const root = document.querySelector("#root");

if (!(root instanceof HTMLElement)) {
  throw new Error("Playground root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
