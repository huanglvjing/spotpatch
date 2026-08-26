---
doc-id: "data-flow-13-beta-implementation"
title: "组件数据链路 Beta 实现状态与使用手册"
status: "active"
version: "1.3.0"
last-updated: "2026-08-26"
source-range: "SpotPatch 组件数据链路共享实现、Vite 已验证基线、Next.js 0.x 公共预览与发布 Gate"
参考文献/依赖:
  - "data-flow-00-index"
  - "data-flow-02-repository-audit"
  - "data-flow-04-static-attribution"
  - "data-flow-05-runtime-observation"
  - "data-flow-07-model-protocol-config"
  - "data-flow-08-ui-interaction"
  - "data-flow-10-security-performance"
  - "data-flow-11-testing-acceptance"
  - "data-flow-12-delivery-adr"
  - "data-flow-14-special-adapters"
---

# 组件数据链路 Beta 实现状态与使用手册

本文是当前代码实现的事实源。`00`–`12` 保留完整目标设计、约束和后续 Gate；其中尚未进入代码的部分不能因为出现在设计文档里就被视为已支持。

## 当前结论

当前工作区已完成一个可运行的 **Vite + React 18 开发环境 Beta**：用户选中真实 DOM 后，SpotPatch 能优先定位最近的已登记业务 React 组件，静态分析该组件可证明的请求链，展示接口 method/origin/path、参数键、条件、源码实际读取的响应字段和可证明的数据去向；页面会话内真实发生的 `fetch`/XHR dispatch 会通过稳定 callsite、sourceVersion 和 invocation 证据合并为“本次会话已实际请求”。

Next.js 适配已按该契约进入 **0.x 公共预览实现**。Next 不另建 analyzer、recorder、merger、DTO 或面板；它只负责把同一个 compiler/runtime/dev-server 实现接入 Turbopack、webpack、Sidecar 和 `instrumentation-client`。这意味着“Next 与 Vite 功能一致”指相同的证据模型、支持语法、接口卡片和安全边界，不表示浏览器能够观测 RSC、Server Action 或 Route Handler 的服务端执行，也不表示 Next required 兼容矩阵已经完成。

本轮进一步补齐组件 render 内直接 `fetch`、concise JSX handler、React Query v3/TanStack QueryFn trigger，以及实验性 tRPC logical operation adapter。tRPC 的“已观测”表示 procedure 已进入透明 tRPC Link，不表示某个独立 HTTP 请求已成功；batch、stream、WebSocket、proxy upstream 和后端接收事实必须分层显示。完整边界见 (见 doc-id:data-flow-14-special-adapters)。

准确性承诺是“**有证据才归属，无法证明就不归属**”，不是“任何项目任何写法均自动命中”：

- `proven + direct/transitive` 才是当前 Beta 的确定组件关联。
- 实际发生但缺少同一稳定证据的请求进入页面接口并标记 `unassigned`，不会按 URL 或时间猜组件。
- 静态找到但本会话未执行的请求标记 `declared-not-observed`，不会伪装成“已请求成功”。
- Runtime 只记录 dispatch 事实；不读取、clone 或解析 `Response`，所以响应只展示源码消费字段，不承诺运行时完整 JSON shape。
- Query Hook/options 的创建不等于发网；cache hit、`enabled:false` 或去重时保持 declared。tRPC logical dispatch 与底层 HTTP/XHR observation 也不按时间或 URL 强行一对一合并。
- 外部后端数据库和跨服务持久化仍是 unknown；客户端 React state、Zustand、storage、callback prop 只有存在可证明 def-use 边时才展示。

因此，在下面列出的支持语法与已验证宿主范围内，系统可以对“报告出来的关联”做到确定性；对范围外代码，正确行为是 partial、unknown 或 unassigned，而不是返回一个看似完整但可能错误的接口。

## 启用方式

底层公共配置采用 opt-in 默认值。Vite `setup/init` 与 Next `init` 都会写入同一公开启用项；手工接入时两端配置语义保持一致：

