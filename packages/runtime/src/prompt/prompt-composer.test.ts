import type { SpotAnnotation } from "@spotpatch/shared";
import { describe, expect, it } from "vitest";

import { createPromptComposer } from "./prompt-composer.js";

const annotation = Object.freeze({
  schemaVersion: 3,
  id: "annotation-id",
  locale: "zh-CN",
  page: Object.freeze({
    url: "http://localhost:5173/profile?token=do-not-copy",
    pathname: "/profile",
    title: "Profile",
    viewportWidth: 1440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  }),
  targets: Object.freeze([
    Object.freeze({
      instruction: "头像与用户名没有垂直居中。",
      page: Object.freeze({
        url: "http://localhost:5173/settings?token=target-secret",
        pathname: "/settings",
        title: "Settings",
        viewportWidth: 1280,
        viewportHeight: 720,
        devicePixelRatio: 2,
      }),
      source: Object.freeze({
        fileId: "opaque-file-id",
        relativePath: "src/components/UserProfile.tsx",
        line: 36,
        column: 5,
        origin: "jsx-host",
        confidence: "exact",
      }),
      react: Object.freeze({
        supported: true,
        version: "18.3.1",
        componentName: "UserProfile",
        componentStack: Object.freeze(["UserProfile", "ProfilePage", "App"]),
      }),
      element: Object.freeze({
        tagName: "div",
        selector: "main > div.user-info",
        sanitizedHtml:
          '<!-- Selected element -->\n<div class="user-info">\n  User\n</div>\n<!-- Parent context: nearest first -->\n<main>',
        textPreview: "User",
        rect: Object.freeze({ x: 10, y: 20, width: 300, height: 40 }),
      }),
      styles: Object.freeze({
        classNames: Object.freeze(["user-info"]),
        inlineStyle: "padding: 8px",
        matchedRules: Object.freeze([
          Object.freeze({
            selector: ".user-info",
            declarations: "display: flex; align-items: flex-start;",
            source: "/src/profile.css",
          }),
        ]),
        computed: Object.freeze({
          display: "flex",
          "align-items": "flex-start",
          width: "300px",
        }),
        warnings: Object.freeze(["Dynamic pseudo-class rules may be unavailable."]),
      }),
      code: Object.freeze({
        relativePath: "src/components/UserProfile.tsx",
        language: "tsx",
        startLine: 30,
        endLine: 40,
        excerpt:
          'export function UserProfile() {\n  const token = super-secret;\n  return <div className="user-info">User</div>;\n}',
        boundary: "component",
      }),
      warnings: Object.freeze(["A stylesheet was inaccessible."]),
    }),
  ]),
  createdAt: "2026-08-06T10:00:00.000Z",
} satisfies SpotAnnotation);

const TITLES = [
  "## 页面环境",
  "## 已选目标（1）",
  "### 目标 1",
  "#### 修改说明",
  "#### React 上下文",
  "#### 源码定位",
  "#### 选中元素",
  "#### 相关样式",
  "#### 关键计算样式",
  "#### 附近代码",
  "#### 采集警告",
  "## 修改要求",
] as const;

describe("Prompt composer", () => {
  it("renders every section in the required stable order", () => {
    const prompt = createPromptComposer({ maxCharacters: 16_000 }).compose(annotation);
    const positions = TITLES.map((title) => prompt.indexOf(title));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(prompt).toContain("头像与用户名没有垂直居中");
    expect(prompt).toContain("src/components/UserProfile.tsx:36:5");
    expect(prompt).toContain("http://localhost:5173/settings?token=%5Bredacted%5D");
    expect(prompt).toContain("- 路径: /settings");
    expect(prompt).toContain("- 置信度: exact");
    expect(prompt).toContain('<div class="user-info">');
    expect(prompt).toContain(".user-info {");
    expect(prompt).toContain("- 代码边界: component");
    expect(prompt).toContain("请先判断根因");
  });

  it("removes secret URL and source values before composing", () => {
    const prompt = createPromptComposer({ maxCharacters: 16_000 }).compose(annotation);

    expect(prompt).not.toContain("do-not-copy");
    expect(prompt).not.toContain("super-secret");
    expect(prompt).toContain("token=%5Bredacted%5D");
    expect(prompt).toContain("token = [redacted]");
  });

  it("trims computed style, full stack, and parent DOM before high-priority facts", () => {
    const prompt = createPromptComposer({ maxCharacters: 800 }).compose(annotation);

    expect(prompt.length).toBeLessThanOrEqual(800);
    expect(prompt).toContain("头像与用户名没有垂直居中");
    expect(prompt).toContain("src/components/UserProfile.tsx:36:5");
    expect(prompt).toContain('<div class="user-info">');
    expect(prompt).not.toContain("Parent context");
    expect(prompt).not.toContain("width: 300px");
  });

  it("is deterministic and does not mutate the annotation", () => {
    const composer = createPromptComposer({ maxCharacters: 16_000 });
    const before = JSON.stringify(annotation);

    expect(composer.compose(annotation)).toBe(composer.compose(annotation));
    expect(JSON.stringify(annotation)).toBe(before);
  });

  it("keeps every selected target traceable under a shared bounded budget", () => {
    const first = annotation.targets[0];

    if (first === undefined) {
      throw new Error("Expected a target fixture.");
    }

    const firstCode = first.code;

    const second = Object.freeze({
      ...first,
      instruction: "把保存按钮文案改得更明确。",
      source: Object.freeze({
        ...first.source,
        fileId: "second-file-id",
        relativePath: "src/components/ProfileActions.tsx",
        line: 88,
        column: 7,
      }),
      react: Object.freeze({
        ...first.react,
        componentName: "ProfileActions",
        componentStack: Object.freeze(["ProfileActions", "ProfilePage", "App"]),
      }),
      element: Object.freeze({
        ...first.element,
        selector: "button.save-profile",
        sanitizedHtml: '<button class="save-profile">Save profile</button>',
      }),
      code: Object.freeze({
        ...firstCode,
        relativePath: "src/components/ProfileActions.tsx",
        startLine: 80,
        endLine: 94,
        excerpt: `${"const noisy = true;\n".repeat(80)}return <button>Save profile</button>;`,
      }),
    });
    const multi = Object.freeze({
      ...annotation,
      targets: Object.freeze([
        Object.freeze({
          ...first,
          instruction: "对齐头像与用户名。",
          code: Object.freeze({
            ...firstCode,
            excerpt: `${"const firstNoise = true;\n".repeat(80)}return <div>User</div>;`,
          }),
        }),
        second,
      ]),
    }) satisfies SpotAnnotation;
    const prompt = createPromptComposer({ maxCharacters: 2_400 }).compose(multi);

    expect(prompt.length).toBeLessThanOrEqual(2_400);
    expect(prompt).toContain("## 已选目标（2）");
    expect(prompt).toContain("src/components/UserProfile.tsx:36:5");
    expect(prompt).toContain("src/components/ProfileActions.tsx:88:7");
    expect(prompt).toContain("### 目标 1");
    expect(prompt).toContain("### 目标 2");
    expect(prompt).toContain("对齐头像与用户名。");
    expect(prompt).toContain("把保存按钮文案改得更明确。");
  });

  it("rejects an invalid budget", () => {
    expect(() => createPromptComposer({ maxCharacters: 0 })).toThrow(RangeError);
  });
});
