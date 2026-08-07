---
doc-id: "05-runtime-lifecycle"
title: "Runtime 与生命周期"
status: "active"
version: "1.0.0"
last-updated: "2026-08-07"
source-range: "规格书 §2.4 第 4–5 条、§9、§9.1–§9.3、原文‘元素选择器’、§10.1–§10.3"
参考文献/依赖:
  - "03-public-api-models"
  - "04-vite-plugin"
  - "06-source-resolution"
  - "09-local-protocol-security"
  - "10-ui-diagnostics"
  - "12-testing-acceptance"
---

# Runtime 与生命周期

## Runtime 注入

Vite 插件通过 `transformIndexHtml` 在开发页面注入虚拟模块：

```html
<script type="module" src="/@id/virtual:spotpatch/client"></script>
```

虚拟模块只包含会话配置和 runtime 启动：

注入机制由 Vite 插件提供 (见 doc-id:04-vite-plugin)。协议基础路径必须引用协议模块中的唯一常量，不在 Runtime 重复定义 (见 doc-id:09-local-protocol-security)；快捷键使用已解析的公共配置 (见 doc-id:03-public-api-models)。

```tsx
import { SPOTPATCH_API_BASE } from "@spotpatch/shared/protocol";
import { bootstrapSpotPatch } from "@spotpatch/runtime";

bootstrapSpotPatch({
  apiBase: SPOTPATCH_API_BASE,
  sessionToken: "<server-generated-token>",
  shortcut: resolvedOptions.shortcut,
});
```

禁止注入浏览器的数据边界由安全规范统一定义 (见 doc-id:09-local-protocol-security)。

## 单例与 HMR

- HMR 不能重复挂载实例。

```tsx
const INSTANCE_KEY = "__spotpatchRuntime__" as const;

type GlobalWithSpotPatch = typeof globalThis & {
  [INSTANCE_KEY]?: SpotPatchController;
};

export function bootstrapSpotPatch(config: RuntimeConfig): void {
  const target = globalThis as GlobalWithSpotPatch;
  target[INSTANCE_KEY]?.dispose();
  target[INSTANCE_KEY] = createController(config);
  target[INSTANCE_KEY].mount();
}
```

- 所有事件监听器、Observer 和定时任务必须可释放。

`dispose()` 必须释放：

- pointer、click、keydown、scroll、resize 监听器
- ResizeObserver、MutationObserver
- 未完成 fetch 的 AbortController
- Shadow Root host
- 高亮节点和面板
- 内部缓存中的 Element 引用

## Runtime 状态机

```text
idle
  └─ ACTIVATE → inspecting
inspecting
  ├─ HOVER → inspecting
  ├─ SELECT → selected
  └─ CANCEL → idle
selected
  ├─ RESELECT → inspecting
  ├─ PREVIEW → previewing
  ├─ OPEN_EDITOR → selected
  └─ CLOSE → idle
previewing
  ├─ COPY_SUCCESS → selected
  ├─ COPY_FAILURE → previewing
  └─ BACK → selected
```

状态转换由纯 reducer 实现；DOM 副作用统一放在 controller 中。禁止让多个 UI 组件各自修改全局状态。

问题描述输入框是 `selected` 状态的直接编辑面，不设独立 `annotating` 状态，也不要求用户执行“添加说明”或“保存说明”。每次输入只更新当前选择的内存数据和 Preview 可用性，不触发文件写入；选中完成后输入框必须立即获得焦点。进入 `previewing` 后返回，应恢复 `selected` 状态并重新聚焦该输入框。

## 元素选择器

原文在此处写作普通文本“1. 元素选择器”，并直接进入 §10.1；本次按主题恢复为本节标题，不改变其规则内容。

选择后的来源解析和置信度判定由独立规范负责 (见 doc-id:06-source-resolution)。

### 事件策略

- `pointermove`：捕获阶段监听，用 `requestAnimationFrame` 限流。
- `click`：只在 inspecting 状态调用 `preventDefault()`、`stopPropagation()` 和 `stopImmediatePropagation()`。
- `keydown`：处理快捷键和 Escape；输入框聚焦时不触发字母快捷键。
- 工具 UI 节点统一使用 UI 规范定义的 marker，永远排除 (见 doc-id:10-ui-diagnostics)。

### 命中算法

```text
elementsFromPoint(clientX, clientY)
  → 排除 SpotPatch UI
  → 排除 html/body（除非没有其他候选）
  → 排除 display:none / visibility:hidden
  → 排除零面积节点
  → 取第一个可选择候选
```

`pointer-events: none` 元素不会直接出现在正常命中链中；如果需要展示其父级，应使用返回候选而不是临时修改业务样式。

### 几何信息

- 块级元素使用 `getBoundingClientRect()`。
- 内联元素可使用 `getClientRects()`，高亮全部 line box 或取 union rect。
- overlay 使用 `position: fixed`，rect 不额外叠加 scroll offset。
- 页面滚动、viewport resize、目标 ResizeObserver 变化时重新计算。
- 目标被卸载后自动回到 inspecting，并显示非阻塞提示。

生命周期和性能要求的验收方式见测试与验收规范 (见 doc-id:12-testing-acceptance)。
