import type { PageContext } from "@spotpatch/shared";

export type ClipboardWriter = Readonly<{
  writeText(value: string): Promise<void>;
}>;

export function createBrowserAnnotationId(window: Window): string {
  if (typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function collectPageContext(document: Document, window: Window): PageContext {
  return Object.freeze({
    url: window.location.href,
    pathname: window.location.pathname,
    title: document.title,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  });
}

export function resolveClipboardWriter(
  navigator: Navigator,
): ClipboardWriter | undefined {
  const candidate: unknown = Reflect.get(navigator, "clipboard");

  return typeof candidate === "object" &&
    candidate !== null &&
    "writeText" in candidate &&
    typeof candidate.writeText === "function"
    ? (candidate as ClipboardWriter)
    : undefined;
}
