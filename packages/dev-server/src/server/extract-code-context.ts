import type { CodeContext } from "@spotpatch/shared";
import {
  parseSync,
  Visitor,
  type Class,
  type Expression,
  type Function,
  type JSXElement,
  type JSXFragment,
  type Span,
  type VariableDeclarator,
} from "oxc-parser";

interface ComponentCandidate extends Span {
  readonly name: string;
}

export interface ExtractCodeContextOptions {
  readonly column: number;
  readonly language: CodeContext["language"];
  readonly line: number;
  readonly maxCharacters: number;
  readonly maxLines: number;
  readonly relativePath: string;
  readonly source: string;
  readonly sourcePath: string;
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/u.test(name);
}

function unwrapTypeExpression(expression: Expression): Expression {
  switch (expression.type) {
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
    case "TSNonNullExpression":
    case "TSInstantiationExpression":
      return unwrapTypeExpression(expression.expression);
    default:
      return expression;
  }
}

function calleeName(expression: Expression): string | undefined {
  const unwrapped = unwrapTypeExpression(expression);

  if (unwrapped.type === "Identifier") {
    return unwrapped.name;
  }

  if (unwrapped.type === "MemberExpression" && !unwrapped.computed) {
    return unwrapped.property.type === "Identifier"
      ? unwrapped.property.name
      : undefined;
  }

  return undefined;
}

function isFunctionExpression(expression: Expression): boolean {
  const unwrapped = unwrapTypeExpression(expression);
  return (
    unwrapped.type === "ArrowFunctionExpression" ||
    unwrapped.type === "FunctionExpression"
  );
}

function isSupportedComponentInitializer(expression: Expression): boolean {
  const unwrapped = unwrapTypeExpression(expression);

  if (isFunctionExpression(unwrapped)) {
    return true;
  }

  if (unwrapped.type !== "CallExpression") {
    return false;
  }

  const name = calleeName(unwrapped.callee);

  if (name !== "memo" && name !== "forwardRef") {
    return false;
  }

  const firstArgument = unwrapped.arguments[0];
  return (
    firstArgument !== undefined &&
    firstArgument.type !== "SpreadElement" &&
    (isFunctionExpression(firstArgument) ||
      isSupportedComponentInitializer(firstArgument))
  );
}

function variableComponent(node: VariableDeclarator): ComponentCandidate | undefined {
  if (
    node.id.type !== "Identifier" ||
    !isComponentName(node.id.name) ||
    node.init === null ||
    !isSupportedComponentInitializer(node.init)
  ) {
    return undefined;
  }

  return Object.freeze({ start: node.start, end: node.end, name: node.id.name });
}

function functionComponent(node: Function): ComponentCandidate | undefined {
  return node.id !== null && isComponentName(node.id.name) && node.body !== null
    ? Object.freeze({ start: node.start, end: node.end, name: node.id.name })
    : undefined;
}

function isReactComponentSuperclass(expression: Expression | null): boolean {
  if (expression === null) {
    return false;
  }

  const unwrapped = unwrapTypeExpression(expression);

  if (unwrapped.type === "Identifier") {
    return unwrapped.name === "Component" || unwrapped.name === "PureComponent";
  }

  return (
    unwrapped.type === "MemberExpression" &&
    !unwrapped.computed &&
    unwrapped.object.type === "Identifier" &&
    unwrapped.object.name === "React" &&
    (unwrapped.property.name === "Component" ||
      unwrapped.property.name === "PureComponent")
  );
}

function classComponent(node: Class): ComponentCandidate | undefined {
  return node.id !== null &&
    isComponentName(node.id.name) &&
    isReactComponentSuperclass(node.superClass)
    ? Object.freeze({ start: node.start, end: node.end, name: node.id.name })
    : undefined;
}

function selectedOffset(
  source: string,
  line: number,
  column: number,
): number | undefined {
  const lines = source.split(/\r?\n/u);

  if (line < 1 || line > lines.length) {
    return undefined;
  }

  const lineStart = lines
    .slice(0, line - 1)
    .reduce((total, value) => total + value.length + 1, 0);
  const lineLength = lines[line - 1]?.length ?? 0;
  return lineStart + Math.min(Math.max(0, column - 1), lineLength);
}

