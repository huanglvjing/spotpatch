import type { ReactContext } from "@spotpatch/shared";

export interface ReactAdapter {
  readonly name: string;
  readonly dispose: () => void;
  readonly inspect: (element: Element) => ReactContext;
  readonly supports: (element: Element) => boolean;
}
