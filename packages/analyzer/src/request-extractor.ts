import {
  DATA_FLOW_TRPC_ROOT_FACTORY_NAMES,
  DATA_FLOW_URL_QUERY_KEY_LIMIT,
  isSensitiveName,
  type DataParameter,
  type SanitizedObservedUrl,
} from "@spotpatch/shared";
import ts from "typescript";

import { propertyNameText, resolveAliasedSymbol } from "./typescript-utils.js";

const AXIOS_METHODS = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
]);

export interface RequestVariant {
  readonly method: string;
  readonly direction: "read" | "write" | "read-write" | "unknown";
  readonly operation?: string;
  readonly url?: SanitizedObservedUrl;
  readonly condition?: string;
}

export interface ExtractedRequest {
  readonly adapterId: "axios-create" | "fetch" | "trpc";
  readonly kind: "http" | "rpc";
  readonly variants: readonly RequestVariant[];
  readonly variantsTruncated: boolean;
  readonly parameters: readonly DataParameter[];
}

interface ExtractRequestOptions {
  readonly checker: ts.TypeChecker;
  readonly maximumVariants: number;
  readonly sourceFile: ts.SourceFile;
}

interface StringVariant {
  readonly value: string;
  readonly condition?: string;
}

interface StringVariantsResult {
  readonly variants: readonly StringVariant[];
  readonly truncated: boolean;
}

function moduleSpecifierForDeclaration(
  declaration: ts.Declaration,
): string | undefined {
  let current: ts.Node = declaration;

  while (!ts.isSourceFile(current)) {
    if (
      ts.isImportDeclaration(current) &&
      ts.isStringLiteral(current.moduleSpecifier)
    ) {
      return current.moduleSpecifier.text;
    }
    current = current.parent;
  }

  return undefined;
}

function symbolComesFromModule(
  checker: ts.TypeChecker,
  node: ts.Node,
  moduleName: string,
): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return false;
  const resolved = resolveAliasedSymbol(checker, symbol);
  return (
    symbol.declarations?.some(
      (declaration) => moduleSpecifierForDeclaration(declaration) === moduleName,
    ) === true ||
    resolved.declarations?.some((declaration) =>
      declaration.getSourceFile().fileName.includes(`/node_modules/${moduleName}/`),
    ) === true
  );
}

function symbolComesFromModulePrefix(
  checker: ts.TypeChecker,
  node: ts.Node,
  modulePrefix: string,
): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return false;
  const resolved = resolveAliasedSymbol(checker, symbol);
  return (
    symbol.declarations?.some((declaration) =>
      moduleSpecifierForDeclaration(declaration)?.startsWith(modulePrefix),
    ) === true ||
    resolved.declarations?.some((declaration) =>
      declaration.getSourceFile().fileName.includes(`/node_modules/${modulePrefix}`),
    ) === true
  );
}

function containsAxiosCreate(
  checker: ts.TypeChecker,
  declaration: ts.Declaration,
  visited = new Set<ts.Declaration>(),
): boolean {
  if (visited.has(declaration)) return false;
  visited.add(declaration);
  let found = false;

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "create" &&
      symbolComesFromModule(checker, node.expression.expression, "axios")
    ) {
      found = true;
      return;
    }

    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol !== undefined) {
        const resolved = resolveAliasedSymbol(checker, symbol);
        if (
          resolved.declarations?.some((candidate) =>
            containsAxiosCreate(checker, candidate, visited),
          ) === true
        ) {
          found = true;
          return;
        }
      }
    }
    if (!found) ts.forEachChild(node, visit);
  }

  visit(declaration);
  return found;
}

function isAxiosReceiver(checker: ts.TypeChecker, receiver: ts.Expression): boolean {
  if (symbolComesFromModule(checker, receiver, "axios")) return true;
  const symbol = checker.getSymbolAtLocation(receiver);
  if (symbol === undefined) return false;
  const resolved = resolveAliasedSymbol(checker, symbol);
  return (
    resolved.declarations?.some((declaration) =>
      containsAxiosCreate(checker, declaration),
    ) === true
  );
}