function findComponentSpan(
  options: ExtractCodeContextOptions,
): ComponentCandidate | undefined {
  const offset = selectedOffset(options.source, options.line, options.column);

  if (offset === undefined) {
    return undefined;
  }

  let parseResult: ReturnType<typeof parseSync>;

  try {
    parseResult = parseSync(options.sourcePath, options.source, {
      sourceType: "module",
    });
  } catch {
    return undefined;
  }

  if (parseResult.errors.length > 0) {
    return undefined;
  }

  const jsxNodes: (JSXElement | JSXFragment)[] = [];
  const components: ComponentCandidate[] = [];
  const visitor = new Visitor({
    JSXElement(node) {
      jsxNodes.push(node);
    },
    JSXFragment(node) {
      jsxNodes.push(node);
    },
    FunctionDeclaration(node) {
      const candidate = functionComponent(node);

      if (candidate !== undefined) {
        components.push(candidate);
      }
    },
    VariableDeclarator(node) {
      const candidate = variableComponent(node);

      if (candidate !== undefined) {
        components.push(candidate);
      }
    },
    ClassDeclaration(node) {
      const candidate = classComponent(node);

      if (candidate !== undefined) {
        components.push(candidate);
      }
    },
  });
  visitor.visit(parseResult.program);

  const selectedJsx = jsxNodes
    .filter((node) => node.start <= offset && node.end >= offset)
    .sort((left, right) => left.end - left.start - (right.end - right.start))[0];

  if (selectedJsx === undefined) {
    return undefined;
  }

  return components
    .filter(
      (component) =>
        component.start <= selectedJsx.start && component.end >= selectedJsx.end,
    )
    .sort((left, right) => left.end - left.start - (right.end - right.start))[0];
}

function lineAtOffset(source: string, offset: number): number {
  let line = 1;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
    }
  }

  return line;
}

function componentRange(
  source: string,
  component: ComponentCandidate,
): Readonly<{ startLine: number; endLine: number }> {
  return Object.freeze({
    startLine: lineAtOffset(source, component.start),
    endLine: lineAtOffset(source, Math.max(component.start, component.end - 1)),
  });
}

function truncateSelectedLine(
  line: string,
  column: number,
  maxCharacters: number,
): string {
  if (line.length <= maxCharacters) {
    return line;
  }

  if (maxCharacters === 1) {
    return "…";
  }

  const contentCharacters = maxCharacters - 2;
  const desiredStart = Math.max(0, column - 1 - Math.floor(contentCharacters / 2));
  const start = Math.min(desiredStart, line.length - contentCharacters);
  const end = start + contentCharacters;
  return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`.slice(
    0,
    maxCharacters,
  );
}

function boundedRange(
  lines: readonly string[],
  selectedLine: number,
  column: number,
  initialStart: number,
  initialEnd: number,
  maxCharacters: number,
): Readonly<{ startLine: number; endLine: number; excerpt: string }> {
  let startLine = initialStart;
  let endLine = initialEnd;
  let excerpt = lines.slice(startLine - 1, endLine).join("\n");

  while (excerpt.length > maxCharacters && startLine < endLine) {
    if (endLine - selectedLine >= selectedLine - startLine) {
      endLine -= 1;
    } else {
      startLine += 1;
    }

    excerpt = lines.slice(startLine - 1, endLine).join("\n");
  }

  if (excerpt.length > maxCharacters) {
    startLine = selectedLine;
    endLine = selectedLine;
    excerpt = truncateSelectedLine(
      lines[selectedLine - 1] ?? "",
      column,
      maxCharacters,
    );
  }

  return Object.freeze({ startLine, endLine, excerpt });
}

function nearbyContext(options: ExtractCodeContextOptions): CodeContext {
  const lines = options.source.split(/\r?\n/u);
  const initialStart = Math.max(1, options.line - Math.floor(options.maxLines / 2));
  const initialEnd = Math.min(lines.length, initialStart + options.maxLines - 1);
  const startLine = Math.max(1, initialEnd - options.maxLines + 1);
  const bounded = boundedRange(
    lines,
    options.line,
    options.column,
    startLine,
    initialEnd,
    options.maxCharacters,
  );

  return Object.freeze({
    relativePath: options.relativePath,
    language: options.language,
    startLine: bounded.startLine,
    endLine: bounded.endLine,
    excerpt: bounded.excerpt,
    boundary: "nearby-lines",
  });
}

export function extractCodeContext(options: ExtractCodeContextOptions): CodeContext {
  if (options.language === "astro") return nearbyContext(options);
  const component = findComponentSpan(options);

  if (component !== undefined) {
    const range = componentRange(options.source, component);
    const lineCount = range.endLine - range.startLine + 1;
    const excerpt = options.source
      .split(/\r?\n/u)
      .slice(range.startLine - 1, range.endLine)
      .join("\n");

    if (lineCount <= options.maxLines && excerpt.length <= options.maxCharacters) {
      return Object.freeze({
        relativePath: options.relativePath,
        language: options.language,
        startLine: range.startLine,
        endLine: range.endLine,
        excerpt,
        boundary: "component",
      });
    }
  }

  return nearbyContext(options);
}
