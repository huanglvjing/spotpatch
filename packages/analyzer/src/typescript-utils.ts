import { statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

export type FunctionImplementation =
  | ts.ArrowFunction
  | ts.ConstructorDeclaration
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration;

export function isFunctionImplementation(
  node: ts.Node,
): node is FunctionImplementation {
  return (
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

export function functionName(node: FunctionImplementation): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.name === undefined ? undefined : propertyNameText(node.name);
  }

  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }

  if (ts.isPropertyAssignment(parent)) {
    return propertyNameText(parent.name);
  }

  return undefined;
}

export function propertyNameText(
  name: ts.PropertyName | ts.BindingName,
): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

export function resolveAliasedSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
): ts.Symbol {
  let current = symbol;
  const visited = new Set<ts.Symbol>();

  while ((current.flags & ts.SymbolFlags.Alias) !== 0 && !visited.has(current)) {
    visited.add(current);
    const resolved = checker.getAliasedSymbol(current);
    if (resolved === current) break;
    current = resolved;
  }

  return current;
}

export function isInsideRoot(root: string, absolutePath: string): boolean {
  const relative = path.relative(root, absolutePath);
  if (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  ) {
    return true;
  }

  const resolvedRoot = path.resolve(root);
  let ancestor = path.dirname(path.resolve(absolutePath));
  const filesystemRoot = path.parse(ancestor).root;
  while (ancestor !== filesystemRoot) {
    if (isSameFilePath(resolvedRoot, ancestor)) return true;
    ancestor = path.dirname(ancestor);
  }
  return isSameFilePath(resolvedRoot, filesystemRoot);
}

export function isSameFilePath(first: string, second: string): boolean {
  const resolvedFirst = path.resolve(first);
  const resolvedSecond = path.resolve(second);
  if (path.relative(resolvedFirst, resolvedSecond).length === 0) return true;

  // Windows can expose one directory through both an 8.3 alias and its long name.
  // Device/inode identity keeps containment correct when lexical paths diverge.
  try {
    const firstStat = statSync(resolvedFirst, { bigint: true });
    const secondStat = statSync(resolvedSecond, { bigint: true });
    return (
      firstStat.ino !== 0n &&
      firstStat.dev === secondStat.dev &&
      firstStat.ino === secondStat.ino
    );
  } catch {
    return false;
  }
}

export function toDisplayPath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

export function visitFunctionBody(
  implementation: FunctionImplementation,
  callback: (node: ts.Node) => void,
): void {
  const body = implementation.body;
  if (body === undefined) return;

  function visit(node: ts.Node): void {
    if (node !== body && isFunctionImplementation(node)) return;
    callback(node);
    ts.forEachChild(node, visit);
  }

  visit(body);
}
