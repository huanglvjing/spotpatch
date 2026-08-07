import { UI_MARKER_ATTRIBUTE } from "./ui-constants.js";

export function createMarkedElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.setAttribute(UI_MARKER_ATTRIBUTE, "");
  return element;
}

export function createButton(
  document: Document,
  label: string,
  className = "",
): HTMLButtonElement {
  const button = createMarkedElement(document, "button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}
