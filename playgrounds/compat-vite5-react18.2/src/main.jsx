import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function CompatibilityFixture() {
  return <button type="button">Vite 5 + React 18.2</button>;
}

createRoot(document.querySelector("#root")).render(
  <StrictMode>
    <CompatibilityFixture />
  </StrictMode>,
);
