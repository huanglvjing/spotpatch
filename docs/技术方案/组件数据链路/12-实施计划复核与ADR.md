---
doc-id: "data-flow-12-delivery-adr"
title: "组件数据链路实施计划、复核与 ADR"
status: "active"
version: "1.1.0"
last-updated: "2026-08-13"
source-range: "POC 与 Beta 实施结果、剩余里程碑、技术选型、退出条件、重新审视结论与 ADR"
参考文献/依赖:
  - "data-flow-00-index"
  - "data-flow-03-architecture-packages"
  - "data-flow-04-static-attribution"
  - "data-flow-05-runtime-observation"
  - "data-flow-11-testing-acceptance"
  - "14-implementation-plan"
  - "15-risks-adr"
---

# 组件数据链路实施计划、复核与 ADR

本计划以专题交付边界和架构 (见 doc-id:data-flow-00-index)、(见 doc-id:data-flow-03-architecture-packages) 为前提，优先验证静态归属、运行时观测和硬验收 (见 doc-id:data-flow-04-static-attribution)、(见 doc-id:data-flow-05-runtime-observation)、(见 doc-id:data-flow-11-testing-acceptance)；通过后再并入现有实施计划和 ADR (见 doc-id:14-implementation-plan)、(见 doc-id:15-risks-adr)。

## 2026-08-13 实施复核

当前工作区已完成 D1 核心证明并迁移为 Vite + React 18 Beta 产品代码；可丢弃 `experiments/data-flow-poc` 已删除，未保留重复实现或兼容 flag。实际状态如下：

| 阶段 | 当前结果 |
| --- | --- |
| D1 | AntD composite mapping、稳定 ID、显式 invocation/request frame、fetch Promise identity、并发、timer/Promise callback、fetch/XHR dispatch 与可移植关键样本已通过自动化 |
| D2 | shared 契约、单遍 compiler instrumentation、Node-only TypeScript analyzer、跨模块 cache 与 Axios/Zustand 子集已实现 |
| D3 | head-prepend 轻量 prelude、内存 ring buffer、route/source freshness、严格 evidence merger 已实现；result tap/safe JSON shape 未实现，公开模式收窄为 dispatch-only |
| D4 | 严格只读 endpoint、组件数据链路/页面接口 UI、自动加载与刷新已实现；完整目标 UI 的观测窗口、源码证据展开和专项 a11y 仍待补 |
| D5 | 未实现；不公开无行为 AI 开关，capability 为 disabled |
| D6 | 认证、生命周期轮询、表格 oracle、Vite 5/6 真宿主、AntD E2E、性能与生产扫描已加入；大规模公开 fixture 与全部发布矩阵尚未完成 |
| D7 | 未开始；Next 不继承 Vite Beta 声明 |

当前实现、配置和不支持项以 (见 doc-id:data-flow-13-beta-implementation) 为准。下文保留原 Gate 的理由和后续工作，不能把阶段标题误读为全部完成。

## 编码前最终判断

不应直接从 UI 或 fetch monkey-patch 开始。当前最危险的不确定性不是“能否看到网络请求”，而是：

1. 选中 AntD 等复合组件内部 DOM 后，能否稳定落到正确业务组件与具体 trigger。
2. invocation token 跨真实 Form、Zustand、Axios、`await`、timer 和并发时是否不串线。
3. recorder/result tap 是否保持 Promise、错误、abort、stream 和 wrapper 的可观察语义。
4. 首个页面请求发生前能否在不同 Vite/CSP 情况安装 prelude。
5. response shape 是否能在不遍历任意 Proxy/getter、不读取 body 的情况下达到有用覆盖。

上述问题任何一个失败，都需要调整支持范围或架构。因此 Gate D1 必须是可丢弃 POC，不能先建立公共 API 或写完整页面。

## 技术选型

| 领域 | 选择 | 理由 | 不采用 |
| --- | --- | --- | --- |
| AST | 复用 `oxc-parser@0.143.0` + `MagicString` | 仓库已有、快、transform/source map 已验证 | 再引入 Babel/ts-morph 复制解析链 |
| 模块解析 | Vite host resolver 首发 | 与真实 alias/exports 一致 | analyzer 自写 Node/Vite 两套 resolver |
| 图结构 | TypeScript `Map/Set` + 不可变输出 | 规模有硬上限，无需图数据库 | Neo4j/通用重图依赖 |
| 类型 | 显式注解 + runtime shape 首发；TS semantic provider 后置 Gate | 真实项目常见 `any`，类型不能替代 observation | 启动时全仓 TypeScript Program |
| 浏览器观测 | 小型 head-prepend prelude + fetch/XHR adapter | npm 插件内可用，页面加载起观测 | 强制 DevTools Extension/CDP |
| 异步来源 | 编译期显式 invocation provenance POC | 可审计并能定义降级 | `Error.stack`/时间/URL 猜测；依赖未标准化 AsyncContext |
| 协议 | 现有 same-origin `/__spotpatch/v1` + Zod strict Schema | 复用鉴权和 envelope | 新 WebSocket 或任意查询 API |
| UI | 现有 Shadow DOM + native DOM，lazy chunk | 复用设计、可访问和包体体系 | 第二个框架/独立 DevTools UI |
| AI | 现有 Agent/Provider + read-only task profile | 复用凭据、工具、安全、取消 | 第二套模型 SDK/Key/UI |
| 存储 | 会话内 cache + document ring buffer/WeakMap | 最小留存 | IndexedDB/localStorage 持久化 observation |

