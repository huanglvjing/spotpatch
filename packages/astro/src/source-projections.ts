import { parse } from "@astrojs/compiler-rs";

export interface AstroSourceScope {
  readonly code: string;
  readonly environment: "server" | "client";
  readonly start: number;
  readonly end: number;
  readonly instrument: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function astroSourceImports(
  absolutePath: string,
  code: string,
): readonly string[] | undefined {
  if (!absolutePath.endsWith(".astro")) return undefined;
  const parsed = parse(code);
  if (parsed.diagnostics.some((entry) => entry.severity === "error")) return [];
  const imports = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.startsWith(".")) imports.add(value);
  };
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
        "ImportExpression",
      ].includes(String(value.type)) &&
      isRecord(value.source)
    )
      add(value.source.value);
    if (
      value.type === "JSXOpeningElement" &&
      isRecord(value.name) &&
      value.name.name === "script" &&
      Array.isArray(value.attributes)
    ) {
      for (const attribute of value.attributes) {
        if (
          isRecord(attribute) &&
          isRecord(attribute.name) &&
          attribute.name.name === "src" &&
          isRecord(attribute.value)
        )
          add(attribute.value.value);
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(parsed.ast);
  return Object.freeze([...imports].sort());
}

/** Uses compiler ranges, never a delimiter scanner, and never combines JS scopes. */
export function projectAstroSource(
  absolutePath: string,
  code: string,
): readonly AstroSourceScope[] | undefined {
  if (!absolutePath.endsWith(".astro")) return undefined;
  const parsed = parse(code);
  if (parsed.diagnostics.some((entry) => entry.severity === "error"))
    throw new SyntaxError("Astro data-flow source parsing failed.");
  const blank = code.replace(/[^\r\n]/gu, (character) => " ".repeat(character.length));
  const expressions: {
    readonly start: number;
    readonly end: number;
    readonly expressionStart: number;
    readonly expressionEnd: number;
  }[] = [];
  const scopes: AstroSourceScope[] = [];
  let serverCode = blank;
  let frontmatterEnd = 0;

  function range(node: Record<string, unknown>): readonly [number, number] {
    const { start, end } = node;
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > code.length
    )
      throw new SyntaxError("Astro data-flow source position could not be verified.");
    return [start, end];
  }
  function includeServer(start: number, end: number): void {
    serverCode =
      serverCode.slice(0, start) + code.slice(start, end) + serverCode.slice(end);
  }
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (value.type === "AstroFrontmatter" && isRecord(value.program)) {
      const [start, end] = range(value.program);
      includeServer(start, end);
      frontmatterEnd = end;
      return;
    }
    if (
      value.type === "JSXElement" &&
      isRecord(value.openingElement) &&
      isRecord(value.openingElement.name)
    ) {
      const name = value.openingElement.name.name;
      if (name === "style") return;
      if (name === "script") {
        const children: unknown[] = Array.isArray(value.children) ? value.children : [];
        const script = children.find(
          (child) => isRecord(child) && child.type === "AstroScript",
        );
        if (!isRecord(script) || !isRecord(script.program)) return;
        const [start, end] = range(script.program);
        const attributes = value.openingElement.attributes;
        scopes.push(
          Object.freeze({
            get code() {
              return blank.slice(0, start) + code.slice(start, end) + blank.slice(end);
            },
            start,
            end,
            environment: "client",
            instrument: Array.isArray(attributes) && attributes.length === 0,
          }),
        );
        return;
      }
    }
    if (
      value.type === "JSXExpressionContainer" &&
      isRecord(value.expression) &&
      value.expression.type !== "JSXEmptyExpression"
    ) {
      const [start, end] = range(value);
      const [expressionStart, expressionEnd] = range(value.expression);
      if (code[start] !== "{" || code[end - 1] !== "}")
        throw new SyntaxError("Astro expression boundary could not be verified.");
      expressions.push({ start, end, expressionStart, expressionEnd });
      return;
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(parsed.ast);
  // Adjacent {a}{b} must not become (a)(b), which would invent a function call.
  // Use independent projections sharing frontmatter whenever no masked separator
  // slot exists. Their common frontmatter evidence is deduplicated by anchor ID.
  const groups: (typeof expressions)[] = [[]];
  let previousEnd = frontmatterEnd;
  for (const expression of expressions.sort(
    (left, right) => left.start - right.start,
  )) {
    const group = groups.at(-1);
    if (group === undefined) throw new Error("Astro projection group is unavailable.");
    const separator = blank.indexOf(" ", previousEnd);
    if (group.length > 0 && (separator < 0 || separator >= expression.start))
      groups.push([expression]);
    else group.push(expression);
    previousEnd = expression.end;
  }
  const serverScopes = groups.map((group): AstroSourceScope =>
    Object.freeze({
      get code() {
        let projected = serverCode;
        let previous = frontmatterEnd;
        for (const expression of group) {
          const { start, end, expressionStart, expressionEnd } = expression;
          const separator = projected.indexOf(" ", previous);
          if (separator >= 0 && separator < start)
            projected =
              projected.slice(0, separator) + ";" + projected.slice(separator + 1);
          projected =
            projected.slice(0, start) +
            "(" +
            blank.slice(start + 1, expressionStart) +
            code.slice(expressionStart, expressionEnd) +
            blank.slice(expressionEnd, end - 1) +
            ")" +
            projected.slice(end);
          previous = end;
        }
        return projected;
      },
      environment: "server",
      start: 0,
      end: code.length,
      instrument: false,
    }),
  );
  return Object.freeze([...serverScopes, ...scopes]);
}
