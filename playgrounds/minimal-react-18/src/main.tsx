import { Button, Modal } from "antd";
import { StrictMode, type JSX, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

function App(): JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <main className="page-shell">
      <section className="profile-card">
        <span className="avatar" aria-hidden="true">
          SP
        </span>
        <div className="user-info">
          <h1>SpotPatch Playground</h1>
          <p>Select this content after the development plugin is enabled.</p>
          <div className="fixture-actions">
            <Button
              type="primary"
              onClick={() => {
                setModalOpen(true);
              }}
            >
              Open AntD modal
            </Button>
          </div>
        </div>
      </section>
      <Modal
        footer={null}
        open={modalOpen}
        title="AntD portal fixture"
        onCancel={() => {
          setModalOpen(false);
        }}
      >
        <p>Portal target rendered outside the application DOM tree.</p>
      </Modal>
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
