---
doc-id: "05-runtime-lifecycle"
title: "Runtime 与生命周期"
status: "active"
version: "1.5.0"
last-updated: "2026-08-08"
source-range: "规格书 §2.4 第 4–5 条、§9、§9.1–§9.3、原文‘元素选择器’、§10.1–§10.3；v1.1 Agent Runtime 生命周期；v1.2 多目标选择生命周期；v1.3 逐目标编辑状态；v1.4 源码导航生命周期；v1.5 本地工作区预检与同意生命周期"
参考文献/依赖:
  - "03-public-api-models"
  - "04-vite-plugin"
  - "06-source-resolution"
  - "09-local-protocol-security"
  - "10-ui-diagnostics"
  - "12-testing-acceptance"
  - "16-ai-agent-execution"
  - "17-model-provider-credentials"
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
  sessionId: "<server-generated-non-secret-id>",
  sessionToken: "<server-generated-token>",
  shortcut: resolvedOptions.shortcut,
  locale: resolvedOptions.locale,
  maxTargets: resolvedOptions.maxTargets,
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
  ├─ ACTIVATE → inspecting
  └─ RESTORE → selected
inspecting
  ├─ HOVER → inspecting
  ├─ SELECT → selected
  └─ CANCEL → idle
selected
  ├─ RESELECT → inspecting
  ├─ PREVIEW → previewing
  ├─ RUN_AGENT → selected + AgentJob
  ├─ OPEN_EDITOR → selected
  └─ CLOSE → idle（隐藏并保留草稿）
previewing
  ├─ COPY_SUCCESS → selected
  ├─ COPY_FAILURE → previewing
  └─ BACK → selected