```ts
import { spotPatch } from "@spotpatch/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [spotPatch({ dataFlow: {} }), react()],
});

// next.config.ts（Next 0.x 公共预览，由 init 生成）
export default withSpotPatch({ dataFlow: {} })(nextConfig);
```

当前唯一公开运行模式是安全的 dispatch-only 模式；下面两类选项故意没有公开：

- `safe-json-shape`：未通过不干扰宿主 Promise/stream/rejection 的完整门禁，因此不读取响应体，也不提供假开关。
- `aiAssistance`：当前没有实现 data-flow 专用的准确上下文、只读任务和证据校验闭环，因此没有一个只能显示“未配置”的死配置。AI 设计继续由 `09` 约束，正式实现前保持 disabled。

手工配置时，关闭方式为省略 `dataFlow` 或显式传入 `dataFlow: false`。初始化器只能写公开的共享 `DataFlowOptions`，不能发明框架专属字段。关闭状态不注入 recorder、不启用 analyzer、不显示数据链路页签；生产构建无论配置值如何都必须完全关闭。

数据链路不依赖 `.env.local`。该文件只用于可选 AI Provider；要求用户为了静态接口分析或浏览器 dispatch 观测配置本地密钥属于实现错误。

## 用户操作与界面

启用后，现有工作台增加以下页签：

1. **数据链路**：当前选中业务组件的静态依赖和本会话运行时证据。
2. **页面接口**：当前已选页面范围的静态接口，以及实际发生但无法归属组件的请求。
3. **诊断**：继续复用现有诊断区；分析截断、源码过期或能力不可用不得静默吞掉。

每张接口卡片展示：

- HTTP method 与清洗后的 origin/path；query 只展示键名，不展示值。
- `本次会话已实际请求` 或 `代码声明，尚未观测`。
- proof 和 association 状态。
- 参数位置、参数键、推导类型、敏感标记。
- 源码实际读取的响应字段；当前不伪造 runtime transfer/shape/status。
- 可证明的数据去向，如 `react-state:rows`、`zustand:user`、`local-storage:*` 或 `callback-prop:onSuccess`。
- 静态与运行时证据数量。

选择目标后报告自动加载。用户触发页面交互后点击“刷新证据”，Runtime 仅在完整匹配当前 route/source/callsite 的情况下把依赖升级为 observed。目标切换、删除、恢复和异步返回均受 revision 校验，旧报告不能覆盖新目标。

## 组件如何精确定位

当前实现不是通过按钮文字、CSS 类名、URL 相同或请求时间接近来猜测。

```text
业务组件函数
  └─ compiler 注册 componentSourceId + sourceVersion 到 WeakMap
      └─ React Fiber bridge 从选中 DOM 向 owner 链查找
          └─ 优先返回最近的已登记业务组件 type
              └─ dev-server 用同一 Registry 校验 ID 与源码版本
```

这一规则专门处理 Ant Design `<Button>` 一类复合组件：真实命中的 DOM 可能是组件库内部 `<button>`，而 `_debugSource` 也可能只指向业务 JSX callsite；Runtime 不把组件库内部 Fiber 当作业务组件，而是要求其 component type 已被当前开发构建登记。对于受支持的 `memo`/`forwardRef` 组合，Registry 只在标准 React `$$typeof` 标记匹配后沿 wrapper 的 `type`/`render` 自有数据属性登记同一稳定身份，且不执行 getter、不修改函数对象；普通对象或函数偶然存在同名属性不会被展开。这避免最近的 `MemoPanel` 因 wrapper identity 不同而错误回退到外层 `App`。HMR 后 Registry 原子替换旧 anchor；旧 `sourceVersion` 请求返回冲突，不尝试映射到“差不多”的新位置。

当 exact component identity 不可用时，客户端才使用已授权的 fileId/line/column 作为静态分析回退。该回退仍经过 realpath、项目根目录和 Source Registry 校验。

## 请求如何归属

compiler 在同一遍源码变换中生成稳定 component/trigger/request anchor，并在支持的 trigger 边界创建 invocation token；请求 dispatch 时 recorder 保存：

