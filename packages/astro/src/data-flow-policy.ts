import type { DataFlowObservationPolicy } from "@spotpatch/runtime/data-flow";

interface PreparationEvent extends Event {
  loader: () => Promise<void>;
  readonly to: URL;
  readonly signal: AbortSignal;
}
function isPreparationEvent(event: Event): event is PreparationEvent {
  return (
    "loader" in event &&
    typeof event.loader === "function" &&
    "to" in event &&
    event.to instanceof URL &&
    "signal" in event &&
    event.signal instanceof AbortSignal
  );
}

/** Scope exclusions to Astro's actual navigation loader, never to app URL prefixes. */
export function createAstroDataFlowPolicy(document: Document): {
  readonly policy: DataFlowObservationPolicy;
  readonly dispose: () => void;
} {
  const navigationLoads = new Map<
    AbortSignal,
    { readonly href: string; readonly count: number }
  >();
  const prepare = (event: Event): void => {
    if (!isPreparationEvent(event)) return;
    const original = event.loader;
    const href = event.to.href;
    event.loader = async () => {
      navigationLoads.set(event.signal, {
        href,
        count: (navigationLoads.get(event.signal)?.count ?? 0) + 1,
      });
      try {
        await original.call(event);
      } finally {
        const pending = (navigationLoads.get(event.signal)?.count ?? 1) - 1;
        if (pending === 0) navigationLoads.delete(event.signal);
        else navigationLoads.set(event.signal, { href, count: pending });
      }
    };
  };
  document.addEventListener("astro:before-preparation", prepare);
  return {
    policy: {
      shouldObserveFetch(input, init, baseUrl) {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const signal = init?.signal;
        return (
          signal === undefined ||
          signal === null ||
          navigationLoads.get(signal)?.href !== new URL(url, baseUrl).href
        );
      },
    },
    dispose() {
      document.removeEventListener("astro:before-preparation", prepare);
      navigationLoads.clear();
    },
  };
}
