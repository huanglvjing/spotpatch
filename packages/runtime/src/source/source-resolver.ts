import type { ReactAdapter } from "@spotpatch/react-adapter";
import {
  parseSourceMarker,
  SOURCE_MARKER_ATTRIBUTE,
  type ReactContext,
  type SourceMarker,
  type SourceRef,
} from "@spotpatch/shared";

const EMPTY_REACT_CONTEXT = Object.freeze({
  supported: false,
  componentStack: Object.freeze([]),
}) satisfies ReactContext;

export interface ElementSourceResolution {
  readonly react: ReactContext;
  readonly source: SourceRef;
}

export interface SourceResolver {
  readonly dispose: () => void;
  readonly resolve: (element: Element) => ElementSourceResolution;
}

export interface CreateSourceResolverOptions {
  readonly adapter: ReactAdapter;
  readonly onAdapterError?: () => void;
}

function directMarker(element: Element): SourceMarker | undefined {
  return parseSourceMarker(element.getAttribute(SOURCE_MARKER_ATTRIBUTE));
}

function ancestorMarker(element: Element): SourceMarker | undefined {
  let ancestor = element.parentElement;

  while (ancestor !== null) {
    const marker = directMarker(ancestor);

    if (marker !== undefined) {
      return marker;
    }

    ancestor = ancestor.parentElement;
  }

  return undefined;
}

function markerSource(
  marker: SourceMarker,
  origin: "jsx-host" | "dom-ancestor",
  confidence: "exact" | "approximate",
): SourceRef {
  return Object.freeze({
    fileId: marker.fileId,
    line: marker.line,
    column: marker.column,
    origin,
    confidence,
  });
}

function unknownSource(): SourceRef {
  return Object.freeze({ origin: "none", confidence: "unknown" });
}

export function sourceRefToMarker(source: SourceRef): SourceMarker | undefined {
  return source.fileId === undefined ||
    source.line === undefined ||
    source.column === undefined
    ? undefined
    : Object.freeze({
        fileId: source.fileId,
        line: source.line,
        column: source.column,
      });
}

export function createSourceResolver(
  options: CreateSourceResolverOptions,
): SourceResolver {
  let adapterEnabled = true;

  function inspectReact(element: Element): ReactContext {
    if (!adapterEnabled) {
      return EMPTY_REACT_CONTEXT;
    }

    try {
      return options.adapter.inspect(element);
    } catch {
      adapterEnabled = false;
      options.onAdapterError?.();
      return EMPTY_REACT_CONTEXT;
    }
  }

  return Object.freeze({
    resolve(element: Element): ElementSourceResolution {
      const marker = directMarker(element);
      const react = inspectReact(element);

      if (marker !== undefined) {
        return Object.freeze({
          react,
          source: markerSource(marker, "jsx-host", "exact"),
        });
      }

      if (react.source !== undefined) {
        return Object.freeze({ react, source: react.source });
      }

      const nearestAncestor = ancestorMarker(element);

      if (nearestAncestor !== undefined) {
        return Object.freeze({
          react,
          source: markerSource(nearestAncestor, "dom-ancestor", "approximate"),
        });
      }

      return Object.freeze({ react, source: unknownSource() });
    },

    dispose(): void {
      adapterEnabled = false;
      options.adapter.dispose();
    },
  });
}