function isGlobalFetch(checker: ts.TypeChecker, expression: ts.Expression): boolean {
  const candidate = (() => {
    if (ts.isIdentifier(expression) && expression.text === "fetch") return expression;
    if (
      ts.isPropertyAccessExpression(expression) &&
      expression.name.text === "fetch" &&
      ts.isIdentifier(expression.expression) &&
      (expression.expression.text === "globalThis" ||
        expression.expression.text === "self" ||
        expression.expression.text === "window")
    ) {
      return expression.name;
    }
    return undefined;
  })();
  if (candidate === undefined) return false;
  const symbol = checker.getSymbolAtLocation(candidate);
  if (symbol === undefined) return true;
  return (
    symbol.declarations?.every((declaration) => {
      const fileName = declaration.getSourceFile().fileName;
      return fileName.includes("/typescript/lib/lib.") || fileName.includes("@types/");
    }) === true
  );
}

const TRPC_FACTORY_NAMES = new Set<string>(DATA_FLOW_TRPC_ROOT_FACTORY_NAMES);
const TRPC_TERMINALS = new Map<
  string,
  Readonly<{
    direction: RequestVariant["direction"];
    method: string;
    takesInput: boolean;
  }>
>([
  ["infiniteQueryOptions", { direction: "read", method: "QUERY", takesInput: true }],
  ["mutationOptions", { direction: "write", method: "MUTATION", takesInput: false }],
  ["query", { direction: "read", method: "QUERY", takesInput: true }],
  ["queryOptions", { direction: "read", method: "QUERY", takesInput: true }],
  ["subscribe", { direction: "read", method: "SUBSCRIPTION", takesInput: true }],
  [
    "subscriptionOptions",
    { direction: "read", method: "SUBSCRIPTION", takesInput: true },
  ],
  ["useInfiniteQuery", { direction: "read", method: "QUERY", takesInput: true }],
  ["useMutation", { direction: "write", method: "MUTATION", takesInput: false }],
  ["useQuery", { direction: "read", method: "QUERY", takesInput: true }],
  ["useSubscription", { direction: "read", method: "SUBSCRIPTION", takesInput: true }],
  [
    "useSuspenseInfiniteQuery",
    { direction: "read", method: "QUERY", takesInput: true },
  ],
  ["useSuspenseQuery", { direction: "read", method: "QUERY", takesInput: true }],
]);

interface TrpcProcedure {
  readonly direction: RequestVariant["direction"];
  readonly input?: ts.Expression;
  readonly method: string;
  readonly operation: string;
}

function containsTrpcFactory(
  checker: ts.TypeChecker,
  declaration: ts.Declaration,
  visited = new Set<ts.Declaration>(),
): boolean {
  if (visited.has(declaration)) return false;
  visited.add(declaration);
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const calleeName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : undefined;
      if (
        calleeName !== undefined &&
        TRPC_FACTORY_NAMES.has(calleeName) &&
        symbolComesFromModulePrefix(checker, node.expression, "@trpc/")
      ) {
        found = true;
        return;
      }
    }

    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const resolved =
        symbol === undefined ? undefined : resolveAliasedSymbol(checker, symbol);
      if (
        resolved?.declarations?.some((candidate) =>
          containsTrpcFactory(checker, candidate, visited),
        ) === true
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(declaration);
  return found;
}

function isTrpcClientRoot(checker: ts.TypeChecker, expression: ts.Expression): boolean {
  if (symbolComesFromModulePrefix(checker, expression, "@trpc/")) return true;
  const symbol = checker.getSymbolAtLocation(expression);
  if (symbol === undefined) return false;
  const resolved = resolveAliasedSymbol(checker, symbol);
  return (
    resolved.declarations?.some((declaration) =>
      containsTrpcFactory(checker, declaration),
    ) === true
  );
}

function propertyChain(
  expression: ts.Expression,
): Readonly<{ root: ts.Expression; segments: readonly string[] }> {
  const segments: string[] = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) {
    segments.unshift(current.name.text);
    current = current.expression;
  }
  return Object.freeze({ root: current, segments: Object.freeze(segments) });
}

function directTrpcProcedure(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): TrpcProcedure | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const chain = propertyChain(call.expression);
  const terminal = chain.segments.at(-1);
  const descriptor = terminal === undefined ? undefined : TRPC_TERMINALS.get(terminal);
  const procedureSegments = chain.segments.slice(0, -1);
  if (
    descriptor === undefined ||
    procedureSegments.length === 0 ||
    !isTrpcClientRoot(checker, chain.root)
  ) {
    return undefined;
  }
  const operation = procedureSegments.join(".");
  if (operation.length === 0 || operation.length > 512) return undefined;
  return Object.freeze({
    direction: descriptor.direction,
    method: descriptor.method,
    operation,
    ...(descriptor.takesInput && call.arguments[0] !== undefined
      ? { input: call.arguments[0] }
      : {}),
  });
}

