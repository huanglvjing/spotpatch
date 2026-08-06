---
doc-id: "07-dom-css-collection"
title: "DOM 与 CSS 上下文采集"
status: "active"
version: "1.0.0"
last-updated: "2026-08-06"
source-range: "规格书 §12.1–§12.2、§13、§13.1–§13.4"
参考文献/依赖:
  - "03-public-api-models"
  - "08-code-prompt"
  - "09-local-protocol-security"
  - "10-ui-diagnostics"
  - "12-testing-acceptance"
---

# DOM 与 CSS 上下文采集

本文件只定义采集范围和样式解析。最终数据形状由公共模型定义 (见 doc-id:03-public-api-models)，永久脱敏和展示安全由安全规范定义 (见 doc-id:09-local-protocol-security)，Prompt 的总预算与裁剪优先级另行定义 (见 doc-id:08-code-prompt)。

## DOM 上下文采集

### 输出范围

- 目标元素完整 opening tag。
- 子树最多 3 层、最多 30 个节点。
- 文本节点单项最多 200 字符。
- 可选父级上下文最多 2 层，只保留 opening tag。
- 总 DOM 字符遵循 budget。

### 保留属性

- `id`
- `class`
- `role`
- `aria-*`
- `data-testid`
- 布局和交互相关属性
- 已清洗的 `href`、`src`

所有采集结果在形成上下文前必须经过统一清洗；清洗名单和不可关闭的规则不得在采集器中复制 (见 doc-id:09-local-protocol-security)。

## CSS 上下文采集

### 三层输出

1. className 和 inline style。
2. 实际匹配目标元素的 stylesheet rules。
3. 关键 computed properties。

### 关键计算属性白名单

```tsx
export const COMPUTED_STYLE_PROPERTIES = [
  "display",
  "position",
  "inset",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin",
  "padding",
  "box-sizing",
  "overflow",
  "overflow-x",
  "overflow-y",
  "flex",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "align-content",
  "justify-content",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "white-space",
  "color",
  "background-color",
  "border",
  "border-radius",
  "opacity",
  "visibility",
  "z-index",
  "transform",
] as const;
```

不要输出浏览器的数百个 computed 属性。

### Stylesheet 遍历

- 遍历 `document.styleSheets`。
- 递归处理 `CSSMediaRule`、`CSSSupportsRule` 等 grouping rule。
- 对每个 `CSSStyleRule.selectorText` 调用 `element.matches()`。
- selector 解析异常时跳过单条规则，不中止整个采集。
- 读取 `cssRules` 出现 `SecurityError` 时记录 warning。
- 对同源 `<style>`、CSS Module、Tailwind 构建结果正常处理。

### 已知限制

- `:hover`、`:focus`、伪元素规则需要额外状态模拟，v1 不保证收集。
- 跨域 stylesheet 受浏览器同源策略限制。
- Ant Design CSS-in-JS 的运行时规则可见，但原始 TS 源码位置通常不可见。
- CSS shorthand 与 longhand 的层叠解释不在 v1 范围。

UI 和 Prompt 必须把这些限制作为 warning 展示，不能静默丢失。

UI 展示约束见 UI 与诊断规范 (见 doc-id:10-ui-diagnostics)，Prompt 段落与预算见源码片段与 Prompt 规范 (见 doc-id:08-code-prompt)。

采集器的测试要求见测试与验收规范 (见 doc-id:12-testing-acceptance)。
