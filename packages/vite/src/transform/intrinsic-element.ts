import { SOURCE_MARKER_ATTRIBUTE } from "@spotpatch/shared";
import type { JSXOpeningElement } from "oxc-parser";

export function isIntrinsicOpeningElement(node: JSXOpeningElement): boolean {
  if (node.name.type !== "JSXIdentifier") {
    return false;
  }

  const { name } = node.name;
  const firstCharacter = name[0];

  return name.includes("-") || firstCharacter?.toLowerCase() === firstCharacter;
}

export function hasSourceMarkerAttribute(node: JSXOpeningElement): boolean {
  return node.attributes.some(
    (attribute) =>
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === SOURCE_MARKER_ATTRIBUTE,
  );
}
