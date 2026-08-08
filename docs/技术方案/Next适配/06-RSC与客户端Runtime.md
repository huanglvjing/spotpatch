---
doc-id: "next-06-rsc-runtime"
title: "Next.js RSC 与客户端 Runtime"
status: "active"
version: "0.2.0"
last-updated: "2026-08-09"
source-range: "Next.js Server/Client Components 与 instrumentation-client 官方调研；SpotPatch Runtime 适配提案；React Adapter 现状审计"
implementation-status: "planned"
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

Next 官方 `instrumentation-client` 在 HTML 加载后、React hydration 前执行；Bippy 也明确建议 Next 15.3+ 在此入口先安装 React DevTools hook。规划的 client entry 必须把同步 hook 安装与异步 Runtime bootstrap 分开：

```text
instrumentation-client import
  → sync import "bippy/install-hook-only"
  → async bootstrap config/token
  → load Runtime + React Adapter
  → create singleton controller/UI
  → React hydration/commit events continue feeding installed hook
```

同步入口只能静态导入最小 hook，不得读取配置、等待网络、动态 import、DOM ready 或创建 UI；Next 官方建议该入口初始化控制在 16 ms 内，因此 POC 必须单独测量同步路径。bootstrap 在下一异步阶段启动，失败只能禁用 SpotPatch并显示终端/浏览器开发诊断，不能抛出未捕获异常阻断业务 hydration。

## RSC 事实边界

App Router page/layout 默认是 Server Component。服务端组件渲染结果通过 HTML 与 RSC payload 送到浏览器，但浏览器不存在一棵与服务端源码一一对应的完整 Fiber 树。因此一次元素选择分为：

- **host JSX 源码位置**：由构建期 marker 提供；Server/Client Component 都可以是 exact。
- **浏览器 React 语义**：仅对客户端可见 Fiber 提供组件名和栈；Server Component 名称可能缺失。

该差异不降低 marker 的 exact 等级，也不能为了“栈更完整”伪造 Server Component 名称。来源与置信度值域继续由源码解析规范定义 (见 doc-id:06-source-resolution)。

## 选择场景

| 场景 | 计划主结果 | 允许降级 |
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
- Next 路由预取、RSC fetch 和业务网络请求不得被 SpotPatch 代理或记录。
- 多 root、Strict Mode、Fast Refresh 和 error overlay 不能创建第二个 Runtime。

状态机、picker、几何和 HMR 清理由既有规范管理 (见 doc-id:05-runtime-lifecycle)，Next 文档只规定框架事件如何触发现有入口。

## React 18/19

- 当前 `@spotpatch/react-adapter` 的 package peer 范围允许 React 18/19，但实现中的版本门禁只识别 React 18.2/18.3；因此“包可安装”不等于 React 19 已支持。Gate N2/N3 必须先统一版本能力判断并补真实 React 19 单测/E2E，完成前 Next + React 19 保持 planned。
- 不要求宿主把 `jsxImportSource` 改为 Bippy；这会改变整个项目编译语义并与其他 JSX runtime 冲突。
- React 19 不能提供 Fiber source 时，组件名/栈仍可在安全 adapter 支持范围内展示，源码坐标继续取 marker。
- hook 或私有 Fiber API 不兼容时，Adapter 返回 `supported: false`，不得让 Runtime、marker、DOM/CSS 和 Prompt 失效。
- 不读取 Server Component props、RSC payload 内部结构或 Next 私有 router store来“补全”上下文。

## Runtime Config

Next client entry 从 Sidecar bootstrap 取得与 Vite 等价的非敏感配置。公共字段和默认值不得在 Next client 中复制 (见 doc-id:03-public-api-models)。框架诊断只增加：

- framework = Next.js
- 已校验的 Next 版本
- bundler = Turbopack 或 webpack
- routerKind = App、Pages 或 hybrid（只用于诊断，不作为授权）

这些字段必须进入 typed config/schema 后才能使用；浏览器不能据此选择 Sidecar、root、Loader 或权限。

## Next 开发 UI 共存

- SpotPatch root 保持 Shadow DOM 和独立 overlay；不得修改 Next DevTools/错误 overlay DOM。
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
