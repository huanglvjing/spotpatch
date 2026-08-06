export interface ContextBudget {
  readonly totalCharacters: number;
  readonly domCharacters: number;
  readonly cssCharacters: number;
  readonly codeCharacters: number;
  readonly maxCodeLines: number;
  readonly maxComponentDepth: number;
}

export interface CodeContext {
  readonly relativePath: string;
  readonly language: "tsx" | "jsx";
  readonly startLine: number;
  readonly endLine: number;
  readonly excerpt: string;
  readonly boundary: "component" | "nearby-lines";
}
