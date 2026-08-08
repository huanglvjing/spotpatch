---
doc-id: "next-05-sidecar-protocol"
title: "Next.js Sidecar 与本地协议承载"
status: "active"
version: "0.2.0"
last-updated: "2026-08-09"
source-range: "Next.js rewrites/phase、CLI 与 Custom Server 官方约束；SpotPatch Node 服务承载提案；编码前多进程信任复核"
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
       ├─ sealed loopback listener → configured Sidecar
       └─ local Next CLI child
            ├─ next.config ── private IPC configure/ack ──> owner
            ├─ Loader workers ── internal loopback channel ──> Sidecar
            └─ Next dev HTTP server
```

所有权规则：

- CLI 是唯一 lifecycle owner；配置求值、Loader worker 和浏览器都不能启动/复用任意 Sidecar。
- Sidecar 绑定 `127.0.0.1` 和操作系统分配的随机端口，不监听 `0.0.0.0`；CLI 同时拒绝 Next 自身开放 LAN，不能只依赖这一条 bind 规则。
- CLI 只解析当前项目的本地 Next binary，以 `process.execPath + fixed argv` 和 `shell: false` 启动。
- CLI 先绑定只会拒绝请求的 sealed loopback listener，再启动 Next；`withSpotPatch` 通过私有 IPC 完成配置后，owner 才把同一 listener 原子切换为 ready Sidecar并 ack。Next 配置返回前 Sidecar 必须完成自检，防止浏览器拿到半初始化 API。
- Next 退出码、signal 和异常必须传回终端；Sidecar shutdown 有总超时，超时后给出可诊断错误并清理自己拥有的资源。

父 CLI 不自行求值 `next.config`，也不实现第二套 Next `.env*` 解析。对象/同步/异步配置均由 Next 真实求值，再由包装器发送一次严格 schema 的 configure 消息；重复等价配置幂等，不等价重复配置终止启动。IPC 生命周期与错误策略 (见 doc-id:09-local-protocol-security) 中的通用输入校验原则一致，但具体内部消息在 POC 后才冻结。

## 两个信任通道

### 浏览器公共通道

- 浏览器只请求既有同源公共前缀。
- `withSpotPatch` 在开发 phase 添加 external `beforeFiles` rewrite，把该前缀代理到随机 loopback Sidecar。
- 请求继续使用 session token、精确 Origin、JSON POST、body/schema/大小限制和 `no-store` (见 doc-id:09-local-protocol-security)。
- Runtime 不知道 Sidecar 端口、内部 secret、root 或绝对路径。

### Loader 内部注册通道

- 路径与公共 API 前缀完全不同，不加入 Next rewrite。
- 只接受 launcher 为本次 Next 子进程生成的独立内部凭据和 `registryEpoch`；不得复用浏览器 session token 或 provider Key。
- 只提供 source registration，不提供文件内容、编辑器、Agent、任意 RPC 或状态枚举。
- 每次请求重新验证 root、普通文件、扩展名和规范化路径；拒绝 browser-like Origin 和缺失内部认证。
- 内部 endpoint、凭据与 epoch 通过 CLI 创建的子进程私有环境交给 Next/Loader worker；凭据只存在进程环境/内存，不写 `.next`、日志、source map、Loader options 或浏览器 bundle。epoch 可进入 Loader cache key，但它不具备认证能力。

Loader worker 是否稳定继承该私有环境、Turbopack cache 是否可能序列化意外字段，必须由 POC 证明。若不能证明零落盘，应重新设计为受控本地 socket/IPC broker，禁止把 secret 降级放入 `turbopack.rules` options。

两个通道使用不同凭据、不同路径和不同 schema，避免“浏览器 token 可以注册任意绝对路径”或“Loader secret 可以创建 Agent Job”。

## Runtime Bootstrap

Next 无 Vite 虚拟模块可安全内联每次会话配置。规划增加一次同源 bootstrap 交换：

1. `@spotpatch/next/client` 同步安装最小 React hook。
2. 客户端以 JSON POST 请求 bootstrap。
3. Sidecar 校验 method、Host、Origin、Fetch Metadata、Content-Type、请求大小和启动状态后，返回非敏感 Runtime config 与新浏览器 session token。
4. 客户端运行 shared schema，深冻结后才启动 Runtime。
5. 响应不包含 provider URL、真实模型名、Key 环境变量名、root、绝对路径、命令、Sidecar端口或内部 secret。

bootstrap 是公共协议唯一“取得当前 session token”的入口，因此它不能要求请求预先携带 session token。它以同源浏览器请求证明、一次启动状态和严格请求校验签发 token，必须返回 `Cache-Control: no-store`，客户端也不得写 Cache Storage。已有同源 Service Worker 可以观察或改写同源请求，属于宿主页面信任边界；SpotPatch不能对恶意宿主前端代码承诺 token隔离。CSRF/DNS rebinding、无 Origin、错误 Host、跨站 fetch、Service Worker和重复调用行为是安全 POC；未完成前不得实现为无约束 GET。

## Rewrite 组合

- 使用外部 destination 和 `basePath: false`，保证工具 API 不被业务 basePath 改名。
- 保留宿主原有 array/object rewrites 语义；SpotPatch 路由进入 `beforeFiles`。
- 启动时分析宿主 rewrites、redirects、proxy matcher 和 public/app/pages 路由；任何可能占用公共保留前缀的配置必须 fail-fast。
- `trailingSlash`、国际化 locale 和大小写行为必须通过真实 Next fixture 决定，不在文档中猜测。
- header、POST body、取消信号、NDJSON 流、错误状态和 client disconnect 必须端到端验证；如果 Next 代理缓冲流或吞掉取消，不能把 polling 降级当作等价成功，需回到协议评审。
- external rewrite 会让访问 Next dev server 的客户端间接到达 loopback Sidecar，因此 Sidecar 的 loopback bind 不能替代入口隔离。首版 CLI 必须把 Next child 也限制在 loopback，并拒绝显式 LAN hostname。

## AI 与环境解析

- Next 按官方流程加载项目 `.env*`；`withSpotPatch` 只解析配置所引用的服务端环境值并通过私有 IPC 交给 owner。CLI 不重复实现 Next 环境优先级，也不把 Key 放入命令行、`next.config.env` 或公共配置。
- SpotPatch 管理的 Key 副本只保存在 Sidecar Secret Resolver，检查子进程继续使用最小环境 (见 doc-id:17-model-provider-credentials)、(见 doc-id:16-ai-agent-execution)。原始项目环境仍由 Next 进程管理，SpotPatch 不擅自删除或修改宿主环境变量。
- AI 禁用时不加载 Agent/provider 模块、不运行 Git health、不注册 Agent routes。
- Provider Key 在配置求值时已位于可信 Next 服务端进程环境中；SpotPatch 不能向被恶意项目代码控制的同一进程提供额外隔离保证。包装器只允许经私有 IPC 建立 owner 的 Secret Resolver副本，不得做其他复制、打印或持久化；浏览器、Loader options、构建 cache、检查子进程和普通日志始终不得获得它。

## 关闭、崩溃与恢复

- `SIGINT`/`SIGTERM`：停止新请求，取消 provider/check，等待有界清理，关闭 Next/Sidecar。
- Next child 异常退出：Sidecar立即失效所有 token、关闭活动 Job并以同一退出结果结束。
- Sidecar异常：CLI 终止 Next，避免页面继续显示看似可用但无安全服务的 UI。
- Loader worker重启：通过当前内部握手重新注册；cache key 包含本次非敏感 `registryEpoch`，旧 Session fileId 不跨 CLI启动复用。
- HMR：不重启 Sidecar，不重置 Session；同一路径 fileId 稳定。
- CLI重启：生成全新两类凭据；旧页面请求必须失败并提示刷新，不自动接受旧 Job。
- Sidecar 不做脱离 CLI/Next 的原地重启；任何 Sidecar 崩溃都终止 Next，重新启动整组进程并生成新 epoch/token，避免新 Registry 接收旧 marker。

## 可观测性

终端日志只允许框架/版本、公开 Next URL、Sidecar ready/closed、脱敏错误码和 debug 性能汇总。默认不显示绝对路径、端口之外的内部地址、token、Key、Prompt、源码或 provider payload。端口可在 debug 日志中显示但不视为认证；任何安全仍依赖凭据和请求校验。
