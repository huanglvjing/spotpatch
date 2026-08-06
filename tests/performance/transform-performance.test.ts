import { describe, expect, it } from "vitest";

import { injectSourceMarkers } from "../../packages/vite/src/transform/inject-source-markers.js";

const SAMPLE_COUNT = 160;
const WARMUP_COUNT = 20;

const fixtureSource = `
import type { JSX } from "react";

export function PerformanceFixture(): JSX.Element {
  const items = Array.from({ length: 12 }, (_, index) => index);

  return (
    <main className="performance-page">
      <header><h1>Transform performance fixture</h1></header>
      {items.map((item) => (
        <section className="performance-card" data-testid={\`card-\${item}\`} key={item}>
          <h2>Card {item}</h2>
          <p>Representative JSX content for an ordinary application module.</p>
          <button aria-label={\`Edit card \${item}\`} type="button">Edit</button>
          <input name={\`field-\${item}\`} placeholder="Value" />
        </section>
      ))}
      <footer><small>End of fixture</small></footer>
    </main>
  );
}
`;

const transformOnce = (iteration: number): void => {
  const result = injectSourceMarkers({
    code: fixtureSource,
    absolutePath: `/workspace/src/performance-${String(iteration)}.tsx`,
    root: "/workspace",
    fileId: `fixture-${String(iteration)}`,
  });

  if (result === undefined) {
    throw new Error("The representative JSX fixture was not transformed.");
  }
};

describe("transform performance budget", () => {
  it("keeps uncached representative transforms below median and P95 limits", () => {
    for (let iteration = 0; iteration < WARMUP_COUNT; iteration += 1) {
      transformOnce(iteration);
    }

    const durations: number[] = [];

    for (let iteration = 0; iteration < SAMPLE_COUNT; iteration += 1) {
      const startedAt = performance.now();
      transformOnce(iteration + WARMUP_COUNT);
      durations.push(performance.now() - startedAt);
    }

    durations.sort((left, right) => left - right);
    const median =
      durations[Math.floor(durations.length / 2)] ?? Number.POSITIVE_INFINITY;
    const p95 =
      durations[Math.ceil(durations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;

    expect(median, `uncached transform median was ${median.toFixed(2)}ms`).toBeLessThan(
      5,
    );
    expect(p95, `uncached transform P95 was ${p95.toFixed(2)}ms`).toBeLessThan(20);
  });
});
