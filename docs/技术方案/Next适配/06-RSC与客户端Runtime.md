---
doc-id: "next-06-rsc-runtime"
title: "Next.js RSC 与客户端 Runtime"
status: "active"
version: "0.5.0"
last-updated: "2026-08-26"
source-range: "Next.js Server/Client Components、数据链路 prelude、共享面板、React 18/19 身份与生产隔离"
implementation-status: "public-preview"
参考文献/依赖:
  - "03-public-api-models"
  - "05-runtime-lifecycle"
  - "06-source-resolution"
  - "07-dom-css-collection"
  - "08-code-prompt"
  - "10-ui-diagnostics"
  - "next-08-testing-delivery"
---

# Next.js RSC 与客户端 Runtime

## 初始化顺序

Next 官方 `instrumentation-client` 在 HTML 加载后、React hydration 前执行；Bippy 也明确建议 Next 15.3+ 在此入口先安装 React DevTools hook。当前 client entry 把同步 hook 安装与异步 Runtime bootstrap 分开：

```text
instrumentation-client import
  → sync import "bippy/install-hook-only"
  → sync install dispatch-only data-flow prelude（仅 development + enabled）
  → async bootstrap config/token
  → load Runtime + React Adapter + shared data-flow panel extension
  → create singleton controller/UI
  → React hydration/commit events continue feeding installed hook
```

同步入口只静态导入最小 hook和可被生产 alias 为 no-op 的 data-flow helper，不读取 bootstrap、等待网络、DOM ready 或创建 UI。prelude 使用共享 `installDataFlowPrelude`，只包装 browser dispatch；面板仍随异步 bootstrap 按能力加载。入口记录同步初始化耗时，bootstrap 的请求、响应大小、`no-store`、schema 和 mount 都 fail-closed 为稳定诊断码，失败不会抛出未捕获异常阻断业务 hydration。同步总路径必须在 required browser matrix 中满足 16 ms 预算。

## RSC 事实边界

App Router page/layout 默认是 Server Component。服务端组件渲染结果通过 HTML 与 RSC payload 送到浏览器，但浏览器不存在一棵与服务端源码一一对应的完整 Fiber 树。因此一次元素选择分为：

- **host JSX 源码位置**：由构建期 marker 提供；Server/Client Component 都可以是 exact。
- **浏览器 React 语义**：仅对客户端可见 Fiber 提供组件名和栈；Server Component 名称可能缺失。

该差异不降低 marker 的 exact 等级，也不能为了“栈更完整”伪造 Server Component 名称。来源与置信度值域继续由源码解析规范定义 (见 doc-id:06-source-resolution)。

## 选择场景

| 场景 | 主结果 | 允许降级 |
| --- | --- | --- |
| Server Component 直接写 intrinsic DOM | marker exact | React stack 只显示可见客户端边界或不可用 |
| Client Component 直接写 intrinsic DOM | marker exact + React 语义 | Fiber source 缺失时仍保留 marker |
| Server Component 渲染 Client Component | host 所在文件 marker exact | 栈不声称包含完整 Server 调用链 |
| `next/image`/第三方组件内部生成 DOM | 业务调用点未必有 host marker | DOM ancestor、客户端 Fiber probable 或 unknown，必须显示原因 |
| Portal | marker 跟随实际 DOM，组件语义按客户端 Fiber | Portal 跨容器不改变 root 文件授权 |
| Suspense/streaming fallback | 选择当时 DOM 对应 marker | 内容替换后旧 Element 引用释放，目标源码快照保留 |
| RSC client navigation | 新 DOM 使用当前 Session marker | 旧页面 Job 不自动改绑新节点 |

## App Router 与 Pages Router

Runtime 本身不依赖 `next/router`、`next/navigation` 或宿主 React Context。它继续在 Shadow DOM 中使用原生 DOM 与公共协议：

- App/Pages 共用同一个 singleton key、picker、collectors、Prompt 和 Agent UI。
- 路由变化通过 DOM 生命周期和可选的 `onRouterTransitionStart` 触发几何/目标有效性检查，不读取业务 route state。
- Next 路由预取和 SpotPatch 自身请求必须在 recorder 入口排除。浏览器业务 `fetch`/XHR 只记录 dispatch 元数据；RSC/server fetch 不可见，也不得从 Next 内部 transport 反推。
- 多 root、Strict Mode、Fast Refresh 和 error overlay 不能创建第二个 Runtime。

状态机、picker、几何和 HMR 清理由既有规范管理 (见 doc-id:05-runtime-lifecycle)，Next 文档只规定框架事件如何触发现有入口。

## React 18/19

