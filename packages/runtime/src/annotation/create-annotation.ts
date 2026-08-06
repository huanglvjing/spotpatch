import type {
  CodeContext,
  ElementContext,
  PageContext,
  ReactContext,
  SourceRef,
  SpotAnnotation,
  StyleContext,
} from "@spotpatch/shared";

export interface CreateAnnotationInput {
  readonly code?: CodeContext;
  readonly createdAt: string;
  readonly element: ElementContext;
  readonly id: string;
  readonly note: string;
  readonly page: PageContext;
  readonly react: ReactContext;
  readonly source: SourceRef;
  readonly styles: StyleContext;
  readonly warnings: readonly string[];
}

function freezeSource(source: SourceRef, code?: CodeContext): SourceRef {
  return Object.freeze({
    ...source,
    ...(source.relativePath === undefined && code !== undefined
      ? { relativePath: code.relativePath }
      : {}),
  });
}

function freezeReact(react: ReactContext): ReactContext {
  return Object.freeze({
    ...react,
    componentStack: Object.freeze([...react.componentStack]),
    ...(react.source === undefined ? {} : { source: freezeSource(react.source) }),
  });
}

function freezeElement(element: ElementContext): ElementContext {
  return Object.freeze({
    ...element,
    rect: Object.freeze({ ...element.rect }),
  });
}

function freezeStyles(styles: StyleContext): StyleContext {
  return Object.freeze({
    ...styles,
    classNames: Object.freeze([...styles.classNames]),
    matchedRules: Object.freeze(
      styles.matchedRules.map((rule) => Object.freeze({ ...rule })),
    ),
    computed: Object.freeze({ ...styles.computed }),
    warnings: Object.freeze([...styles.warnings]),
  });
}

export function createAnnotation(input: CreateAnnotationInput): SpotAnnotation {
  return Object.freeze({
    schemaVersion: 1,
    id: input.id,
    note: input.note,
    page: Object.freeze({ ...input.page }),
    source: freezeSource(input.source, input.code),
    react: freezeReact(input.react),
    element: freezeElement(input.element),
    styles: freezeStyles(input.styles),
    ...(input.code === undefined ? {} : { code: Object.freeze({ ...input.code }) }),
    warnings: Object.freeze([...input.warnings]),
    createdAt: input.createdAt,
  });
}
