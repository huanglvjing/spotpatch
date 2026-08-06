import { Button, Modal } from "antd";
import { motion } from "framer-motion";
import { lazy, StrictMode, Suspense, type JSX, useState } from "react";
import { createRoot } from "react-dom/client";

import { BusinessCard } from "./business-card";
import {
  CssModuleFixture,
  ForwardField,
  FragmentFixture,
  ListFixture,
  MemoPanel,
  SecurityFixture,
} from "./fixtures";
import "./styles.css";

const LazyPanel = lazy(() => import("./lazy-panel"));

function App(): JSX.Element {
  const [lazyVisible, setLazyVisible] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <main className="page-shell">
      <header className="hero-panel">
        <span className="avatar" aria-hidden="true">
          SP
        </span>
        <div className="user-info">
          <h1>SpotPatch Playground</h1>
          <p>Select each fixture to validate the complete development workflow.</p>
        </div>
      </header>

      <section aria-labelledby="source-fixtures" className="fixture-section">
        <h2 id="source-fixtures">Source resolution fixtures</h2>
        <div className="fixture-grid">
          <BusinessCard />
          <MemoPanel />
          <ForwardField />
          <FragmentFixture />
          <ListFixture />
          <CssModuleFixture />
        </div>
      </section>

      <section aria-labelledby="integration-fixtures" className="fixture-section">
        <h2 id="integration-fixtures">Integration fixtures</h2>
        <div className="fixture-grid">
          <article className="fixture-card">
            <h3>Lazy module</h3>
            <button
              data-testid="show-lazy"
              type="button"
              onClick={() => {
                setLazyVisible(true);
              }}
            >
              Load lazy fixture
            </button>
            {lazyVisible ? (
              <Suspense fallback={<p>Loading lazy fixture…</p>}>
                <LazyPanel />
              </Suspense>
            ) : null}
          </article>

          <article className="fixture-card">
            <h3>Tailwind</h3>
            <button
              className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white"
              data-testid="tailwind-button"
              type="button"
            >
              Tailwind utility fixture
            </button>
          </article>

          <article className="fixture-card">
            <h3>Framer Motion</h3>
            <motion.button
              data-testid="motion-button"
              type="button"
              whileHover={{ scale: 1.02 }}
            >
              Motion component fixture
            </motion.button>
          </article>

          <article className="fixture-card">
            <h3>SVG</h3>
            <svg
              aria-label="SpotPatch status icon"
              data-testid="svg-fixture"
              role="img"
              viewBox="0 0 48 48"
            >
              <circle cx="24" cy="24" data-testid="svg-circle" fill="#0ea5e9" r="18" />
              <path d="M16 24l5 5 11-12" fill="none" stroke="white" strokeWidth="4" />
            </svg>
          </article>

          <article className="fixture-card fixture-actions">
            <h3>Ant Design</h3>
            <Button
              type="primary"
              onClick={() => {
                setModalOpen(true);
              }}
            >
              Open AntD modal
            </Button>
          </article>
        </div>
      </section>

      <section aria-labelledby="security-fixtures" className="fixture-section">
        <h2 id="security-fixtures">Security fixture</h2>
        <SecurityFixture />
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