```text
componentSourceId
+ triggerCallsiteId
+ requestCallsiteId
+ sourceVersion
+ routeEpoch
+ method/path
```

merger 只有在 freshness 为 current，且 request callsite、sourceVersion、method 以及 HTTP path 或 RPC operation 全部一致时才合并；静态 HTTP 已有 origin 时还必须与观测 origin 一致。共享 transitive callsite 必须同时精确匹配 componentSourceId 与 triggerCallsiteId。导入的 JSX handler 由 compiler 注入“每次调用新建 token”的 trigger wrapper，因此两个组件复用同一请求函数时不会因 callsite 相同而同时升级为 observed。运行时只见到相同 URL、只见到相邻时间或只见到相同组件名均不足以建立关联。

组件函数每次 render 现在也有与 analyzer 对齐的独立 trigger，直接请求及同步进入自定义 Hook 的请求可携带 render provenance。React Query queryFn 和 concise JSX callback 只有真正被调用时才创建 trigger token。tRPC 则由开发态自动前置的透明 Link 记录 procedure path/type；动态 links 配置不能安全插入时在 Vite development 日志生成去重 diagnostic，不猜测已调度状态。该 compiler diagnostic 当前尚未投影进组件报告 UI。

静态 URL 没有 origin、但精确匹配的 observation 只有一个唯一 origin 时，merger 会把这个已观测 origin 补入卡片，因此用户可直接看到类似 `https://api.example.test/auth/session/query` 的完整清洗接口；若同一精确链路观测到多个 origin，则保留 path 且不选择任何一个 origin。

静态 analyzer 则使用 TypeScript Program 与 symbol identity，从选中组件的事件/effect 根沿本地函数、导入函数和 Store action 追踪到请求调用点。结果携带源码 anchor、import/symbol/call/data-binding evidence 和 completeness；达到深度、模块、调用点或时间预算时报告 partial。

## 当前支持矩阵

| 维度 | 当前 Beta 支持 | 明确边界 |
| --- | --- | --- |
| 宿主 | Vite 5、6、7 development server；Next 0.x 公共预览的浏览器 Client Component | Next 16 App Router 单一 packed fixture 已有实现证据；Next 15、Pages/hybrid、完整 OS/browser 矩阵未完成；production 不注入 |
| React | 18.2、18.3；函数组件 | React 19 仅允许 compiler registration-backed 组件身份；不信任 Fiber 私有源码字段；class component 不在声明内 |
| 源文件 | `src` 下 `.js/.jsx/.ts/.tsx`，受统一 include/exclude 管理 | 项目根外、未登记、排除文件不分析 |
| 组件形态 | 命名函数、命名函数表达式/箭头；React 命名 import 的 `memo`/`forwardRef`（含别名） | `React.memo` namespace 写法、匿名 default、generator 未声明支持 |
| trigger | render、块体/concise/导入 JSX handler、`useEffect/useLayoutEffect`、Query queryFn、同步/`await` 调用 | module scope、任意第三方 scheduler、选择目标到具体 trigger 的报告过滤尚未完整接入 |
| async 传播 | lexical `await`、`setTimeout/setInterval`、Promise `then/catch/finally` callback | 任意第三方调度器、Worker、跨 realm 不推断 |
| 请求识别 | global/`window`/`globalThis`/`self.fetch`；Axios import/create 常用 method；tRPC 常见 procedure terminal | fetch alias、Axios callable/interceptor、GraphQL、SWR/RTK Query 等尚未完整实现 |
| Query | React Query v3 positional queryFn；TanStack `{ queryFn/mutationFn }` 直接写法 | `useQueries`、QueryClient 全矩阵、动态 spread 与 cache 内容未承诺 |
| tRPC | procedure/输入键/消费字段静态报告；直接 links 数组透明 Link logical dispatch | 当前为实验性语法/结构测试；真实 v10/v11、batch/stream/ws 发布矩阵未完成 |
| 运行时 | `fetch`、XHR browser dispatch；tRPC logical Link dispatch | 不替换 XHR constructor；不读取 response body/input/result；不标 success/status/duration |
| 参数 | 静态 path/query/body/header key、条件 URL 分支、敏感键 | 默认无原始 value；动态不可解析部分保留表达式模板/unknown；分支与字段数组达到集中上限时返回 partial |
| 响应 | 源码 consumed fields | 无 OpenAPI/类型或安全 tap 时，不宣称完整返回结构 |
| 数据去向 | React state、Zustand set、storage、callback prop 的已证明 binding | Redux/Query/SWR/Apollo 等没有专用 adapter 承诺 |
| 页面总览 | 已分析目标的静态依赖 + 当前 route 的 unassigned 请求/逻辑 operation | 不是浏览器全部 Network 资源替代品；浏览器 URL 不自动等于 proxy upstream |

