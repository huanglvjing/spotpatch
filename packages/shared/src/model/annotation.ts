import type { CodeContext } from "./code-context.js";
import type { ReactContext, SourceRef } from "./source-ref.js";
import type { StyleContext } from "./style-context.js";

export interface PageContext {
  readonly url: string;
  readonly pathname: string;
  readonly title: string;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly devicePixelRatio: number;
}

export interface ElementContext {
  readonly tagName: string;
  readonly selector: string;
  readonly sanitizedHtml: string;
  readonly textPreview?: string;
  readonly role?: string;
  readonly rect: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface SpotAnnotation {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly note: string;
  readonly page: Readonly<PageContext>;
  readonly source: SourceRef;
  readonly react: ReactContext;
  readonly element: ElementContext;
  readonly styles: StyleContext;
  readonly code?: CodeContext;
  readonly warnings: readonly string[];
  readonly createdAt: string;
}
