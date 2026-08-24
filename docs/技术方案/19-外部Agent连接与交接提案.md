---
doc-id: "19-external-agent-handoff"
title: "外部 Agent 连接与交接提案"
status: "active"
version: "0.4.0"
last-updated: "2026-08-23"
source-range: "Claude Code、Cursor、Codex、通用 MCP Agent 的组件上下文交接、主动派发与权限边界"
参考文献/依赖:
  - "external-agent-00-index"
  - "external-agent-01-requirements"
  - "external-agent-02-research-compatibility"
  - "external-agent-03-architecture-packages"
  - "external-agent-04-handoff-protocol"
  - "external-agent-05-mcp-cli"
  - "external-agent-06-security"
  - "external-agent-07-ux-performance-observability"
  - "external-agent-08-testing-delivery"
  - "external-agent-09-active-dispatch-adapters"
  - "03-public-api-models"
  - "09-local-protocol-security"
  - "15-risks-adr"
  - "16-ai-agent-execution"
---

# 外部 Agent 连接与交接提案

本文是“在 SpotPatch 选中组件并填写修改说明后，将准确上下文交给 Claude Code、Cursor、Codex 或其他 Agent”的专题入口。完整目标规范位于 [外部Agent连接/00-索引与决策摘要.md](./外部Agent连接/00-索引与决策摘要.md)。

> 当前实现状态只以 (见 doc-id:external-agent-00-index) 为准。本入口不复制状态值：公共 Inbox 已有工作区实现；主动层的架构与官方协议/Schema 核验已经完成，但 Active Registry、Event Pump 和厂商 adapter 是否实现、通过哪些测试，必须查状态页与 (见 doc-id:external-agent-08-testing-delivery)。不得仅凭本提案在发布说明、README 或 UI 中描述为稳定能力。

## 结论

采用“**显式交接 + Broker 事实源 + 通用 Inbox + 宿主能力主动 adapter**”：

1. 用户点击组件只完成选择和上下文采集，不自动向任何外部进程发送数据。
2. 用户填写逐目标说明、预览范围并点击“发送给 Agent”后，Runtime 才向当前 SpotPatch 开发会话提交交接。
3. Node 端沿用现有 Source Registry 和 `SpotAnnotation` 授权规则，重新读取当前源码，生成不可变、有时效的授权快照。
4. 所有本地宿主都可通过同一个 SpotPatch MCP stdio/CLI Inbox 读取快照；这仍是上下文基线，不承担通用唤醒。
5. 常驻 Bridge Event Pump 在不占模型 turn 的情况下等待新 revision；每个 dev Session 只允许一个 SpotPatch 管理的主动 adapter。该内存 lease 不阻止相同 root 的其他 Session 或 Generic MCP 宿主读取 Inbox。
6. 运行中的 Claude Code 通过 Research Preview Channel 接收短事件引用；SpotPatch-owned Codex App Server thread 通过 `turn/start` 接收任务。Cursor 和没有已验证入站 API 的工具继续使用 Inbox。
7. 外部 Agent 使用自身的文件、审批和 sandbox 修改项目；SpotPatch 不提供通用写/Shell/Git 工具，也不冒充内建 Agent 的隔离审阅能力。

MCP 是跨 Agent 的上下文/工具协议，不是跨所有宿主都可靠的主动消息协议。真正“一次连接，之后每次点击都触发”由窄 adapter 提供：Claude Channel 只能作用于仍在运行且显式启用 Channel 的会话，且 transport write 没有模型 ACK；Codex App Server 是 SpotPatch 自己拥有的 runtime/thread，不是向任意现有 Codex 对话注入。没有正式入站能力时，产品必须诚实显示“发布待取件”。

## 为什么不是直接调用某个 Agent CLI

- 浏览器不能安全决定本地命令、参数、工作目录、会话 ID 或权限模式。
- Claude Code、Cursor 和 Codex 的 CLI 生命周期、审批、输出协议与恢复语义不同，直接耦合会把 Runtime 变成多厂商进程管理器。
- 自动启动 Agent 会把“传递上下文”扩大为“创建可写执行进程”，必须另行取得明确授权并建立退出、取消、沙箱、日志和版本兼容契约。
- 标准 MCP stdio 已覆盖共同上下文能力；主动触发只能在 Bridge 内按厂商正式协议叠加，不能由 Runtime 拼命令。