## 仓内可移植项目验证

产品代码、文档和测试不保存第三方项目的品牌、路径、域名、Store 名或真实接口。analyzer oracle 在操作系统临时目录创建中性多模块源码，当前覆盖四类关键链路：

| 场景 | 可证明结果 |
| --- | --- |
| Store 间接认证 | 条件分支 `POST /auth/email/login` 与 `POST /auth/account/login`，关联为 transitive |
| 会话轮询 | effect/timer 请求 `/auth/session/query`；参数 `session_id/state`；消费 `data.session/data.token`；去向含 callback 与 React state |
| 模型表格 | `GET /models`；参数 `page/pageSize/name`；消费 `data.list/data.total`；去向 `react-state:rows/total` |
| React Query 状态轮询 | `POST /payments/status`；参数 `orderId`；静态保持 declared，不能因 Hook 存在而伪报 observed |

这些测试证明跨模块、生命周期和数据供给链可以被确定性识别，也证明同页面请求不能仅凭时间或 URL 相似度归给按钮。它们只证明已声明的仓内 fixture 支持范围，不代表任意外部项目已经达到全调用点覆盖。

## 协议与安全

新增只读 endpoint：

- `POST /__spotpatch/v1/data-flow/component-report`
- `POST /__spotpatch/v1/data-flow/page-report`

组件请求接受二选一：

```ts
{ schemaVersion: 1; componentSourceId: string; sourceVersion: string }
```

或：

```ts
{ schemaVersion: 1; fileId: string; line: number; column: number; sourceVersion?: string }
```

页面请求只接受有界 `targets` 数组，每个 target 使用同一严格结构。多组件聚合后会再次经过共享 collection limiter，依赖、evidence、diagnostic、source version、参数、消费字段与 query key 均不会越过公共 Schema 上限；被截断部分产生明确 diagnostic，不返回结构上无效的 DTO。endpoint 复用现有 loopback/Host/Origin/session token/JSON/body-limit/no-store/error-envelope 安全边界；浏览器不能提交绝对路径、root、glob、adapter 或分析预算。

公开 DTO 没有 raw `value` 字段。Runtime URL 只保留 origin、pathname 与 query key；body、headers、cookie、Authorization、stack、Response、Fiber 和函数引用都不进入 observation。SpotPatch 自身 `/__spotpatch/v1` 请求在 recorder 入口即排除，避免页面接口被内部流量污染。

observation 只在当前页面内存的双上限 ring buffer 中短驻留，并同时受 TTL、条目数和字节数约束。路由变化把旧记录标为 `stale-route`；dispose 只恢复自己安装且仍归自己所有的 wrapper，不覆盖其他工具后装的 wrapper。

## 代码组织与复用

