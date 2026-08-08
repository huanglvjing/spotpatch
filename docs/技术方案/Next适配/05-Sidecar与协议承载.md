---
doc-id: "next-05-sidecar-protocol"
title: "Next.js Sidecar 与本地协议承载"
status: "active"
version: "0.1.0"
last-updated: "2026-08-08"
source-range: "Next.js rewrites/phase 与 Custom Server 官方约束；SpotPatch Node 服务承载提案"
implementation-status: "planned"
参考文献/依赖:
  - "09-local-protocol-security"
  - "16-ai-agent-execution"
  - "17-model-provider-credentials"
---

# Next.js Sidecar 与本地协议承载

## 为什么需要 Sidecar

Vite 公开 `configureServer`，当前适配器可直接挂接 middleware；Next 没有等价的稳定开发服务器 middleware 插件。把文件/Git/Agent 逻辑放进 App Route 会污染业务路由并排除 Pages-only 项目；Custom Server 又会失去官方优化。因此本地服务由 `spotpatch-next dev` 拥有的独立 Node Sidecar 承载。

Sidecar 只改变协议的“宿主承载”，不重定义 endpoint、请求 schema、错误码、文件授权或 Agent 行为；公共协议继续只有一个事实来源 (见 doc-id:09-local-protocol-security)。如需新增 bootstrap endpoint，必须先修改该唯一事实源、shared schema 和安全验收，不能只写在 Next 包。

## 进程模型

```text
terminal
  └─ spotpatch-next dev (owner)
       ├─ loopback Sidecar (same process or owned child)
       └─ local Next CLI child
            ├─ next.config / Loader workers
            └─ Next dev HTTP server
```

所有权规则：

- CLI 是唯一 lifecycle owner；配置求值、Loader worker 和浏览器都不能启动/复用任意 Sidecar。
- Sidecar 绑定 `127.0.0.1` 和操作系统分配的随机端口；不监听 `0.0.0.0`，即使 Next 自身开放 LAN 也不改变。
- CLI 只解析当前项目的本地 Next binary，以 `process.execPath + fixed argv` 和 `shell: false` 启动。
- Sidecar先完成自检再启动 Next，防止浏览器拿到半初始化 API。
- Next 退出码、signal 和异常必须传回终端；Sidecar shutdown 有总超时，超时后给出可诊断错误并清理自己拥有的资源。

## 两个信任通道

### 浏览器公共通道

- 浏览器只请求既有同源公共前缀。
- `withSpotPatch` 在开发 phase 添加 external `beforeFiles` rewrite，把该前缀代理到随机 loopback Sidecar。
- 请求继续使用 session token、精确 Origin、JSON POST、body/schema/大小限制和 `no-store` (见 doc-id:09-local-protocol-security)。
- Runtime 不知道 Sidecar 端口、内部 secret、root 或绝对路径。

### Loader 内部注册通道

- 路径与公共 API 前缀完全不同，不加入 Next rewrite。
- 只接受 launcher 为 Next 子进程生成的独立内部凭据；不得复用浏览器 session token或 provider Key。
- 只提供 source registration，不提供文件内容、编辑器、Agent、任意 RPC 或状态枚举。
- 每次请求重新验证 root、普通文件、扩展名和规范化路径；拒绝 browser-like Origin 和缺失内部认证。
- 内部凭据只存在进程环境/内存，不写 `.next`、日志、source map、Loader options 或浏览器 bundle。

两个通道使用不同凭据、不同路径和不同 schema，避免“浏览器 token 可以注册任意绝对路径”或“Loader secret 可以创建 Agent Job”。

## Runtime Bootstrap

Next 无 Vite 虚拟模块可安全内联每次会话配置。规划增加一次同源 bootstrap 交换：

1. `@spotpatch/next/client` 同步安装最小 React hook。
2. 客户端以 JSON POST 请求 bootstrap。
3. Sidecar 校验 Host/Origin/Fetch Metadata、请求大小和当前会话后，返回非敏感 Runtime config 与浏览器 session token。
4. 客户端运行 shared schema，深冻结后才启动 Runtime。
5. 响应不包含 provider URL、真实模型名、Key 环境变量名、root、绝对路径、命令、Sidecar端口或内部 secret。

bootstrap 是公共协议唯一“取得当前 session token”的入口，必须 `Cache-Control: no-store`，不可被 Service Worker、CDN 或 Next Data cache 缓存。其 CSRF/DNS rebinding、无 Origin、错误 Host 和重复调用行为是安全 POC；未完成前不得实现为无认证 GET。

## Rewrite 组合

- 使用外部 destination 和 `basePath: false`，保证工具 API 不被业务 basePath 改名。
- 保留宿主原有 array/object rewrites 语义；SpotPatch 路由进入 `beforeFiles`。
- 启动时分析宿主 rewrites、redirects、proxy matcher 和 public/app/pages 路由；任何可能占用公共保留前缀的配置必须 fail-fast。
- `trailingSlash`、国际化 locale 和大小写行为必须通过真实 Next fixture 决定，不在文档中猜测。
- header、POST body、取消信号、NDJSON 流、错误状态和 client disconnect 必须端到端验证；如果 Next 代理缓冲流或吞掉取消，不能把 polling 降级当作等价成功，需回到协议评审。

## AI 与环境解析

- CLI/Sidecar 按项目 root 加载约定式环境；不得依赖 Next 把服务端 env 注入 config 或浏览器。
- Key 只保存在 Sidecar Secret Resolver，检查子进程继续使用最小环境 (见 doc-id:17-model-provider-credentials)、(见 doc-id:16-ai-agent-execution)。
- AI 禁用时不加载 Agent/provider 模块、不运行 Git health、不注册 Agent routes。
- Next child 只获得启动握手所需的最小内部环境；provider Key 不需要也不应复制给 Next child。

## 关闭、崩溃与恢复

- `SIGINT`/`SIGTERM`：停止新请求，取消 provider/check，等待有界清理，关闭 Next/Sidecar。
- Next child 异常退出：Sidecar立即失效所有 token、关闭活动 Job并以同一退出结果结束。
- Sidecar异常：CLI 终止 Next，避免页面继续显示看似可用但无安全服务的 UI。
- Loader worker重启：通过当前内部握手重新注册；旧 Session fileId 不跨 CLI 启动复用。
- HMR：不重启 Sidecar，不重置 Session；同一路径 fileId 稳定。
- CLI重启：生成全新两类凭据；旧页面请求必须失败并提示刷新，不自动接受旧 Job。

## 可观测性

终端日志只允许框架/版本、公开 Next URL、Sidecar ready/closed、脱敏错误码和 debug 性能汇总。默认不显示绝对路径、端口之外的内部地址、token、Key、Prompt、源码或 provider payload。端口可在 debug 日志中显示但不视为认证；任何安全仍依赖凭据和请求校验。
