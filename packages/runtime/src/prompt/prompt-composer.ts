import type {
  MatchedStyleRule,
  SpotAnnotation,
  SpotPatchLocale,
  SpotTargetContext,
} from "@spotpatch/shared";

import {
  redactSensitiveText,
  sanitizeCssText,
  sanitizeUrl,
} from "../security/content-sanitizer.js";

interface PromptMessages {
  readonly adapter: string;
  readonly boundary: string;
  readonly code: string;
  readonly component: string;
  readonly computedStyles: string;
  readonly confidence: string;
  readonly devicePixelRatio: string;
  readonly element: string;
  readonly file: string;
  readonly modificationConstraint: string;
  readonly modificationRequirements: string;
  readonly origin: string;
  readonly pageEnvironment: string;
  readonly pathname: string;
  readonly reactContext: string;
  readonly reactVersion: string;
  readonly requestedChange: string;
  readonly selectedTargets: (count: number) => string;
  readonly source: string;
  readonly stack: string;
  readonly styles: string;
  readonly supported: string;
  readonly target: (index: number) => string;
  readonly title: string;
  readonly unavailable: string;
  readonly unsupported: string;
  readonly url: string;
  readonly viewport: string;
  readonly warnings: string;
  readonly none: string;
}

const PROMPT_MESSAGES = Object.freeze({
  "en-US": Object.freeze({
    adapter: "Adapter",
    boundary: "Boundary",
    code: "Nearby code",
    component: "Component",
    computedStyles: "Key computed styles",
    confidence: "Confidence",
    devicePixelRatio: "Device pixel ratio",
    element: "Selected element",
    file: "File",
    modificationConstraint:
      "Determine the root cause first, then implement every target instruction as one consistent, minimum-scope change. Do not modify unrelated components. If context is insufficient, state exactly what additional information is required.",
    modificationRequirements: "Change requirements",
    origin: "Origin",
    pageEnvironment: "Page environment",
    pathname: "Pathname",
    reactContext: "React context",
    reactVersion: "React",
    requestedChange: "Requested change",
    selectedTargets: (count: number) => `Selected targets (${String(count)})`,
    source: "Source",
    stack: "Stack",
    styles: "Relevant styles",
    supported: "supported",
    target: (index: number) => `Target ${String(index)}`,
    title: "Title",
    unavailable: "Unavailable",
    unsupported: "unsupported",
    url: "URL",
    viewport: "Viewport",
    warnings: "Collection warnings",
    none: "None",
  }),
  "zh-CN": Object.freeze({
    adapter: "适配器",
    boundary: "代码边界",
    code: "附近代码",
    component: "组件",
    computedStyles: "关键计算样式",
    confidence: "置信度",
    devicePixelRatio: "设备像素比",
    element: "选中元素",
    file: "文件",
    modificationConstraint:
      "请先判断根因，再把每个目标各自的修改说明作为一个原子任务，完成一致且最小范围的修改。不要合并、忽略或扩大目标说明，不要改动无关组件；如果上下文不足，请明确说明需要哪些信息。",
    modificationRequirements: "修改要求",
    origin: "定位来源",
    pageEnvironment: "页面环境",
    pathname: "路径",
    reactContext: "React 上下文",
    reactVersion: "React",
    requestedChange: "修改说明",
    selectedTargets: (count: number) => `已选目标（${String(count)}）`,
    source: "源码定位",
    stack: "组件栈",
    styles: "相关样式",
    supported: "支持",
    target: (index: number) => `目标 ${String(index)}`,
    title: "标题",
    unavailable: "不可用",
    unsupported: "不支持",
    url: "URL",
    viewport: "视口",
    warnings: "采集警告",
    none: "无",
  }),
} satisfies Readonly<Record<SpotPatchLocale, PromptMessages>>);

interface TargetDraft {
  codeLines: string[];
  computedEntries: [string, string][];
  dom: string;
  instruction: string;
  matchedRules: MatchedStyleRule[];
  reactStack: string[];
  warnings: string[];
}

