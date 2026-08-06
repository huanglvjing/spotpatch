import type { MatchedStyleRule, SpotAnnotation } from "@spotpatch/shared";

import {
  redactSensitiveText,
  sanitizeCssText,
  sanitizeUrl,
} from "../security/content-sanitizer.js";

const MODIFICATION_CONSTRAINT =
  "请先判断根因，再给出最小范围修改。不要改动无关组件；如果上下文不足，请明确说明需要哪些信息。";

const SECTION_TITLES = Object.freeze([
  "## 问题",
  "## 页面环境",
  "## React 上下文",
  "## 源码定位",
  "## 选中元素",
  "## 相关样式",
  "## 关键计算样式",
  "## 附近代码",
  "## 采集警告",
  "## 修改要求",
] as const);

interface PromptDraft {
  codeLines: string[];
  computedEntries: [string, string][];
  dom: string;
  matchedRules: MatchedStyleRule[];
  note: string;
  pageTitle: string;
  reactStack: string[];
  warnings: string[];
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

function sourceLocation(annotation: SpotAnnotation): string {
  const path = annotation.code?.relativePath ?? annotation.source.relativePath;
  const line = annotation.source.line;
  const column = annotation.source.column;

  if (path === undefined) {
    return "Unavailable";
  }

  return `${redactSensitiveText(path)}${line === undefined ? "" : `:${String(line)}`}${column === undefined ? "" : `:${String(column)}`}`;
}

function openingTag(sanitizedHtml: string): string {
  return (
    sanitizedHtml
      .split("\n")
      .find((line) => /^\s*<[a-z][^>]*>/iu.test(line))
      ?.trim() ?? "Unavailable"
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
  annotation: SpotAnnotation,
  rules: readonly MatchedStyleRule[],
): string {
  const metadata = [
    annotation.styles.classNames.length === 0
      ? undefined
      : `/* classes: ${annotation.styles.classNames.map(sanitizeCssText).join(" ")} */`,
    annotation.styles.inlineStyle === undefined
      ? undefined
      : `/* inline: ${sanitizeCssText(annotation.styles.inlineStyle)} */`,
  ].filter((line): line is string => line !== undefined);
  const blocks = [...metadata, ...rules.map(renderRule)];
  return blocks.length === 0 ? "Unavailable" : fenced("css", blocks.join("\n\n"));
}

function renderComputed(entries: readonly [string, string][]): string {
  return entries.length === 0
    ? "Unavailable"
    : fenced(
        "css",
        entries
          .map(
            ([name, value]) => `${sanitizeCssText(name)}: ${sanitizeCssText(value)};`,
          )
          .join("\n"),
      );
}

function renderPrompt(annotation: SpotAnnotation, draft: PromptDraft): string {
  const pageUrl = sanitizeUrl(annotation.page.url, annotation.page.url);
  const component = annotation.react.componentName;
  const reactLines = [
    `- Adapter: ${annotation.react.supported ? "supported" : "unsupported"}`,
    ...(annotation.react.version === undefined
      ? []
      : [`- React: ${redactSensitiveText(annotation.react.version)}`]),
    ...(component === undefined
      ? []
      : [`- Component: ${redactSensitiveText(component)}`]),
    ...(draft.reactStack.length === 0
      ? []
      : [`- Stack: ${draft.reactStack.map(redactSensitiveText).join(" > ")}`]),
  ];
  const code =
    annotation.code === undefined || draft.codeLines.length === 0
      ? "Unavailable"
      : `- Boundary: ${annotation.code.boundary}\n\n${fenced(
          annotation.code.language,
          redactSensitiveText(draft.codeLines.join("\n")),
        )}`;

  return [
    SECTION_TITLES[0],
    draft.note,
    SECTION_TITLES[1],
    `- URL: <${pageUrl}>\n- Pathname: ${redactSensitiveText(annotation.page.pathname)}\n- Title: ${draft.pageTitle.length === 0 ? "Unavailable" : draft.pageTitle}\n- Viewport: ${String(annotation.page.viewportWidth)} × ${String(annotation.page.viewportHeight)}\n- Device pixel ratio: ${String(annotation.page.devicePixelRatio)}`,
    SECTION_TITLES[2],
    reactLines.join("\n"),
    SECTION_TITLES[3],
    `- File: ${sourceLocation(annotation)}\n- Origin: ${annotation.source.origin}\n- Confidence: ${annotation.source.confidence}`,
    SECTION_TITLES[4],
    fenced("html", redactSensitiveText(draft.dom)),
    SECTION_TITLES[5],
    renderStyles(annotation, draft.matchedRules),
    SECTION_TITLES[6],
    renderComputed(draft.computedEntries),
    SECTION_TITLES[7],
    code,
    SECTION_TITLES[8],
    draft.warnings.length === 0
      ? "- None"
      : draft.warnings.map((warning) => `- ${redactSensitiveText(warning)}`).join("\n"),
    SECTION_TITLES[9],
    MODIFICATION_CONSTRAINT,
  ].join("\n\n");
}

function shrinkCode(annotation: SpotAnnotation, draft: PromptDraft): boolean {
  if (draft.codeLines.length === 0 || annotation.code === undefined) {
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

  const selectedLine = annotation.source.line ?? annotation.code.startLine;
  const firstDistance = Math.abs(annotation.code.startLine - selectedLine);
  const lastLine = annotation.code.startLine + draft.codeLines.length - 1;
  const lastDistance = Math.abs(lastLine - selectedLine);

  if (lastDistance >= firstDistance) {
    draft.codeLines.pop();
  } else {
    draft.codeLines.shift();
  }

  return true;
}

function createDraft(annotation: SpotAnnotation): PromptDraft {
  return {
    note: redactSensitiveText(annotation.note.trim()),
    pageTitle: redactSensitiveText(annotation.page.title),
    reactStack: [...annotation.react.componentStack],
    dom: annotation.element.sanitizedHtml,
    matchedRules: [...annotation.styles.matchedRules],
    computedEntries: Object.entries(annotation.styles.computed),
    codeLines: annotation.code?.excerpt.split(/\r?\n/u) ?? [],
    warnings: Array.from(
      new Set([...annotation.styles.warnings, ...annotation.warnings]),
    ),
  };
}

function composeBounded(annotation: SpotAnnotation, maxCharacters: number): string {
  const draft = createDraft(annotation);
  const selectedOpeningTag = openingTag(draft.dom);
  let prompt = renderPrompt(annotation, draft);

  while (prompt.length > maxCharacters) {
    if (draft.computedEntries.length > 0) {
      draft.computedEntries.pop();
    } else if (draft.reactStack.length > 0) {
      draft.reactStack.pop();
    } else if (draft.dom !== selectedOpeningTag) {
      draft.dom = selectedOpeningTag;
    } else if (draft.matchedRules.length > 0) {
      draft.matchedRules.shift();
    } else if (shrinkCode(annotation, draft)) {
      // The code shrinker preserves the line nearest to the selected source.
    } else if (draft.warnings.length > 1) {
      draft.warnings.pop();
    } else if (draft.pageTitle.length > 0) {
      draft.pageTitle = "";
    } else if (draft.note.length > 80) {
      const excess = prompt.length - maxCharacters;
      draft.note = `${draft.note.slice(0, Math.max(79, draft.note.length - excess - 1))}…`;
    } else {
      break;
    }

    prompt = renderPrompt(annotation, draft);
  }

  return prompt;
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
