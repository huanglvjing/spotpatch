// @vitest-environment jsdom

import { ERROR_CODES } from "@spotpatch/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createUiLocalizer, resolveUiLocale, UI_MESSAGES } from "./localization.js";

afterEach(() => {
  document.documentElement.removeAttribute("lang");
  vi.restoreAllMocks();
});

describe("runtime UI localization", () => {
  it("honors an explicit locale before document and browser languages", () => {
    document.documentElement.lang = "zh-Hans";

    expect(resolveUiLocale("en-US", document)).toBe("en-US");
    expect(resolveUiLocale("zh-CN", document)).toBe("zh-CN");
  });

  it("resolves auto from the document language and then browser languages", () => {
    document.documentElement.lang = "zh-Hans-CN";
    expect(resolveUiLocale("auto", document)).toBe("zh-CN");

    document.documentElement.lang = "fr-FR";
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-TW", "en-US"]);
    expect(resolveUiLocale("auto", document)).toBe("zh-CN");
  });

  it("toggles synchronously, notifies subscribers, and supports unsubscribe", () => {
    const localizer = createUiLocalizer(document, "en-US");
    const listener = vi.fn();
    const unsubscribe = localizer.subscribe(listener);

    expect(localizer.messages().dialog.editTitle).toBe("Plan the change");
    localizer.toggle();
    expect(localizer.locale()).toBe("zh-CN");
    expect(localizer.messages().dialog.editTitle).toBe("规划本次修改");
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    localizer.toggle();
    expect(localizer.locale()).toBe("en-US");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("defines localized text for every public error code", () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(UI_MESSAGES["en-US"].errors[code]).not.toHaveLength(0);
      expect(UI_MESSAGES["zh-CN"].errors[code]).not.toHaveLength(0);
    }
  });
});