function callInsideExpression(
  expression: ts.Expression,
  predicate: (call: ts.CallExpression) => boolean,
): ts.CallExpression | undefined {
  let match: ts.CallExpression | undefined;
  function visit(node: ts.Node): void {
    if (match !== undefined) return;
    if (ts.isCallExpression(node) && predicate(node)) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(expression);
  return match;
}

function trpcProcedureFromBoundResult(
  checker: ts.TypeChecker,
  receiver: ts.Expression,
): TrpcProcedure | undefined {
  if (!ts.isIdentifier(receiver)) return undefined;
  const declaration = findVariableDeclaration(checker, receiver);
  if (declaration?.initializer === undefined) return undefined;
  const nested = callInsideExpression(
    declaration.initializer,
    (candidate) => directTrpcProcedure(checker, candidate) !== undefined,
  );
  return nested === undefined ? undefined : directTrpcProcedure(checker, nested);
}

function extractTrpcProcedure(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): TrpcProcedure | undefined {
  const direct = directTrpcProcedure(checker, call);
  if (direct !== undefined) return direct;
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const terminal = call.expression.name.text;
  if (terminal !== "mutate" && terminal !== "mutateAsync" && terminal !== "refetch") {
    return undefined;
  }
  const bound = trpcProcedureFromBoundResult(checker, call.expression.expression);
  if (bound === undefined) return undefined;
  return Object.freeze({
    ...bound,
    ...(terminal === "mutate" || terminal === "mutateAsync"
      ? {
          direction: "write" as const,
          method: "MUTATION",
          ...(call.arguments[0] === undefined ? {} : { input: call.arguments[0] }),
        }
      : {}),
  });
}

function expressionLabel(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  const value = expression.getText(sourceFile).replaceAll(/\s+/gu, " ").trim();
  return value.length <= 80 ? value : `${value.slice(0, 79)}…`;
}

function stringVariants(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  maximumVariants: number,
  checker?: ts.TypeChecker,
): StringVariantsResult {
  if (maximumVariants <= 0) {
    return Object.freeze({ variants: Object.freeze([]), truncated: true });
  }

  if (checker !== undefined && ts.isIdentifier(expression)) {
    const declaration = findVariableDeclaration(checker, expression);
    if (
      declaration !== undefined &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
      declaration.initializer !== undefined &&
      ts.isStringLiteralLike(declaration.initializer)
    ) {
      return Object.freeze({
        variants: Object.freeze([
          Object.freeze({ value: declaration.initializer.text }),
        ]),
        truncated: false,
      });
    }
  }

  if (ts.isStringLiteralLike(expression)) {
    return Object.freeze({
      variants: Object.freeze([Object.freeze({ value: expression.text })]),
      truncated: false,
    });
  }

  if (ts.isNoSubstitutionTemplateLiteral(expression)) {
    return Object.freeze({
      variants: Object.freeze([Object.freeze({ value: expression.text })]),
      truncated: false,
    });
  }

  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      value += `{${expressionLabel(span.expression, sourceFile)}}${span.literal.text}`;
    }
    return Object.freeze({
      variants: Object.freeze([Object.freeze({ value })]),
      truncated: false,
    });
  }

  if (ts.isConditionalExpression(expression)) {
    const condition = expressionLabel(expression.condition, sourceFile);
    const whenTrue = stringVariants(
      expression.whenTrue,
      sourceFile,
      maximumVariants,
      checker,
    );
    const remaining = maximumVariants - whenTrue.variants.length;
    const whenFalse =
      remaining > 0
        ? stringVariants(expression.whenFalse, sourceFile, remaining, checker)
        : Object.freeze({ variants: Object.freeze([]), truncated: true });
    const combineCondition = (
      branchCondition: string,
      nestedCondition: string | undefined,
    ): string =>
      nestedCondition === undefined
        ? branchCondition
        : `${branchCondition} && ${nestedCondition}`;
    return Object.freeze({
      variants: Object.freeze([
        ...whenTrue.variants.map((variant) =>
          Object.freeze({
            ...variant,
            condition: combineCondition(condition, variant.condition),
          }),
        ),
        ...whenFalse.variants.map((variant) =>
          Object.freeze({
            ...variant,
            condition: combineCondition(`!(${condition})`, variant.condition),
          }),
        ),
      ]),
      truncated: whenTrue.truncated || whenFalse.truncated,
    });
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = stringVariants(expression.left, sourceFile, maximumVariants, checker);
    const right = stringVariants(
      expression.right,
      sourceFile,
      maximumVariants,
      checker,
    );
    if (left.variants.length > 0 && right.variants.length > 0) {
      const variants: StringVariant[] = [];
      for (const leftVariant of left.variants) {
        for (const rightVariant of right.variants) {
          if (variants.length >= maximumVariants) break;
          variants.push(
            Object.freeze({
              value: leftVariant.value + rightVariant.value,
              ...(leftVariant.condition === undefined &&
              rightVariant.condition === undefined
                ? {}
                : {
                    condition: [leftVariant.condition, rightVariant.condition]
                      .filter((value) => value !== undefined)
                      .join(" && "),
                  }),
            }),
          );
        }
        if (variants.length >= maximumVariants) break;
      }
      return Object.freeze({
        variants: Object.freeze(variants),
        truncated:
          left.truncated ||
          right.truncated ||
          left.variants.length * right.variants.length > maximumVariants,
      });
    }
  }

  return Object.freeze({
    variants: Object.freeze([
      Object.freeze({ value: `{${expressionLabel(expression, sourceFile)}}` }),
    ]),
    truncated: false,
  });
}

