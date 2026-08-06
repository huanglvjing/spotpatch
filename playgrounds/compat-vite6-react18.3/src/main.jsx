import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function CompatibilityFixture() {
  return <button type="button">Vite 6 + React 18.3</button>;
}

createRoot(document.querySelector("#root")).render(
  <StrictMode>
    <CompatibilityFixture />
  </StrictMode>,
);