```

状态转换由纯 reducer 实现；DOM 副作用统一放在 controller 中。禁止让多个 UI 组件各自修改全局状态。

活动目标的修改说明输入框是 `selected` 状态的直接编辑面，不设独立 `annotating` 状态，也不要求用户执行“添加说明”或“保存说明”。每次输入只更新该目标的内存数据、字符预算和 Preview/Run 可用性，不触发文件写入；选中完成后活动目标输入框必须立即获得焦点。进入 `previewing` 后返回，应恢复 `selected` 状态并重新聚焦原活动目标的输入框。

多目标不增加第二套状态机。`selected → RESELECT → inspecting` 有两种由 controller 明确区分的意图：`Reselect` 清空整个目标集及全部逐目标草稿，`Add element` 保留已有目标与各自草稿并临时隐藏工作台；新增目标、命中重复目标或达到上限后均通过 `SELECT` 回到 `selected`。在追加选择时按 Escape 或再次触发“停止选择”只取消本次追加并回到原目标集；没有已有目标时仍回到 `idle`。

完成采集的目标以版本化、有界且不包含 DOM/Fiber 引用的草稿写入当前标签页 `sessionStorage`，键只使用开发服务生成的非敏感 `sessionId`，不得使用或派生鉴权 token。关闭工作台记录 `open: false` 并保留草稿，再次触发通过 `RESTORE` 回到 `selected`；整页同源导航或刷新按原 `open` 状态恢复。开发服务重启会生成新 `sessionId`，不得读取上一服务会话的旧 fileId。`Reselect`、移除最后一个目标和明确释放选择必须删除草稿。

## Agent Job 生命周期

AI Job 是与元素选择状态正交的服务端状态，不把 `running`、`validating` 等状态塞入上述选择 reducer；公共状态枚举只有一处定义 (见 doc-id:03-public-api-models)，完整转换和取消语义由 Agent 执行规范定义 (见 doc-id:16-ai-agent-execution)。

- `RUN_AGENT` 必须冻结当前 `SpotAnnotation`、provider profile ID、model profile ID 和页面选择的 apply mode，再创建 Job；后续输入、选择、模式或模型切换只影响新 Job。
- 文本输入只更新本地草稿，不按键调用 provider；用户点击运行或按 `Mod+Enter` 才产生一次明确请求。
- Runtime 通过带会话 token 的本地协议读取有序 Job 事件，并使用独立 `AbortController`；外部 provider URL 与 Key 永不进入 Runtime (见 doc-id:17-model-provider-credentials)。
- 关闭面板不等于静默取消：运行中必须提供明确的“继续后台运行”或“取消任务”行为；v1.1 默认关闭面板时请求用户确认。
- `dispose()`、Vite HMR 重载或页面卸载必须终止浏览器事件订阅并释放引用；服务端 Job 是否取消按本地协议的显式取消规则处理。
- Apply 后业务 HMR 可能卸载当前目标元素。Runtime 必须清除陈旧 Element，并提示用户重新选择，不能继续用旧 rect 或 DOM 引用定位新页面。
- 多目标 Job Apply 后必须一次性释放全部目标的 Element、Observer 和几何引用；不能只释放最后一个活动目标后继续使用其余旧 DOM。
- Runtime 只展示脱敏 Job 快照、Diff 和检查结果；不能依据模型自然语言自行判定“已修改”或“检查通过”。
- AI 启用且进入选中态时，Runtime 必须读取本地工作区健康快照；provider/model 改变、环境检查、重置 Job 和真正运行前都必须重新检查，不能复用过期快照。健康状态与公共结构只在公共模型定义 (见 doc-id:03-public-api-models)。
- 服务端声明 `trusted-auto` 能力时，Runtime 提供 `review | trusted-auto` 两个页面选项并默认 `review`；其他服务端策略不允许浏览器扩大 apply mode。模式切换必须清理不适用的会话同意并刷新运行门禁。
- `ready` 直接允许继续；review/auto 的 `consent-required` 必须展示 staged/unstaged/untracked 数量和独立的本地修改纳入同意，用户勾选前 Run 保持禁用；页面选中 trusted-auto 时使用包含远程传输、本地修改与直接应用后果的一次会话级同意，不重复显示第二个复选框。`blocked` 必须展示稳定错误码对应的具体原因，任何模式都不能用同意绕过。检查中的瞬时状态不得清空用户刚刚作出的同意，最终变为 `ready` 或 `blocked` 时必须清除不再适用的独立工作区同意。
- 创建 Job 时只能根据本次最新健康快照生成 `workingTreeMode`：干净为 `require-clean`，存在且已同意的可隔离修改为 `include-local-changes`。请求必须显式发送本次 `applyMode`；选择 trusted-auto 时还必须发送 `trustedFastModeConsent: true`，其他模式不得发送。服务端配置与请求不匹配时必须拒绝。三个字段都不是长期偏好，不写盘，也不能由 provider capability 同意代替。服务端仍重新检查，防止浏览器状态与磁盘状态之间的竞态。

## 元素选择器

原文在此处写作普通文本“1. 元素选择器”，并直接进入 §10.1；本次按主题恢复为本节标题，不改变其规则内容。

选择后的来源解析和置信度判定由独立规范负责 (见 doc-id:06-source-resolution)。

### 事件策略

- `pointermove`：捕获阶段监听，用 `requestAnimationFrame` 限流。
- `click`：只在 inspecting 状态调用 `preventDefault()`、`stopPropagation()` 和 `stopImmediatePropagation()`。
- `keydown`：处理快捷键和 Escape；输入框聚焦时不触发字母快捷键。
- 工具 UI 节点统一使用 UI 规范定义的 marker，永远排除 (见 doc-id:10-ui-diagnostics)。

### 多目标选择规则

- 第一次点击创建目标集；`Add element` 追加目标，`Reselect` 才清空目标集。可选数量、默认值和硬上限只由公共配置定义 (见 doc-id:03-public-api-models)。
- 每个目标独立保存 `instruction` 草稿、DOM Element、来源解析、源码请求状态、DOM/CSS 采集状态和异步任务标识。切换活动项、追加、去重、语言切换或异步上下文刷新都不得覆盖其他目标的草稿；异步回调只有在会话 revision 未变化且目标仍在集合中时才能写回，防止删除或重选后的结果串位。
- `jsx-host` 或 `dom-ancestor` 有完整 marker 时，以 `fileId + line + column` 作为去重键；因此同一 map/list 源码位置的多个 DOM 实例只进入一次上下文。无完整 marker 时只按当前 Element 身份去重，不猜测两个相似 DOM 是否同源。
- 目标顺序等于首次加入顺序；最后加入或重复点中的目标成为活动目标。底部源码入口和工作台定位使用活动目标；目标行快捷入口先激活对应目标再打开其坐标；Prompt 与 Agent 使用完整有序目标集。Apply 后释放旧 Element 和高亮但保留 source marker 供只读导航，具体交互 (见 doc-id:10-ui-diagnostics)。
- 删除目标只取消该目标尚未完成的采集结果、解除观察并删除它自己的说明；不得影响其他目标说明。删除最后一个目标后进入追加选择态，等待新目标。
- Preview/Run AI 只有在至少一个目标存在、每个目标的修改说明 trim 后非空、说明总字符数未超过公共总上限、每个目标的 DOM/CSS 采集完成且没有源码请求仍在 loading 时可用；单个源码请求失败可以带明确 warning 降级，但不能伪装为完整上下文。字符上限只引用公共模型 (见 doc-id:03-public-api-models)。

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
- 多目标中的某个目标被卸载时必须解除 ResizeObserver 并清除 Element/几何引用，但保留已经清洗的页面、源码、DOM/CSS 上下文和说明；不得仅因 SPA 路由切换删除目标。滚动、resize 和 ResizeObserver 只更新仍连接目标的固定定位高亮，跨页面目标继续参与 Preview/Agent 请求。

生命周期和性能要求的验收方式见测试与验收规范 (见 doc-id:12-testing-acceptance)。