function describeUrl(value: string): SanitizedObservedUrl {
  try {
    const parsed = new URL(value, "https://spotpatch.invalid");
    return Object.freeze({
      ...(parsed.origin === "https://spotpatch.invalid"
        ? {}
        : { origin: parsed.origin }),
      pathname: parsed.pathname,
      queryKeys: Object.freeze(
        [...new Set(parsed.searchParams.keys())]
          .sort()
          .slice(0, DATA_FLOW_URL_QUERY_KEY_LIMIT),
      ),
    });
  } catch {
    return Object.freeze({
      pathname: value.split(/[?#]/u, 1)[0] ?? "{unknown}",
      queryKeys: Object.freeze([]),
    });
  }
}

function findVariableDeclaration(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
): ts.VariableDeclaration | undefined {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) return undefined;
  return resolveAliasedSymbol(checker, symbol).declarations?.find(
    ts.isVariableDeclaration,
  );
}

function collectAssignedObjectKeys(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
): readonly string[] {
  const declaration = findVariableDeclaration(checker, identifier);
  if (declaration === undefined) return [];
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) return [];
  const keys = new Set<string>();

  if (
    declaration.initializer !== undefined &&
    ts.isObjectLiteralExpression(declaration.initializer)
  ) {
    for (const property of declaration.initializer.properties) {
      if (
        ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property) ||
        ts.isMethodDeclaration(property)
      ) {
        const name = propertyNameText(property.name);
        if (name !== undefined) keys.add(name);
      }
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)
    ) {
      const receiverSymbol = checker.getSymbolAtLocation(node.left.expression);
      if (receiverSymbol === symbol) keys.add(node.left.name.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(declaration.getSourceFile());
  return Object.freeze([...keys].sort());
}

function parameter(
  path: string,
  position: DataParameter["position"],
  source: string,
): DataParameter {
  return Object.freeze({
    path,
    position,
    source,
    sensitive: isSensitiveName(path),
    valueState: "not-collected",
    evidenceIds: Object.freeze([]),
  });
}

function parametersFromExpression(
  checker: ts.TypeChecker,
  expression: ts.Expression | undefined,
  position: DataParameter["position"],
): readonly DataParameter[] {
  if (expression === undefined) return [];

  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "JSON" &&
    expression.expression.name.text === "stringify"
  ) {
    return parametersFromExpression(checker, expression.arguments[0], position);
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return Object.freeze(
      expression.properties.flatMap((property) => {
        if (
          !ts.isPropertyAssignment(property) &&
          !ts.isShorthandPropertyAssignment(property) &&
          !ts.isMethodDeclaration(property)
        ) {
          return [];
        }
        const name = propertyNameText(property.name);
        return name === undefined ? [] : [parameter(name, position, "object-field")];
      }),
    );
  }

  if (ts.isIdentifier(expression)) {
    const keys = collectAssignedObjectKeys(checker, expression);
    return keys.length === 0
      ? [parameter(position, position, "identifier")]
      : keys.map((key) => parameter(key, position, "object-field"));
  }

  return [parameter(position, position, "expression")];
}

