import type { JSX } from "react";

export default function LazyPanel(): JSX.Element {
  return (
    <div className="lazy-panel" data-testid="lazy-panel">
      Lazy route-equivalent module loaded on demand.
    </div>
  );
}
