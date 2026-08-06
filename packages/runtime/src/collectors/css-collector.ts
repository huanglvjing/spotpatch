import type { MatchedStyleRule, StyleContext } from "@spotpatch/shared";

import { sanitizeCssText, sanitizeUrl } from "../security/content-sanitizer.js";
import { COMPUTED_STYLE_PROPERTIES } from "./computed-style-properties.js";

export const CSS_COLLECTION_WARNINGS = Object.freeze({
  cascade: "CSS shorthand and longhand cascade resolution is not available in v1.",
  cssInJs:
    "Runtime CSS-in-JS rules may not include original TypeScript source locations.",
  inaccessibleStylesheet:
    "A stylesheet could not be inspected because browser security denied access.",
  selector: "A stylesheet selector could not be evaluated and was skipped.",
  state:
    "Dynamic pseudo-class and pseudo-element rules may be unavailable in the current state.",
});

interface StyleRuleLike extends CSSRule {
  readonly selectorText: string;
  readonly style: CSSStyleDeclaration;
}

interface GroupingRuleLike extends CSSRule {
  readonly conditionText?: string;
  readonly cssRules: CSSRuleList;
}

export interface CollectStyleContextOptions {
  readonly document: Document;
  readonly element: Element;
  readonly getComputedStyle?: (element: Element) => CSSStyleDeclaration;
  readonly maxCharacters: number;
  readonly readCssRules?: (sheet: CSSStyleSheet) => CSSRuleList;
}

function isStyleRule(rule: CSSRule): rule is StyleRuleLike {
  return "selectorText" in rule && "style" in rule;
}

function isGroupingRule(rule: CSSRule): rule is GroupingRuleLike {
  return "cssRules" in rule;
}

function groupingCondition(rule: GroupingRuleLike): string | undefined {
  if (typeof rule.conditionText === "string" && rule.conditionText.length > 0) {
    return rule.conditionText;
  }

  const openingBrace = rule.cssText.indexOf("{");
  const prefix = openingBrace < 0 ? "" : rule.cssText.slice(0, openingBrace).trim();
  return prefix.length === 0 ? undefined : prefix;
}

function contextCharacterCount(
  classNames: readonly string[],
  inlineStyle: string | undefined,
  rules: readonly MatchedStyleRule[],
  computed: Readonly<Record<string, string>>,
  warnings: readonly string[],
): number {
  return (
    classNames.join(" ").length +
    (inlineStyle?.length ?? 0) +
    rules.reduce(
      (total, rule) =>
        total +
        rule.selector.length +
        rule.declarations.length +
        (rule.source?.length ?? 0) +
        (rule.media?.length ?? 0),
      0,
    ) +
    Object.entries(computed).reduce(
      (total, [name, value]) => total + name.length + value.length,
      0,
    ) +
    warnings.join("\n").length
  );
}

function stylesheetSource(sheet: CSSStyleSheet, baseUrl: string): string | undefined {
  return sheet.href === null ? undefined : sanitizeUrl(sheet.href, baseUrl);
}

function collectMatchedRules(
  element: Element,
  rules: CSSRuleList,
  source: string | undefined,
  inheritedConditions: readonly string[],
  output: MatchedStyleRule[],
  warnings: Set<string>,
): void {
  for (const rule of rules) {
    if (isStyleRule(rule)) {
      let matches = false;

      try {
        matches = element.matches(rule.selectorText);
      } catch {
        warnings.add(CSS_COLLECTION_WARNINGS.selector);
        continue;
      }

      if (matches) {
        output.push(
          Object.freeze({
            selector: sanitizeCssText(rule.selectorText),
            declarations: sanitizeCssText(rule.style.cssText),
            ...(source === undefined ? {} : { source }),
            ...(inheritedConditions.length === 0
              ? {}
              : { media: inheritedConditions.join(" and ") }),
          }),
        );
      }

      continue;
    }

    if (isGroupingRule(rule)) {
      const condition = groupingCondition(rule);
      collectMatchedRules(
        element,
        rule.cssRules,
        source,
        condition === undefined
          ? inheritedConditions
          : [...inheritedConditions, condition],
        output,
        warnings,
      );
    }
  }
}

function collectComputedStyle(
  element: Element,
  getComputedStyle: ((element: Element) => CSSStyleDeclaration) | undefined,
): Record<string, string> {
  if (getComputedStyle === undefined) {
    return {};
  }

  const declaration = getComputedStyle(element);
  const computed: Record<string, string> = {};

  for (const property of COMPUTED_STYLE_PROPERTIES) {
    const value = sanitizeCssText(declaration.getPropertyValue(property).trim());

    if (value.length > 0) {
      computed[property] = value;
    }
  }

  return computed;
}

export function collectStyleContext(options: CollectStyleContextOptions): StyleContext {
  const warnings = new Set<string>([
    CSS_COLLECTION_WARNINGS.state,
    CSS_COLLECTION_WARNINGS.cssInJs,
    CSS_COLLECTION_WARNINGS.cascade,
  ]);
  const matchedRules: MatchedStyleRule[] = [];
  const readCssRules =
    options.readCssRules ?? ((sheet: CSSStyleSheet) => sheet.cssRules);

  for (const sheet of options.document.styleSheets) {
    let rules: CSSRuleList;

    try {
      rules = readCssRules(sheet);
    } catch {
      warnings.add(CSS_COLLECTION_WARNINGS.inaccessibleStylesheet);
      continue;
    }

    collectMatchedRules(
      options.element,
      rules,
      stylesheetSource(sheet, options.document.baseURI),
      [],
      matchedRules,
      warnings,
    );
  }

  const classNames = Array.from(options.element.classList);
  const inlineValue = options.element.getAttribute("style");
  const inlineStyle = inlineValue === null ? undefined : sanitizeCssText(inlineValue);
  const getComputedStyle =
    options.getComputedStyle ??
    options.document.defaultView?.getComputedStyle.bind(options.document.defaultView);
  const computedEntries = Object.entries(
    collectComputedStyle(options.element, getComputedStyle),
  );
  const warningList = Array.from(warnings);

  while (
    contextCharacterCount(
      classNames,
      inlineStyle,
      matchedRules,
      Object.fromEntries(computedEntries),
      warningList,
    ) > options.maxCharacters
  ) {
    if (computedEntries.length > 0) {
      computedEntries.pop();
      continue;
    }

    if (matchedRules.length > 1) {
      matchedRules.shift();
      continue;
    }

    break;
  }

  return Object.freeze({
    classNames: Object.freeze(classNames),
    ...(inlineStyle === undefined ? {} : { inlineStyle }),
    matchedRules: Object.freeze(matchedRules),
    computed: Object.freeze(Object.fromEntries(computedEntries)),
    warnings: Object.freeze(warningList),
  });
}
