import {
  MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
  MAX_ANNOTATION_TARGETS,
  MAX_TARGET_INSTRUCTION_CHARACTERS,
  type CodeContext,
  type ElementContext,
  type PageContext,
  type ReactContext,
  type SourceRef,
  type SpotAnnotation,
  type SpotPatchLocale,
  type SpotTargetContext,
  type StyleContext,
} from "@spotpatch/shared";

export interface CreateAnnotationInput {
  readonly createdAt: string;
  readonly id: string;
  readonly locale: SpotPatchLocale;
  readonly page: PageContext;
  readonly targets: readonly SpotTargetContext[];
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

function freezeTarget(target: SpotTargetContext): SpotTargetContext {
  return Object.freeze({
    instruction: target.instruction.trim(),
    source: freezeSource(target.source, target.code),
    react: freezeReact(target.react),
    element: freezeElement(target.element),
    styles: freezeStyles(target.styles),
    ...(target.code === undefined ? {} : { code: Object.freeze({ ...target.code }) }),
    warnings: Object.freeze([...target.warnings]),
  });
}

export function createAnnotation(input: CreateAnnotationInput): SpotAnnotation {
  if (input.targets.length < 1 || input.targets.length > MAX_ANNOTATION_TARGETS) {
    throw new RangeError(
      `SpotPatch annotations require between 1 and ${String(MAX_ANNOTATION_TARGETS)} targets.`,
    );
  }

  const instructions = input.targets.map((target) => target.instruction.trim());

  if (
    instructions.some(
      (instruction) =>
        instruction.length === 0 ||
        instruction.length > MAX_TARGET_INSTRUCTION_CHARACTERS,
    ) ||
    instructions.reduce((total, instruction) => total + instruction.length, 0) >
      MAX_ANNOTATION_INSTRUCTION_CHARACTERS
  ) {
    throw new RangeError("SpotPatch target instructions exceed the allowed bounds.");
  }

  return Object.freeze({
    schemaVersion: 3,
    id: input.id,
    locale: input.locale,
    page: Object.freeze({ ...input.page }),
    targets: Object.freeze(input.targets.map(freezeTarget)),
    createdAt: input.createdAt,
  });
}