interface PromptDraft {
  pageTitle: string;
  targets: TargetDraft[];
}

export interface PromptComposer {
  readonly compose: (annotation: SpotAnnotation) => string;
}

export interface CreatePromptComposerOptions {
  readonly maxCharacters: number;
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...Array.from(value.matchAll(/`+/gu), (match) => match[0].length));
}

function fenced(language: string, value: string): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(value) + 1));
  return `${fence}${language}\n${value}\n${fence}`;
}

function sourceLocation(target: SpotTargetContext, messages: PromptMessages): string {
  const path = target.code?.relativePath ?? target.source.relativePath;
  const line = target.source.line;
  const column = target.source.column;

  if (path === undefined) {
    return messages.unavailable;
  }

  return `${redactSensitiveText(path)}${line === undefined ? "" : `:${String(line)}`}${column === undefined ? "" : `:${String(column)}`}`;
}

function openingTag(sanitizedHtml: string, unavailable: string): string {
  return (
    sanitizedHtml
      .split("\n")
      .find((line) => /^\s*<[a-z][^>]*>/iu.test(line))
      ?.trim() ?? unavailable
  );
}

function renderRule(rule: MatchedStyleRule): string {
  const metadata = [
    rule.source === undefined
      ? undefined
      : `/* source: ${sanitizeCssText(rule.source)} */`,
    rule.media === undefined
      ? undefined
      : `/* condition: ${sanitizeCssText(rule.media)} */`,
  ].filter((line): line is string => line !== undefined);
  const body = `${sanitizeCssText(rule.selector)} {\n  ${sanitizeCssText(rule.declarations)}\n}`;
  return [...metadata, body].join("\n");
}

function renderStyles(
  target: SpotTargetContext,
  rules: readonly MatchedStyleRule[],
  messages: PromptMessages,
): string {
  const metadata = [
    target.styles.classNames.length === 0
      ? undefined
      : `/* classes: ${target.styles.classNames.map(sanitizeCssText).join(" ")} */`,
    target.styles.inlineStyle === undefined
      ? undefined
      : `/* inline: ${sanitizeCssText(target.styles.inlineStyle)} */`,
  ].filter((line): line is string => line !== undefined);
  const blocks = [...metadata, ...rules.map(renderRule)];
  return blocks.length === 0
    ? messages.unavailable
    : fenced("css", blocks.join("\n\n"));
}

function renderComputed(
  entries: readonly [string, string][],
  messages: PromptMessages,
): string {
  return entries.length === 0
    ? messages.unavailable
    : fenced(
        "css",
        entries
          .map(
            ([name, value]) => `${sanitizeCssText(name)}: ${sanitizeCssText(value)};`,
          )
          .join("\n"),
      );
}

function renderTarget(
  target: SpotTargetContext,
  draft: TargetDraft,
  index: number,
  messages: PromptMessages,
): string {
  const reactLines = [
    `- ${messages.adapter}: ${target.react.supported ? messages.supported : messages.unsupported}`,
    ...(target.react.version === undefined
      ? []
      : [`- ${messages.reactVersion}: ${redactSensitiveText(target.react.version)}`]),
    ...(target.react.componentName === undefined
      ? []
      : [
          `- ${messages.component}: ${redactSensitiveText(target.react.componentName)}`,
        ]),
    ...(draft.reactStack.length === 0
      ? []
      : [
          `- ${messages.stack}: ${draft.reactStack.map(redactSensitiveText).join(" > ")}`,
        ]),
  ];
  const code =
    target.code === undefined || draft.codeLines.length === 0
      ? messages.unavailable
      : `- ${messages.boundary}: ${target.code.boundary}\n\n${fenced(
          target.code.language,
          redactSensitiveText(draft.codeLines.join("\n")),
        )}`;

  return [
    `### ${messages.target(index + 1)}`,
    `#### ${messages.requestedChange}`,
    draft.instruction,
    ...(target.page === undefined
      ? []
      : [
          `#### ${messages.pageEnvironment}`,
          `- ${messages.url}: <${sanitizeUrl(target.page.url, target.page.url)}>\n- ${messages.pathname}: ${redactSensitiveText(target.page.pathname)}\n- ${messages.title}: ${redactSensitiveText(target.page.title) || messages.unavailable}`,
        ]),
    `#### ${messages.reactContext}`,
    reactLines.join("\n"),
    `#### ${messages.source}`,
    `- ${messages.file}: ${sourceLocation(target, messages)}\n- ${messages.origin}: ${target.source.origin}\n- ${messages.confidence}: ${target.source.confidence}`,
    `#### ${messages.element}`,
    fenced("html", redactSensitiveText(draft.dom)),
    `#### ${messages.styles}`,
    renderStyles(target, draft.matchedRules, messages),
    `#### ${messages.computedStyles}`,
    renderComputed(draft.computedEntries, messages),
    `#### ${messages.code}`,
    code,
    `#### ${messages.warnings}`,
    draft.warnings.length === 0
      ? `- ${messages.none}`
      : draft.warnings.map((warning) => `- ${redactSensitiveText(warning)}`).join("\n"),
  ].join("\n\n");
}

function renderPrompt(annotation: SpotAnnotation, draft: PromptDraft): string {
  const pageUrl = sanitizeUrl(annotation.page.url, annotation.page.url);
  const messages = PROMPT_MESSAGES[annotation.locale];

  return [
    `## ${messages.pageEnvironment}`,
    `- ${messages.url}: <${pageUrl}>\n- ${messages.pathname}: ${redactSensitiveText(annotation.page.pathname)}\n- ${messages.title}: ${draft.pageTitle.length === 0 ? messages.unavailable : draft.pageTitle}\n- ${messages.viewport}: ${String(annotation.page.viewportWidth)} × ${String(annotation.page.viewportHeight)}\n- ${messages.devicePixelRatio}: ${String(annotation.page.devicePixelRatio)}`,
    `## ${messages.selectedTargets(annotation.targets.length)}`,
    annotation.targets
      .map((target, index) => {
        const targetDraft = draft.targets[index];

        if (targetDraft === undefined) {
          throw new RangeError("Prompt target draft is missing.");
        }

        return renderTarget(target, targetDraft, index, messages);
      })
      .join("\n\n"),
    `## ${messages.modificationRequirements}`,
    messages.modificationConstraint,
  ].join("\n\n");
}

function shrinkCode(target: SpotTargetContext, draft: TargetDraft): boolean {
  if (draft.codeLines.length === 0 || target.code === undefined) {
    return false;
  }

  if (draft.codeLines.length === 1) {
    const line = draft.codeLines[0] ?? "";

    if (line.length <= 120) {
      draft.codeLines = [];
    } else {
      draft.codeLines = [`${line.slice(0, 119)}…`];
    }

    return true;
  }

  const selectedLine = target.source.line ?? target.code.startLine;
  const firstDistance = Math.abs(target.code.startLine - selectedLine);
  const lastLine = target.code.startLine + draft.codeLines.length - 1;
  const lastDistance = Math.abs(lastLine - selectedLine);

  if (lastDistance >= firstDistance) {
    draft.codeLines.pop();
  } else {
    draft.codeLines.shift();
  }

  return true;
}

function createTargetDraft(target: SpotTargetContext): TargetDraft {
  return {
    instruction: redactSensitiveText(target.instruction.trim()),
    reactStack: [...target.react.componentStack],
    dom: target.element.sanitizedHtml,
    matchedRules: [...target.styles.matchedRules],
    computedEntries: Object.entries(target.styles.computed),
    codeLines: target.code?.excerpt.split(/\r?\n/u) ?? [],
    warnings: Array.from(new Set([...target.styles.warnings, ...target.warnings])),
  };
}

function createDraft(annotation: SpotAnnotation): PromptDraft {
  return {
    pageTitle: redactSensitiveText(annotation.page.title),
    targets: annotation.targets.map(createTargetDraft),
  };
}

function shrinkTargetsFairly(
  annotation: SpotAnnotation,
  draft: PromptDraft,
  cursor: number,
): number | undefined {
  const messages = PROMPT_MESSAGES[annotation.locale];
  const operations: readonly ((
    target: SpotTargetContext,
    value: TargetDraft,
  ) => boolean)[] = [
    (_target, value) => value.computedEntries.pop() !== undefined,
    (_target, value) => value.reactStack.pop() !== undefined,
    (_target, value) => {
      const selectedOpeningTag = openingTag(value.dom, messages.unavailable);

      if (value.dom === selectedOpeningTag) {
        return false;
      }

      value.dom = selectedOpeningTag;
      return true;
    },
    (_target, value) => value.matchedRules.shift() !== undefined,
    shrinkCode,
    (_target, value) => value.warnings.pop() !== undefined,
  ];

  for (const operation of operations) {
    for (let offset = 0; offset < annotation.targets.length; offset += 1) {
      const index = (cursor + offset) % annotation.targets.length;
      const target = annotation.targets[index];
      const targetDraft = draft.targets[index];

      if (
        target !== undefined &&
        targetDraft !== undefined &&
        operation(target, targetDraft)
      ) {
        return (index + 1) % annotation.targets.length;
      }
    }
  }

  return undefined;
}

function renderCompactPrompt(annotation: SpotAnnotation, draft: PromptDraft): string {
  const messages = PROMPT_MESSAGES[annotation.locale];
  const targets = annotation.targets.map((target, index) => {
    const targetDraft = draft.targets[index];
    const component = target.react.componentName;
    return [
      `### ${messages.target(index + 1)}`,
      `- ${messages.requestedChange}: ${targetDraft?.instruction ?? redactSensitiveText(target.instruction)}`,
      `- ${messages.file}: ${sourceLocation(target, messages)}`,
      ...(component === undefined
        ? []
        : [`- ${messages.component}: ${redactSensitiveText(component)}`]),
      `- ${messages.element}: ${redactSensitiveText(openingTag(targetDraft?.dom ?? target.element.sanitizedHtml, messages.unavailable))}`,
    ].join("\n");
  });

  return [
    `## ${messages.selectedTargets(annotation.targets.length)}`,
    targets.join("\n\n"),
    `## ${messages.modificationRequirements}`,
    messages.modificationConstraint,
  ].join("\n\n");
}

function composeBounded(annotation: SpotAnnotation, maxCharacters: number): string {
  const draft = createDraft(annotation);
  let prompt = renderPrompt(annotation, draft);
  let cursor = 0;

  while (prompt.length > maxCharacters) {
    const nextCursor = shrinkTargetsFairly(annotation, draft, cursor);

    if (nextCursor === undefined) {
      if (draft.pageTitle.length > 0) {
        draft.pageTitle = "";
      } else {
        break;
      }
    } else {
      cursor = nextCursor;
    }

    prompt = renderPrompt(annotation, draft);
  }

  if (prompt.length <= maxCharacters) {
    return prompt;
  }

  const compact = renderCompactPrompt(annotation, draft);

  if (compact.length > maxCharacters) {
    throw new RangeError(
      "Prompt budget cannot preserve every target instruction and source location.",
    );
  }

  return compact;
}

export function createPromptComposer(
  options: CreatePromptComposerOptions,
): PromptComposer {
  if (!Number.isSafeInteger(options.maxCharacters) || options.maxCharacters <= 0) {
    throw new RangeError("Prompt character budget must be a positive integer.");
  }

  return Object.freeze({
    compose(annotation: SpotAnnotation): string {
      return composeBounded(annotation, options.maxCharacters);
    },
  });
}
