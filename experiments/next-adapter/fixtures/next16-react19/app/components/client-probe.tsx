"use client";

import { useEffect, useState } from "react";

const REFRESH_LABEL = "INITIAL_REFRESH_LABEL";

export function ClientProbe() {
  const [count, setCount] = useState<number>(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <section data-hydrated={hydrated} data-spotpatch-loader-probe="inactive">
      <h2 data-refresh-label>{REFRESH_LABEL}</h2>
      <button
        data-counter
        type="button"
        onClick={() => {
          setCount((value) => value + 1);
        }}
      >
        {count}
      </button>
    </section>
  );
}