| 模块 | 单一职责 |
| --- | --- |
| `packages/shared/src/model/data-flow.ts` | 不可变 DTO、Zod Schema 与状态集合 |
| `packages/shared/src/model/data-flow-adapters.ts` | compiler/analyzer 共用的 Query/tRPC adapter 语法清单；清单本身不构成版本支持声明 |
| `packages/shared/src/model/data-flow-limits.ts` | Node/浏览器共用且不依赖 Zod 的唯一预算常量源 |
| `packages/shared/src/model/data-flow-budget.ts` | Node 报告与浏览器合并报告共用的集合上限、证据引用裁剪和显式截断诊断 |
| `packages/shared/src/data-flow-runtime.ts` | prelude 可用的轻量 shared 子入口，避免把 Zod/UI 带入前置包 |
| `packages/compiler/src/data-flow-instrumentation.ts` | 稳定 anchor、component registry 注入、invocation/request frame 传播 |
| `packages/analyzer` | Node-only TypeScript symbol/def-use/request analyzer 与 cache |
| `packages/dev-server/src/server/data-flow-http.ts` | 严格只读 endpoint 与 analyzer 生命周期 |
| `packages/runtime/src/data-flow` | recorder、ring buffer、route/source freshness、证据 merger |
| `packages/runtime/src/data-flow-entry.ts` | recorder/merger 独立浏览器子入口 |
| `packages/runtime/src/data-flow-panel-entry.ts` | 面板与 Runtime 之间的窄扩展契约入口 |
| `packages/runtime/src/ui/data-flow-panel.ts` | 现有 Shadow DOM 工作台的数据链路投影与页签导航 |
| `packages/react-adapter` | DOM/Fiber 到已登记业务 component type 的隔离桥；React 19 只接受 compiler 注册身份 |
| `packages/vite` | Vite development-only 构建与服务承载，不拥有数据链路算法 |
| `packages/next` | Next development-only Loader、原子注册、pre-hydration 入口和生产 no-op，不拥有数据链路算法 |

默认值和 Node 限额只由 options resolver 与 `DEFAULT_DATA_FLOW_LIMITS` 维护；`createRuntimeDataFlowConfig` 显式投影浏览器实际需要的 observation/report 四项预算，避免把 graph、协议请求或未来能力字段发送到页面。endpoint 只由 shared 常量派生；ID/sourceVersion 使用 compiler 公共 helper；UI 不重新实现关联算法。测试 oracle 使用中性可移植源码，产品路径和测试均没有第三方项目硬编码。

面板不是核心 Runtime 的死代码：Vite 只在 `dataFlow:true` 时让客户端导入独立 panel/prelude 虚拟模块。当前面板随启用后的 Runtime bootstrap 加载，不声称点击页签后才动态下载。三项发布预算分别为核心 Runtime `<42 KiB gzip`（覆盖 Linux/macOS Node zlib 的实测差异）、prelude `<8 KiB gzip`、panel `<10 KiB gzip`；功能体积继续按独立 bundle 记账，不以无限放宽门禁掩盖回归。

## 已执行验证与门禁

发布候选必须持续通过以下验证；任何代码变化都要重新执行，不能把历史记录当永久绿灯：

- shared 严格 Schema、协议版本、请求结构和运行时配置。
- compiler 坐标、render/concise/Query trigger、tRPC Link 注入、async 返回值、Promise callback identity、wrapper、binding 冲突与诊断。
- analyzer global fetch/Axios/tRPC/React Query、conditional URL、参数、消费字段、Zustand、跨模块/cache invalidation 与可移植 oracle。
- recorder Promise identity、tRPC pass-through result、并发 provenance、每次 trigger 新 token、callback receiver、query key/内存预算、wrapper 共存、内部流量排除与 route freshness。
- merger HTTP 条件分支与 RPC operation 精确匹配、transitive component + trigger 双校验、唯一 origin 升级、origin 冲突不猜和 unassigned 分流。
- dev-server disabled/stale/boundary/body limit/敏感值与绝对路径不泄漏。
- 聚合报告、嵌套条件 URL 与运行时 observation 溢出均返回符合公共 Schema 的确定性前缀和显式诊断。
- Vite 5 + React 18.2、Vite 6 + React 18.3 的真实开发服务器接口兼容验证。
- Next 15 + React 18 与 Next 16 + React 19 的 App/Pages、Turbopack/webpack 真实开发服务器验证；两端必须对同一中性 fixture 产生等价静态 DTO。
- Next browser module 的 `fetch`、Axios、React Query/TanStack Query dispatch 观测；RSC/Server Action/Route Handler 只保留 declared/unknown，不得伪装 observed。
- Next HMR 原子替换 component anchor，旧 `sourceVersion` 不得覆盖当前 Registry。
- Next 生产构建对 HTML、RSC、client、server、static、standalone 和 source map 做零残留扫描，并证明 Sidecar/data-flow endpoint 未启动。
- Playwright 真 AntD Button 选择、静态报告、实际 fetch 观测、敏感 query value 不显示、内部 endpoint 不进入页面接口。
- 独立 prelude gzip 预算、Runtime 客户端预算、transform 性能预算和 production leakage 扫描。
- `publint` 与 Are The Types Wrong 对所有发布包和 `data-flow-runtime`、`data-flow`、`data-flow-panel` 子路径的 Node 10/16、CJS、ESM、bundler 解析验证。