- React 18.2/18.3 可以使用已验证的 Fiber 语义和 compiler component registration。
- React 19 只允许 registration-backed 身份：Adapter 从选中 DOM 沿可见 owner 链查找已由 compiler 登记到 WeakMap 的业务 component type；不得读取或信任 `_debugSource` 等版本私有坐标。
- React 19 没有登记身份时必须回退 marker 坐标或 unknown，不能用 displayName、URL、时间或相邻 Fiber 猜组件。该受限路径不等于完整 React 19 Fiber 语义支持。
- 不要求宿主把 `jsxImportSource` 改为 Bippy；这会改变整个项目编译语义并与其他 JSX runtime 冲突。
- React 19 不能提供 Fiber source 时，组件名/栈仍可在安全 adapter 支持范围内展示，源码坐标继续取 marker。
- hook 或私有 Fiber API 不兼容时，Adapter 返回 `supported: false`，不得让 Runtime、marker、DOM/CSS 和 Prompt 失效。
- 不读取 Server Component props、RSC payload 内部结构或 Next 私有 router store来“补全”上下文。

## Runtime Config

Next client entry 从 Sidecar bootstrap 取得与 Vite 相同 schema 的非敏感配置。公共字段、data-flow limits 和默认值不得在 Next client 中复制 (见 doc-id:03-public-api-models)。data-flow panel 的注册函数属于 `@spotpatch/runtime` 共享子入口；Vite 与 Next 都只调用这一函数，不能各自拼装 extension。框架诊断只增加：

- framework = Next.js
- 已校验的 Next 版本
- bundler = Turbopack 或 webpack
- routerKind = App、Pages 或 hybrid（只用于诊断，不作为授权）

这些字段必须进入 typed config/schema 后才能使用；浏览器不能据此选择 Sidecar、root、Loader 或权限。

## Next 开发 UI 共存

- SpotPatch root 保持 Shadow DOM 和独立 overlay；不得修改 Next DevTools/错误 overlay DOM。
- Next/Proxy 为页面生成唯一脚本 nonce 时，Runtime 只读取 DOM 中该唯一值并赋给自身 Shadow DOM 样式；不能要求宿主增加 `unsafe-inline`，也不能在 nonce 缺失或冲突时伪造一个值。
- picker 必须排除 SpotPatch 自身，并对 Next error overlay、dev indicator 和浏览器原生 picker 做专项命中测试。
- z-index 只保证活动选择交互可见，不永久覆盖严重 Next 编译错误；出现 fatal overlay 时应暂停 picker并给出诊断。
- Hydration error、RSC error 和 Next Fast Refresh 状态不能被 SpotPatch 捕获后吞掉。
- 工作台位置、焦点、双语、多个目标和 Agent 审阅继续复用现有 UI 规范 (见 doc-id:10-ui-diagnostics)。

## 上下文采集

DOM/CSS、源码片段和 Prompt 仍分别引用既有规则 (见 doc-id:07-dom-css-collection)、(见 doc-id:08-code-prompt)。Next 特有边界：

- `data-nextjs-*`、RSC 内部标识和开发 overlay 属性不自动进入 Prompt；只有公共 DOM 清洗允许的业务属性可保留。
- `<style jsx>`、CSS Modules、Tailwind、CSS-in-JS 和 Next font 仍以浏览器实际规则/computed 为准，不猜测原始 TypeScript 位置。
- Next server source、Route Handler、Server Action、环境变量和 RSC payload 不因选择 DOM 被自动读取。
- `next/image` 的优化 URL 可出现在清洗后的 DOM，但查询参数中的 token/secret 仍按公共脱敏规则处理。

## 完成判定

不能用“面板能打开”作为 Runtime 适配成功。必须分别证明：预 hydration hook、Server host marker、Client Fiber 降级、RSC 导航、Fast Refresh、Portal/Suspense、双语多目标、打开编辑器、Agent review 和生产零残留 (见 doc-id:next-08-testing-delivery)。

当前本地证据已覆盖 Server/Client host marker、bootstrap schema、Runtime singleton、Next 16 双 bundler development 编译、webpack directive/import 顺序、source-context 读取和 Turbopack 干净生产 build/start。此前同一 packed App Router fixture 的真实页面已展示直接 `fetch` 与 Axios/TanStack Query transitive 静态报告；本轮后续浏览器连接不可用，因此 React 19 全局 renderer 修复后的组件身份尚未完成最终交互复验。RSC 导航、Portal/Suspense、编辑器/Agent 全链路和正式浏览器矩阵仍未完成。

数据链路代码已经进入公共预览，但只有以下证据同时存在时才可把产品状态提升为正式支持：浏览器 module 的 fetch/Axios/React Query 静态与 dispatch 证据、React 19 registration-backed 最近业务组件、同 URL 多组件不误归属、页面 unassigned、HMR 旧版本拒绝、App/Pages 双 bundler，以及 HTML/RSC/client/server/static/standalone 无可执行残留。
