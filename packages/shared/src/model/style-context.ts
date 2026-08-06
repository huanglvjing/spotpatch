export interface MatchedStyleRule {
  readonly selector: string;
  readonly declarations: string;
  readonly source?: string;
  readonly media?: string;
}

export interface StyleContext {
  readonly classNames: readonly string[];
  readonly inlineStyle?: string;
  readonly matchedRules: readonly MatchedStyleRule[];
  readonly computed: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}
