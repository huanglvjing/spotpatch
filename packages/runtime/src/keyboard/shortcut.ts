function isApplePlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function normalizedKey(key: string): string {
  return key.toLowerCase();
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.closest("[contenteditable]:not([contenteditable='false'])") !== null
  );
}

export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: string,
  platform: string,
): boolean {
  const tokens = shortcut
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  const keyToken = tokens.find(
    (token) =>
      token !== "mod" &&
      token !== "meta" &&
      token !== "ctrl" &&
      token !== "control" &&
      token !== "alt" &&
      token !== "option" &&
      token !== "shift",
  );

  if (keyToken === undefined || normalizedKey(event.key) !== keyToken) {
    return false;
  }

  const requiresMod = tokens.includes("mod");
  const requiresMeta =
    tokens.includes("meta") || (requiresMod && isApplePlatform(platform));
  const requiresControl =
    tokens.includes("ctrl") ||
    tokens.includes("control") ||
    (requiresMod && !isApplePlatform(platform));
  const requiresAlt = tokens.includes("alt") || tokens.includes("option");
  const requiresShift = tokens.includes("shift");

  return (
    event.metaKey === requiresMeta &&
    event.ctrlKey === requiresControl &&
    event.altKey === requiresAlt &&
    event.shiftKey === requiresShift
  );
}