### 2026-08-26 当前 Next 实现证据

以下证据只支持“0.x 公共预览已实现”，不能替代上面的 required matrix：

- 从本工作区打包全部 `@spotpatch/*` tarball 后，在独立 Next 16.3/React 19.2 App Router fixture 冷安装，未读取 workspace 私有源码路径。
- Turbopack 真实页面中，选中 Client Component host 元素后可见同一数据链路/页面接口面板；静态报告同时列出直接 `fetch` 与经 Axios service、TanStack Query 到达的 transitive 请求，包含 query key、源码消费字段与 React state 去向。
- webpack 真实 development 编译已证明 helper import 保持在 `"use client"` directive 之后，并在 rule 入口排除 `.next`/`node_modules`，不再向 Sidecar发送第三方模块注册请求。
- Turbopack 干净 production build/start 已证明页面 200、SpotPatch 私有 bootstrap 404；业务 HTML、RSC、client/server/static/source map 未发现 marker、recorder、panel、私有路由或 secret。Next 序列化配置只允许保留两个指向 side-effect-free noop 的模块 alias，不把这种审计元数据误报为可执行 Runtime。
- React 19 的独立 bippy 模块实例问题已由全局 DevTools renderer 发现逻辑与单测修复；修复后的最终浏览器组件身份复验、Next 15、Pages/hybrid、standalone/static export 和跨 OS 矩阵仍待完成。

2026-08-13 发布候选首次本地验证曾全部通过，但远端 Linux 揭示了外部目录测试依赖和 gzip 跨平台差异；这两项已改为自包含 oracle 与带实测平台余量的 42 KiB 核心 Runtime 上限。当前是否可发布必须以最新提交的完整本地验证和远端 CI 结果为准，本文不记录会随测试增减而失真的文件/用例总数。

任何后续代码变化都必须重新执行 `format:check`、`lint`、`typecheck`、unit、build、compatibility、performance、E2E、production leakage 与 package validation；本页不能替代测试命令和远端 CI 的实际结果。

## 未完成与后续 Gate

下列内容没有在本 Beta 中实现，界面、README 和发布说明不得暗示已经存在：

- AI Explain/Assist Find 的准确上下文预览、只读工具与证据回验。
- safe JSON response shape/result tap、status/duration/success 观测。
- RSC、Server Action、Route Handler、Worker、GraphQL 和其他服务端/RPC 运行时观测。Next 浏览器 Client Component 接入不扩大这一边界。
- parent-prop 跨组件 `upstream/data-fed-by` 的通用完整算法。
- Query `useQueries`/QueryClient 全矩阵、Redux、SWR、Apollo 等版本化 adapter。
- tRPC 真实 v10/v11、batch/stream/WebSocket host 矩阵与逻辑 operation/物理 transport 批组协议。
- 选择目标 JSX trigger 的报告过滤、同组件多 DOM instance 区分，以及 browser URL/Vite proxy upstream 分层展示。
- 更大规模、公开可复现的多框架 callsite 与 Table 发布级 oracle。
- 完整 a11y/读屏专项、CSP 全矩阵和全部 OS/browser 组合。

这些缺口不会通过 AI、URL 相似、时间邻近或项目硬编码填补。新增能力必须先补 fixture/oracle、证据升级规则、安全预算和回归门禁，再扩大支持声明。
