---
doc-id: "next-03-integration-lifecycle"
title: "Next.js 接入 API 与生命周期"
status: "active"
version: "0.4.0"
last-updated: "2026-08-09"
source-range: "Next.js next.config phase、instrumentation-client、CLI 与环境变量；SpotPatch 本地预览接入实现"
implementation-status: "local-preview"
参考文献/依赖:
  - "03-public-api-models"
  - "09-local-protocol-security"
  - "17-model-provider-credentials"
  - "next-07-security-production"
---

# Next.js 接入 API 与生命周期

## 用户入口

正式发布后，Next 用户只需显式安装一个入口包：

```bash
npm install --save-dev @spotpatch/next
```

当前仓库中的包仍是 `0.0.0` 且未发布，上述命令不是当前可用性声明；真实宿主营销站通过本地 pnpm workspace 注入源码包。当前配置入口为高阶配置包装器：

```ts
import type { NextConfig } from "next";
import { withSpotPatch } from "@spotpatch/next";

const nextConfig: NextConfig = {
  // 宿主已有配置
};

export default withSpotPatch()(nextConfig);
```

AI 选项复用现有公共类型和凭据边界；真实 Key 仍只能由服务端环境变量提供，不能成为函数参数或 `NEXT_PUBLIC_*` 值 (见 doc-id:03-public-api-models)、(见 doc-id:17-model-provider-credentials)。Next 不复制另一套 AI 配置。

当前导出类型：

```ts
type NextConfigInput =
  | NextConfig
  | ((phase: string, context: NextConfigContext) => NextConfig | Promise<NextConfig>);

declare function withSpotPatch(
  options?: NextSpotPatchOptions,
): (config?: NextConfigInput) => NextConfigInput;
```

`NextSpotPatchOptions` 由 `@spotpatch/next` 导出，组合公共子类型但不从 `@spotpatch/vite` 导入。字段所有权和默认值归属 (见 doc-id:03-public-api-models)。包装器必须同时接受对象、同步函数和异步函数，先解析宿主结果再做无损组合。不得改变宿主函数的 phase/context，不得丢失 Promise、插件顺序、webpack 回调、rewrites 对象形态或未知 Next 配置字段。

## 一次性初始化

Next 没有 Vite `transformIndexHtml` 等价能力。为了在 React hydration 前安装 hook，项目需要一个 Next 官方文件约定入口：

```ts
// instrumentation-client.ts；使用 src 目录时位于 src/instrumentation-client.ts
import "@spotpatch/next/client";
```

不要求用户手工猜测路径，包提供：

```bash
npm exec -- spotpatch-next init
npm exec -- spotpatch-next check
```

`init` 的设计要求：

- 先只读识别 root/src、现有 instrumentation、next.config 类型和 package scripts。
- 生成完整变更预览后再执行事务式写入；任一文件无法安全解析时零写入并给出人工步骤。
- 已有 `instrumentation-client` 时只增加唯一静态 import，保持注释、其他 import/export 和路由追踪逻辑。
- 已存在正确接入时幂等退出；不得重复 import、重复包装或重复改 script。
- 不覆盖动态/不可证明安全的 next.config，不使用正则替换 TypeScript。
- 不写 `.env`、Key、模型或 URL；不创建 Git commit。
- `check` 只读验证接入、版本、Sidecar launcher、生产 noop 和冲突配置，可用于 CI。

初始化器能安全支持的配置语法范围必须通过 fixture 明示；超出范围时 fail-closed，不以“尽量改一下”破坏宿主配置。

## 开发命令

推荐脚本：

```json
{
  "scripts": {
    "dev": "spotpatch-next dev"
  }
}
```

CLI 使用本项目安装的 Next binary，不下载或调用全局 Next，不启用 shell。端口、构建器和 Next 认可的其他 `next dev` 参数按顺序透传；浏览器和模型不能影响这些参数。首版安全边界要求 Next 仅监听 loopback：用户未传 hostname 时 CLI 显式补入 loopback，显式非 loopback 的 `-H/--hostname` 或等价值直接拒绝；不得按 Next 当前的 `0.0.0.0` 默认值启动。

## CLI 与配置的受控握手

AI URL、模型与环境变量名定义在 `withSpotPatch(...)` 中，父 CLI 不能通过读取命令行直接取得；同时，CLI 不得自行再次求值 `next.config`，否则会重复执行用户配置副作用，也无法等价复用 Next 的 phase/context 与 `.env*` 加载顺序。因此采用单向受控握手：

1. CLI 通过 `process.execPath` 启动解析到的本地 Next CLI，`shell: false`，并先绑定 `127.0.0.1` 随机端口上的 sealed Sidecar。
2. Next 按官方流程加载 `.env*` 并求值 `next.config`。
3. `withSpotPatch` 仅在 `PHASE_DEVELOPMENT_SERVER` 中验证并规范化可序列化选项；需要凭据时只按配置声明从当前服务端 `process.env` 解析值。
4. 由于 Next 16 可能在 CLI 后代进程中求值配置，包装器通过同一 sealed listener 的独立内部配置路径发送一次认证消息，而不是假设存在直接父子 `process.send`；消息可包含按环境引用解析出的 Provider Key，但不得包含浏览器 session/internal registration secret，也不得把 Key 写回 Next config、Loader options、日志或浏览器。
5. 父 CLI 完成 schema、root 和安全校验，初始化唯一 dev service，再返回 ack；包装器收到 ack 后才返回已组合配置。
6. 完全相同的重复消息幂等返回同一 ack；同一启动中出现不一致配置立即失败，不能启动第二个 Session。

