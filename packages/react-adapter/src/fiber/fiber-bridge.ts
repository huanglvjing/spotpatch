export interface FiberSourceLocation {
  readonly column?: number;
  readonly fileName: string;
  readonly line?: number;
}

export interface FiberMatch {
  readonly node: unknown;
  readonly version?: string;
}

export interface FiberBridge {
  readonly find: (element: Element) => FiberMatch | undefined;
  readonly getAncestors: (node: unknown) => readonly unknown[];
  readonly getDisplayName: (node: unknown) => string | undefined;
  readonly getComponentType?: (node: unknown) => object | undefined;
  readonly getSource: (node: unknown) => FiberSourceLocation | undefined;
  readonly isComposite: (node: unknown) => boolean;
}