## 与现有内建 AI 的边界

| 能力 | SpotPatch 内建 AI Agent | 外部 Agent 交接首版 |
| --- | --- | --- |
| 模型调用 | SpotPatch Provider Adapter | 外部宿主自行负责 |
| 文件写入工具 | SpotPatch 受控工具 | 外部宿主自身工具 |
| 隔离 worktree | 有 | 不承诺 |
| Diff / checks / Apply / Revert | SpotPatch 负责 | 外部宿主或用户负责 |
| 上下文入口 | 创建 Agent Job | MCP/CLI 读取同一 Handoff；主动 adapter 只发送引用 |
| 凭据 | SpotPatch Node 环境变量 | 外部宿主自身配置 |
| 审批与沙箱 | SpotPatch 规则 | 外部宿主规则 |

二者只复用“目标选择、逐目标说明、源码身份和服务端重新授权”事实，不共享执行状态机，也不把外部 Agent 的文件变更伪装成内建 Job 结果。

## 专题导航

| 文档 | 负责内容 |
| --- | --- |
| [00-索引与决策摘要.md](./外部Agent连接/00-索引与决策摘要.md) | 方案状态、术语、决策摘要和规范优先级 |
| [01-需求与产品语义.md](./外部Agent连接/01-需求与产品语义.md) | 用户流程、功能/非功能要求、边界和成功标准 |
| [02-官方能力与兼容矩阵.md](./外部Agent连接/02-官方能力与兼容矩阵.md) | MCP、Claude、Cursor、Codex 一手能力与限制 |
| [03-总体架构与包边界.md](./外部Agent连接/03-总体架构与包边界.md) | 分层、依赖方向、运行拓扑、Vite/Next 复用 |
| [04-交接模型与本地协议.md](./外部Agent连接/04-交接模型与本地协议.md) | 领域状态、浏览器 API、内部 Broker 和版本规则 |
| [05-MCP与CLI设计.md](./外部Agent连接/05-MCP与CLI设计.md) | MCP tools/resources、CLI、客户端配置和厂商增强 |
| [06-安全隐私与权限边界.md](./外部Agent连接/06-安全隐私与权限边界.md) | 威胁模型、授权、凭据、数据生命周期和禁区 |
| [07-交互性能与可观测性.md](./外部Agent连接/07-交互性能与可观测性.md) | UI 状态、真实推送语义、性能预算和诊断 |
| [08-测试验收与实施计划.md](./外部Agent连接/08-测试验收与实施计划.md) | POC、测试矩阵、发布 Gate、阶段和回滚 |
| [09-主动派发与Agent适配器.md](./外部Agent连接/09-主动派发与Agent适配器.md) | Event Pump、单活/单飞行、Claude/Codex adapter 与状态证据 |

## 首版明确不做

- 不在单击 DOM 元素时静默发送项目内容。
- 不从浏览器拼接或执行 `claude`、`cursor-agent`、`codex` 等命令。
- 不把 MCP resource notification 描述成“任何 Agent 都会自动收到新消息”。
- 不广播到多个可写 Agent，不在 busy 时 queue/latest-wins/steer，不重试 delivery-unknown。
- 不提供任意 executable/args adapter；浏览器不能决定 cwd、thread、model、network、approval 或 sandbox。
- 不为 ChatGPT 网页版或纯模型 API 暴露本机公网 MCP 服务。
- 不把源码、DOM、Prompt 或交接快照写入发现文件。
- 不允许外部 MCP 客户端指定项目 root、绝对路径、Source Registry、Shell 命令或权限策略。
- 不声称外部 Agent 的改动具有 SpotPatch 内建 Agent 的 worktree、检查、应用和撤销保证。

## 评审入口

ADR-035 记录公共 Inbox 基线，ADR-036 记录主动派发层，见 (见 doc-id:15-risks-adr)。本机官方能力/Schema 核验已完成；Claude/Codex 真实双次点击、完整三客户端、三平台和生产零残留证据仍由 EA-1B/EA-5/EA-6/EA-7 阻断稳定支持声明。
