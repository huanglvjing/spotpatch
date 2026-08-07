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

/** Protocol hard limit. Runtime configuration may choose a smaller limit. */
export const MAX_ANNOTATION_TARGETS = 20;

/** Each target owns its requested change; the UI enforces the same bound. */
export const MAX_TARGET_INSTRUCTION_CHARACTERS = 2_000;

/** Keeps the complete, atomic user intent within the prompt and request budgets. */
export const MAX_ANNOTATION_INSTRUCTION_CHARACTERS = 4_000;

export const SPOTPATCH_LOCALES = Object.freeze(["en-US", "zh-CN"] as const);
export type SpotPatchLocale = (typeof SPOTPATCH_LOCALES)[number];
export const SPOTPATCH_LOCALE_PREFERENCES = Object.freeze([
  "auto",
  ...SPOTPATCH_LOCALES,
] as const);
export type SpotPatchLocalePreference = (typeof SPOTPATCH_LOCALE_PREFERENCES)[number];

export interface SpotTargetContext {
  readonly instruction: string;
  readonly source: SourceRef;
  readonly react: ReactContext;
  readonly element: ElementContext;
  readonly styles: StyleContext;
  readonly code?: CodeContext;
  readonly warnings: readonly string[];
}

export interface SpotAnnotation {
  readonly schemaVersion: 3;
  readonly id: string;
  readonly locale: SpotPatchLocale;
  readonly page: Readonly<PageContext>;
  readonly targets: readonly SpotTargetContext[];
  readonly createdAt: string;
}