function parametersFromAxiosConfig(
  checker: ts.TypeChecker,
  config: ts.Expression | undefined,
): readonly DataParameter[] {
  if (config === undefined || !ts.isObjectLiteralExpression(config)) return [];
  const parameters: DataParameter[] = [];
  for (const property of config.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(property.name);
    if (name === "params") {
      parameters.push(
        ...parametersFromExpression(checker, property.initializer, "query"),
      );
    } else if (name === "headers") {
      parameters.push(
        ...parametersFromExpression(checker, property.initializer, "header"),
      );
    }
  }
  return Object.freeze(parameters);
}

function fetchMethodAndParameters(
  checker: ts.TypeChecker,
  config: ts.Expression | undefined,
): Readonly<{ method: string; parameters: readonly DataParameter[] }> {
  if (config === undefined || !ts.isObjectLiteralExpression(config)) {
    return Object.freeze({ method: "GET", parameters: Object.freeze([]) });
  }

  let method = "GET";
  const parameters: DataParameter[] = [];
  for (const property of config.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(property.name);
    if (name === "method" && ts.isStringLiteralLike(property.initializer)) {
      method = property.initializer.text.toUpperCase();
    }
    if (name === "body") {
      parameters.push(
        ...parametersFromExpression(checker, property.initializer, "body"),
      );
    }
    if (name === "headers") {
      parameters.push(
        ...parametersFromExpression(checker, property.initializer, "header"),
      );
    }
  }
  return Object.freeze({ method, parameters: Object.freeze(parameters) });
}

export function extractRequest(
  call: ts.CallExpression,
  options: ExtractRequestOptions,
): ExtractedRequest | undefined {
  const { checker, sourceFile } = options;

  const trpc = extractTrpcProcedure(checker, call);
  if (trpc !== undefined) {
    return Object.freeze({
      adapterId: "trpc",
      kind: "rpc",
      variants: Object.freeze([
        Object.freeze({
          direction: trpc.direction,
          method: trpc.method,
          operation: trpc.operation,
        }),
      ]),
      variantsTruncated: false,
      parameters: parametersFromExpression(checker, trpc.input, "variable"),
    });
  }

  if (isGlobalFetch(checker, call.expression)) {
    const urlExpression = call.arguments[0];
    if (urlExpression === undefined) return undefined;
    const config = fetchMethodAndParameters(checker, call.arguments[1]);
    const variants = stringVariants(
      urlExpression,
      sourceFile,
      options.maximumVariants,
      checker,
    );
    return Object.freeze({
      adapterId: "fetch",
      kind: "http",
      variants: Object.freeze(
        variants.variants.map((variant) =>
          Object.freeze({
            direction:
              config.method === "GET" || config.method === "HEAD"
                ? ("read" as const)
                : ("write" as const),
            method: config.method,
            url: describeUrl(variant.value),
            ...(variant.condition === undefined
              ? {}
              : { condition: variant.condition }),
          }),
        ),
      ),
      variantsTruncated: variants.truncated,
      parameters: config.parameters,
    });
  }

  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const method = call.expression.name.text.toLowerCase();
  if (
    !AXIOS_METHODS.has(method) ||
    !isAxiosReceiver(checker, call.expression.expression)
  ) {
    return undefined;
  }
  const urlExpression = call.arguments[0];
  if (urlExpression === undefined) return undefined;
  const readMethod = method === "get" || method === "delete" || method === "head";
  const parameters = readMethod
    ? parametersFromAxiosConfig(checker, call.arguments[1])
    : [
        ...parametersFromExpression(checker, call.arguments[1], "body"),
        ...parametersFromAxiosConfig(checker, call.arguments[2]),
      ];

  const variants = stringVariants(
    urlExpression,
    sourceFile,
    options.maximumVariants,
    checker,
  );
  return Object.freeze({
    adapterId: "axios-create",
    kind: "http",
    variants: Object.freeze(
      variants.variants.map((variant) =>
        Object.freeze({
          direction: readMethod ? ("read" as const) : ("write" as const),
          method: method.toUpperCase(),
          url: describeUrl(variant.value),
          ...(variant.condition === undefined ? {} : { condition: variant.condition }),
        }),
      ),
    ),
    variantsTruncated: variants.truncated,
    parameters: Object.freeze(parameters),
  });
}