内部配置消息具有协议版本、启动 nonce、独立高熵配置 secret、最大消息尺寸、严格 schema、串行状态机和超时；未知字段、重复 request id、root 不一致或超时全部 fail-fast。listener 只绑定 loopback，配置路径不进入 Next rewrite；配置 secret 与 Loader registration secret 相互独立。

直接执行 `next dev` 时没有 lifecycle owner、配置凭据和 sealed Sidecar。`withSpotPatch` 在开发 phase 返回清晰错误和正确命令，不在配置求值中自行启动 Sidecar，也不静默变成只有 marker 或只有 UI 的半可用状态。

Next 会把非 `NEXT_PUBLIC_*` 环境变量留在服务端，但项目自身的可信服务端代码仍可访问它们；SpotPatch 不能防御已被恶意依赖或服务端代码控制的宿主项目。任何 Key 都禁止放入 `next.config.env`，因为该配置会把值固定进 JavaScript bundle。

启动顺序：

1. 校验 Node、接入文件、本地 Next binary 和 CLI 参数；此时不解析 AI Key。
2. 解析并 realpath 应用/Git边界，生成本次启动 nonce、配置凭据、内部注册凭据与 epoch，绑定 sealed loopback listener。
3. 以显式 loopback hostname 启动本地 `next dev` 子进程。
4. Next 配置在 `PHASE_DEVELOPMENT_SERVER` 中完成选项解析，并通过认证内部配置请求完成 configure/ack。
5. 父 CLI 收到并验证配置后生成 Session，把既有 sealed listener 原子配置为 Sidecar 并完成自检，随后 ack。
6. 包装器只使用本次进程环境中已校验的非敏感 `registryEpoch`/Sidecar origin 组合 Loader 与 rewrite；secret 不进入 NextConfig 返回值或 Loader options。
7. Next 就绪后输出单条脱敏状态；不打印 token、Sidecar secret、Key 或绝对临时路径。
8. 收到终止信号、Sidecar 崩溃或 Next 退出时，停止接收新 Job，取消活动任务、释放 worktree/registry，关闭另一进程并透传确定退出码。

配置 phase 必须使用 Next 官方 `PHASE_DEVELOPMENT_SERVER`，不得检查 `process.argv.includes("dev")`；Next 16 已改变 dev 命令参数可见性。

## 非开发生命周期

- `next build`、`next start` 与 `output: "export"` 静态导出不启动 Sidecar、不解析 AI Key、不注册 Loader、不注入 marker。
- `instrumentation-client` 中的静态 import 会在所有构建阶段存在，因此 `withSpotPatch` 在非开发 phase 仍须分别为 webpack 与 Turbopack组合 side-effect-free noop alias；package manifest 必须保留真实开发 client 的副作用语义并允许 noop 被消除，禁止把整个包粗暴标为 `sideEffects: false`。除此之外不解析 Key、不注册 Loader/rewrite 或服务。只在运行时判断 `NODE_ENV` 不满足零残留。
- 用户误用 `spotpatch-next build` 应拒绝并提示直接使用 Next 原命令；SpotPatch CLI 只承载 `dev`，避免成为通用命令代理。
- 直接运行 `next dev` 且缺少受控 Sidecar 握手时必须给出确定诊断；不能静默生成半可用 UI，也不能在配置求值时偷偷启动常驻服务。

生产隔离的验证口径 (见 doc-id:next-07-security-production)。

## 配置组合规则

### webpack

调用宿主原有 `webpack(config, context)` 后，对其返回值追加 SpotPatch配置；如果宿主回调返回 `undefined`，按 Next 约定继续使用传入 config。开发 phase 追加 pre-loader；真实 client 由官方 `instrumentation-client` 静态 import 进入。非开发 phase 只为该 client module id 追加 noop alias。包装器不得覆盖宿主 alias、rules、plugins 或 devtool，且除该可审计 alias 外不得改变生产配置。

### Turbopack

开发只合并 SpotPatch 拥有的 rule key；生产只合并 client/noop alias。用户已有相同 rule/alias 时，如果不能证明等价，启动失败并指出冲突位置；禁止后写覆盖。Loader options 只能包含可序列化、非敏感值，不能包含函数、`RegExp`、token、Key 或内部注册 secret。

### rewrites

兼容宿主返回数组或 `beforeFiles/afterFiles/fallback` 对象。SpotPatch 保留原顺序并增加自己的保留前缀路由；宿主已声明可能命中保留前缀的 rewrite 时 fail-fast。路由值与协议仍由协议唯一事实源定义 (见 doc-id:09-local-protocol-security)。

### 其他配置

`basePath`、`trailingSlash`、`pageExtensions`、`distDir`、`src` 目录、React Compiler、自定义 Babel/MDX 等均必须进入兼容 fixture。未验证的组合不能被初始化器或文档宣称支持。

## 不采用的入口

- 不使用 `adapterPath`：它是部署平台适配入口，会与宿主部署 Adapter 竞争，且不能覆盖计划支持的全部 Next 15 范围。
- 不使用 Custom Server：官方明确提示会失去重要优化，并与 standalone 产物存在限制。
- 不要求用户配置 `.babelrc` 或修改全局 `jsxImportSource`：前者会让 Next 退出默认 SWC，后者会改变整个项目 JSX runtime。
- 不通过 `next.config` 顶层副作用启动 Sidecar：配置可能被多次加载，无法可靠拥有进程和清理责任。
