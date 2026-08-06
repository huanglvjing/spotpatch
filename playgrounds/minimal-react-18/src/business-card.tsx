import type { JSX } from "react";

export function BusinessCard(): JSX.Element {
  return (
    <article className="fixture-card" data-testid="business-card">
      <h3>Business component fixture</h3>
      <p data-testid="business-card-content">
        This host element is owned by a named application component.
      </p>
    </article>
  );
}