TC39 AsyncContext 截至调研时仍处于 Stage 2，不应成为首发正确性的浏览器基础；未来标准稳定并进入目标浏览器矩阵后可通过 ADR 重评。[TC39 AsyncContext proposal](https://github.com/tc39/proposal-async-context)

## 一手平台依据

- Vite `transformIndexHtml` 提供 `head-prepend` 注入顺序，适合作为首发 prelude 候选，但真实首请求/CSP 时序仍须 POC。[Vite Plugin API](https://vite.dev/guide/api-plugin.html#transformindexhtml)
- `chrome.devtools.network` 只对 DevTools extension page 可用，并要求扩展声明 `devtools_page`；页面内 npm 插件不能直接调用。采用它还会要求用户打开 DevTools，违背本需求的页面内体验。[Chrome DevTools Network API](https://developer.chrome.com/docs/extensions/reference/api/devtools/network)
- Chrome DevTools 自身可以显示请求 Initiator/JavaScript stack，但那是 DevTools 产品能力，不是 React 组件归属协议，也不能作为 SpotPatch 页面 UI 的可移植数据源。[Chrome Network reference](https://developer.chrome.com/docs/devtools/network/reference#initiators-dependencies)
- `PerformanceResourceTiming.initiatorType` 只返回 `fetch`、`xmlhttprequest`、`img` 等资源发起机制，不提供业务组件或源码 callsite。[MDN initiatorType](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/initiatorType)
- `fetch()` 的 Request/Response/Promise 行为与 XHR `responseType` 都有明确平台语义，recorder 必须围绕这些语义做差分测试，不能通过强制 JSON 读取统一处理。[MDN Window.fetch](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch)、[MDN XMLHttpRequest.responseType](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/responseType)
- OpenTelemetry JavaScript 的浏览器客户端 instrumentation 仍标为 experimental，Web context 示例依赖 Zone Context Manager；它适合 telemetry，不提供 SpotPatch 所需的源码组件稳定 ID，不能替代编译期 provenance。[OpenTelemetry browser](https://opentelemetry.io/docs/languages/js/getting-started/browser/)、[OpenTelemetry context](https://opentelemetry.io/docs/languages/js/context/)

因此 DevTools Extension/CDP 可以作为未来独立产品形态增强页面级网络可见性，但不是当前 npm 插件的基础依赖；Performance/telemetry API 也只能贡献辅助事实，不能建立确定组件归属。

## Gate D1：可丢弃 POC（5–8 工程日）

POC 曾只进入 `experiments/data-flow-poc`；验证通过的部分已按公共包边界重写/迁移，实验目录现已删除。后续不得重新引入重复 POC 路径或永久兼容 flag。

### D1-A 复合组件与 trigger

- 为源码 component/composite JSX/trigger/request 建 registry anchor。
- 用 React Adapter + source registration + DOM semantics 在真实 AntD Button/Form 中定位业务组件和 submit trigger。
- composite anchor 只做静态登记；不得给任意第三方组件盲目注入自定义 prop。
- 当组件内存在多个无法区分的 Form/Button 时必须返回 component-level/possible；不能为追求命中率任选一个。

### D1-B invocation 与并发

- `Button submit → Form.onFinish → Zustand action → Axios http.post` 完整传播。
- 同 endpoint 两组件并发、同组件快速重复、effect 与 click 交错不串线。
- 同步、`await`、timer、Promise/第三方 callback 分别记录 supported/unsupported 边界。
- 验证 function/handler identity、`this`、arguments、HMR 和 source map。

### D1-C recorder 与 result tap

- head-prepend 早于入口请求；CSP fixture 有确定能力结果。
- fetch/XHR dispatch 观测不改变 request/return/error/abort/event/stream。
- 特别验证给 rejected Promise 附加观察 handler 的 `unhandledrejection` 差异；失败则全局 recorder 保持 dispatch-only。
- response shape 只在应用已解析、安全来源上 tap；Proxy/getter 计数为 0。

### D1-D 实仓样本

- 短信登录、密码登录、微信轮询。
- direct Table、Zustand Table、parent-prop Table。
- 流式 fetch、签名上传、Blob 下载。

### POC 退出

POC 结束必须产出机器可读结果和 ADR 草案，然后：

- 全部硬门禁通过：删除实验性重复代码，按 D2 从公共契约重新实现/迁移。
- 部分通过：缩小首发支持矩阵并更新文档、oracle、估算。
- 核心归属/非干扰失败：不进入 Beta；可以只提供“页面接口总览 + 静态 declared”实验功能，但不得称组件精确归属。

POC 不能因“演示看起来可以”直接搬进 runtime。

## 实施阶段

### D0 规范冻结（1–2 日）

- 评审本专题、术语、隐私策略、支持矩阵和分母。
- 冻结 147-callsite manifest、17-table oracle 与关键登录样本。
- 标记公共契约迁入点；此阶段不写产品代码。

### D1 阻断式 POC（5–8 日）

- 按上一节完成实验、差分和实仓证明。
- 已裁决：首版不支持 `safe-json-shape`；支持已测试的 lexical await、timer、Promise callback 与 composite mapping，范围外生成诊断或保持 unassigned。

### D2 公共契约、compiler 与 analyzer（5–8 日）

- shared Schema/diagnostics/limits/redaction policy。
- compiler 单遍 anchor discovery + 已通过的 instrumentation。
- analyzer module/symbol/event/def-use graph、cache 和 adapter registry。
- Axios、React、Zustand、AntD Form、TanStack Query 的已批准 adapter 子集。
- 删除 POC 重复实现，补 export/依赖/fixture 门禁。

### D3 Runtime observation 与 merger（5–8 日）

- Vite prelude、invocation context、fetch/XHR recorder、result tap。
- observation ring buffer、route/page/source epoch、清理和 wrapper 共存。
- evidence merger 与 page/component query。
- 完成语义差分、内存、性能和生产裁剪。

### D4 协议与 UI（4–6 日）

- dev-server analyzer manager、只读 endpoint、Zod、取消和 cache。
- 数据链路/页面接口/详情/状态矩阵/观测模式。
- 双语、键盘、读屏、响应式、源码导航。
- 不改现有修改说明/Prompt/Agent 主流程。

### D5 AI 辅助（3–5 日，可独立关闭）

- data-flow AI context/output Schema 和预览。
- Explain 与只读 Assist Find task profile。
- evidence 验证、prompt injection、provider fake contract、同意/取消。
- AI 失败不阻断核心 Beta；若未完成保持 feature off。

### D6 实仓与发布硬化（5–8 日）

- 147 callsite、17 Table、登录/微信、stream/upload/blob 全量 oracle。
- Vite/React/Node/OS/Chromium required 矩阵。
- secret、协议、memory、performance、production leakage、package validation。
- 更新核心活动规范、ADR、README/Changeset 和支持声明。

### D7 Next 增量（5–8 日，条件项）

- 只有 Vite D6 通过且 Next 现有公共预览边界不被破坏时开始。
- instrumentation-client/Loader/Sidecar、server/client 双图、RSC/Server Action 分别证明。
- webpack/Turbopack、App/Pages Router 和生产零残留独立门禁；未通过不影响 Vite，也不扩大 Next 声明。

## 工期判断

- 核心 Vite Beta（D0–D4 + D6）：约 **25–40 工程日**。
- AI Explain + Assist Find（D5）：增加 **3–5 工程日**。
- 用户本次描述的完整 Vite 方案：约 **28–45 工程日**。
- Next 公共预览增量（D7）：再增加 **5–8 工程日**。

这是单名熟悉仓库的高级工程师估算，不包含产品视觉多轮反复、目标项目大规模改版、支持矩阵外适配器或 POC 推翻架构后的重做。不能把 Apollo/Redux/SWR/tRPC/Prisma/Drizzle 等全部压入同一估算；每个 adapter 都要单独 fixture 和版本矩阵。

## PR/提交拆分

建议最小可审查序列：

1. POC（实验目录，无公共导出）。
2. shared contracts + tests。
3. compiler anchors/instrumentation + semantic tests。
4. analyzer core/cache + adapters。
5. runtime prelude/recorder/store + differential tests。
6. dev-server protocol + security tests。
7. lazy UI + E2E/a11y/i18n。
8. AI read-only task + contract tests。
9. real-host/performance/production/文档/Changeset。

每个提交可独立通过现有 required checks。结构迁移、功能语义、UI 大改和版本发布不得混在一个不可审查提交。

## 代码严谨性门禁

每一阶段必须满足：

- 新模块有单一 owner、窄接口、注入副作用和对应 dispose。
- 默认值、限额、endpoint、状态、消息、adapter ID 没有重复定义。
- fixture 只使用中性名称和保留域；第三方品牌、路径、域名、Store/function/field 名不进入仓库。
- 没有 `any` 逃避模型、非空断言掩盖证据缺失或字符串比较冒充 symbol resolution。
- 没有未使用 export、不可达分支、永久 TODO、无退出日期 flag 或被新实现取代的旧代码。
- recorder、cache、handler、AbortController、timer/listener 均有清理测试。
- analyzer/recorder/AI 失败不改变宿主业务行为或现有 SpotPatch 主链路。
- 每个“已支持”都有正例、负例、并发、安全和版本边界 fixture。

POC 临时代码必须在 D2 前删除或逐段迁移并证明旧路径无引用；不允许以注释保留备用实现。

## 候选 ADR

通过评审后，应把以下摘要加入 (见 doc-id:15-risks-adr)，编号以合并时中央文档为准：

### 候选决策 A：准确率优先，未知优于误归属

只有稳定 ID/符号/调用/数据边或 invocation evidence 才能建立确定关联。URL、时间、stack 和 AI 仅为候选诊断。

### 候选决策 B：request-origin 与 data-fed-by 分离

请求触发者和数据消费者是两类边，分别计算、展示和验收。

### 候选决策 C：静态图与运行时 observation 混合

静态图负责 declared/来源，runtime 负责 executed；任一单独都不构成完整产品。

### 候选决策 D：Node-only analyzer + adapter registry

图、AST 和缓存不进入浏览器；框架/数据层差异通过版本化 adapter 贡献标准 evidence。

### 候选决策 E：最早期小型 prelude，完整 Inspector 惰性加载

从页面加载起捕获与核心 Runtime 包体分离；production/disabled 构建零残留。

### 候选决策 F：shape-first、no-value、内存短驻留

公共报告没有原始 value 字段；不持久化 observation，不提供显示 secret 的开关。

### ADR-041：AI 是证据消费者，不是事实来源

复用现有 Agent/Provider，使用只读 task，输出与 report 隔离，不能升级 association。

### ADR-042：Vite 首发，Next 独立 Gate

Vite Beta 不能自动推导 Next/RSC/Server Action 支持。

### ADR-043：线性证据链优先于大型节点图

首版以列表、详情和纵向链路满足扫描、响应式和可访问性，不承担自由图编辑复杂度。

## 再次审视后的风险裁决

| 风险 | 严重度 | 当前裁决 |
| --- | --- | --- |
| composite DOM 无稳定 callsite | 阻断 | D1-A；不盲注入 prop；无法唯一则 component-level/possible |
| async provenance 串线 | 阻断 | D1-B；显式 transform；失败缩小 async 支持 |
| fetch Promise 观测改变 rejection | 阻断 | dispatch-only 为安全基线；result tap 独立证明 |
| response Proxy/getter 副作用 | 阻断 | 任意对象不遍历；仅安全来源 shape |
| prelude 晚于首请求/CSP | 高 | head-prepend + 真宿主门禁；能力不足明确显示 |
| 真实项目大量 `any` | 高 | consumed fields + safe runtime shape，不伪造 declared contract |
| 同 URL 多组件 | 高 | 只按 callsite/invocation；缺证据 unassigned |
| 表格由父/Store 提供 | 高 | 独立 data-fed-by 图与多文件 oracle |
| 外部后端数据库未知 | 中 | 永远 unknown；只有同仓 ORM 证据可升级 |
| AI hallucination | 高 | 独立结果、evidence validation、只读工具 |
| 包体/启动成本 | 高 | prelude/UI/analyzer 分层、惰性、独立预算 |
| 适配器扩张成硬编码 | 高 | import binding + registry + version fixtures；项目名只进 oracle |

## 当前最终建议

建议将当前结果作为 Vite + React 18 Beta 进入代码审阅与全量门禁，不直接宣称对任意项目完整覆盖。D1 的复合组件、异步 provenance 和 dispatch 非干扰核心门禁已经通过，因此可以在已声明支持语法内称为“证据化组件接口能力”；范围外必须继续展示 partial/unknown/unassigned。

AI、safe JSON shape、通用 upstream、Next 和大规模可移植 oracle 必须继续独立过 Gate。即使后续 Gate 失败，页面接口总览、静态声明依赖、参数/消费字段和 unassigned 请求仍可保留，但 UI 和市场文案不得把未知包装为已精确归属。
