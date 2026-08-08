---
doc-id: "next-03-integration-lifecycle"
title: "Next.js 接入 API 与生命周期"
status: "active"
version: "0.1.0"
last-updated: "2026-08-08"
source-range: "Next.js next.config phase、instrumentation-client 与 CLI 生命周期调研；SpotPatch 接入提案"
implementation-status: "planned"
参考文献/依赖:
  - "03-public-api-models"
  - "09-local-protocol-security"
  - "17-model-provider-credentials"
  - "next-07-security-production"
---

# Next.js 接入 API 与生命周期

## 用户入口

Next 用户只显式安装一个包：

```bash
npm install --save-dev @spotpatch/next
```

规划的配置入口为高阶配置包装器：

```ts
import type { NextConfig } from "next";
import { withSpotPatch } from "@spotpatch/next";

const nextConfig: NextConfig = {
  // 宿主已有配置
};

export default withSpotPatch({
  ai: {
    baseURL: process.env.SPOTPATCH_AI_BASE_URL!,
    model: process.env.SPOTPATCH_AI_MODEL!,
  },
})(nextConfig);
```

示例中的 AI 字段复用现有公共类型和凭据边界；真实 Key 仍只能由服务端环境变量提供，不能成为函数参数或 `NEXT_PUBLIC_*` 值 (见 doc-id:03-public-api-models)、(见 doc-id:17-model-provider-credentials)。实现文档不得为 Next 复制另一套 AI 配置。

规划类型：

```ts
type NextConfigInput =
  | NextConfig
  | ((phase: string, context: NextConfigContext) => NextConfig | Promise<NextConfig>);

declare function withSpotPatch(
  options?: SpotPatchOptions,
): (config?: NextConfigInput) => NextConfigInput;
```

包装器必须同时接受对象、同步函数和异步函数，先解析宿主结果再做无损组合。不得改变宿主函数的 phase/context，不得丢失 Promise、插件顺序、webpack 回调、rewrites 对象形态或未知 Next 配置字段。

## 一次性初始化

Next 没有 Vite `transformIndexHtml` 等价能力。为了在 React hydration 前安装 hook，项目需要一个 Next 官方文件约定入口：

```ts
// instrumentation-client.ts；使用 src 目录时位于 src/instrumentation-client.ts
import "@spotpatch/next/client";
```

不要求用户手工猜测路径，包提供：

```bash
npx spotpatch-next init
npx spotpatch-next check
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

CLI 使用本项目安装的 Next binary，不下载或调用全局 Next，不启用 shell。所有 `next dev` 参数原样作为用户 CLI 输入传递，例如端口、host 或 `--webpack`；浏览器和模型不能影响这些参数。

启动顺序：

1. 校验 Next/Node 版本和接入完整性。
2. 解析项目 root 与本地环境，生成进程内 Session。
3. 在 loopback 随机空闲端口启动 Sidecar 并完成自检。
4. 通过仅供子进程使用的环境握手启动本地 `next dev`。
5. Next 配置在 `PHASE_DEVELOPMENT_SERVER` 中完成 Loader/rewrite/client alias 组合。
6. Next 就绪后输出单条脱敏状态；不打印 token、Sidecar secret、Key 或绝对临时路径。
7. 收到终止信号或 Next 退出时，先停止接收新 Job，再取消活动任务、释放 worktree/registry，最后关闭 Sidecar 并透传 Next 退出码。

配置 phase 必须使用 Next 官方 `PHASE_DEVELOPMENT_SERVER`，不得检查 `process.argv.includes("dev")`；Next 16 已改变 dev 命令参数可见性。

## 非开发生命周期

- `next build`、`next start` 与 `output: "export"` 静态导出不启动 Sidecar、不解析 AI Key、不注册 Loader、不注入 marker。
- `@spotpatch/next/client` 在非开发 phase 必须解析为无副作用、可树摇的 noop；只在运行时判断 `NODE_ENV` 不满足零残留。
- 用户误用 `spotpatch-next build` 应拒绝并提示直接使用 Next 原命令；SpotPatch CLI 只承载 `dev`，避免成为通用命令代理。
- 直接运行 `next dev` 且缺少受控 Sidecar 握手时必须给出确定诊断；不能静默生成半可用 UI，也不能在配置求值时偷偷启动常驻服务。

生产隔离的验证口径 (见 doc-id:next-07-security-production)。

## 配置组合规则

### webpack

调用宿主原有 `webpack(config, context)` 后，对其返回值追加 SpotPatch pre-loader；如果宿主回调返回 `undefined`，按 Next 约定继续使用传入 config。包装器不得覆盖 alias、rules、plugins 或 devtool，不得改变生产配置。

### Turbopack

只合并 SpotPatch 拥有的 rule key 和 client alias。用户已有相同 rule/alias 时，如果不能证明等价，启动失败并指出冲突位置；禁止后写覆盖。

### rewrites

兼容宿主返回数组或 `beforeFiles/afterFiles/fallback` 对象。SpotPatch 保留原顺序并增加自己的保留前缀路由；宿主已声明可能命中保留前缀的 rewrite 时 fail-fast。路由值与协议仍由协议唯一事实源定义 (见 doc-id:09-local-protocol-security)。

### 其他配置

`basePath`、`trailingSlash`、`pageExtensions`、`distDir`、`src` 目录、React Compiler、自定义 Babel/MDX 等均必须进入兼容 fixture。未验证的组合不能被初始化器或文档宣称支持。

## 不采用的入口

- 不使用 `adapterPath`：它是部署平台适配入口，会与宿主部署 Adapter 竞争，且不能覆盖计划支持的全部 Next 15 范围。
- 不使用 Custom Server：官方明确提示会失去重要优化，并与 standalone 产物存在限制。
- 不要求用户配置 `.babelrc` 或修改全局 `jsxImportSource`：前者会让 Next 退出默认 SWC，后者会改变整个项目 JSX runtime。
- 不通过 `next.config` 顶层副作用启动 Sidecar：配置可能被多次加载，无法可靠拥有进程和清理责任。
