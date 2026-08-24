---
doc-id: "external-agent-09-active-dispatch-adapters"
title: "外部 Agent 连接：主动派发与 Agent 适配器"
status: "active"
version: "0.4.1"
last-updated: "2026-08-24"
source-range: "点击发送后的主动唤醒、常驻事件泵、Claude Channel、Codex App Server 与扩展适配器边界"
参考文献/依赖:
  - "external-agent-00-index"
  - "external-agent-02-research-compatibility"
  - "external-agent-03-architecture-packages"
  - "external-agent-04-handoff-protocol"
  - "external-agent-05-mcp-cli"
  - "external-agent-06-security"
  - "external-agent-07-ux-performance-observability"
  - "external-agent-08-testing-delivery"
  - "15-risks-adr"
---

# 外部 Agent 连接：主动派发与 Agent 适配器

## 决策摘要

“发送给 Agent”必须拆成两个正交能力：

1. **Handoff 事实源**：dev-server 授权、保存当前交接并允许稍后重读；
2. **Agent 唤醒/执行入口**：常驻 Connector 通过宿主正式提供的入站能力，把新交接变成一次真实 Agent 事件或 turn。

标准 MCP tool 仍负责跨宿主的上下文读取和回退，不再被当成通用唤醒协议。主动适配只在宿主有可验证的入站事件或 turn API 时成立；没有该能力的工具继续使用 MCP/CLI Inbox，UI 必须明示为“发布待取件”而不是“已触发执行”。

## 产品不可违背的事实

- 可以保证的是：当符合能力、已连接且仍在运行的 adapter 存在时，点击发送会立即进入该 adapter 的主动派发路径。Claude 最强证据只是把事件 bytes 写入 Channel stdio transport；Codex 可以由匹配的 `turn/start` response 证明请求被 App Server 接受。两者不能共用“宿主一定创建了任务”的泛化保证。
- 不可以保证的是：凭空启动一个已关闭的 IDE/Agent 会话，或让没有入站 API 的任意工具自动执行。
- Claude Channel 写入 stdio 不是模型 ACK；只能记为 `dispatched`，不能记为 `working`。
- Codex 匹配的 `turn/start` 成功响应记为 `dispatched`，匹配的 `turn/started` 才记为 `working`；匹配的 `turn/completed.params.turn.status` 只能记协议终态，不证明修改目标或检查成功。
- 任何 adapter 故障都不得删除 Handoff；用户在 TTL 内仍可通过 MCP/CLI 手动读取。

## 运行拓扑

```mermaid
flowchart LR
  UI[SpotPatch Runtime] -->|publish| DEV[dev-server / Sidecar]
  DEV --> STORE[Authorized Handoff Store]
  STORE --> BROKER[Loopback Broker]

  subgraph Connector[@spotpatch/bridge 常驻 Connector]
    PUMP[Handoff Event Pump]
    PORT[AgentAdapter Port]
    PUMP --> PORT
  end

  BROKER -->|bounded wait / get / ack| PUMP
  PORT --> CLAUDE[Claude Channel Adapter]
  PORT --> CODEX[Codex App Server Adapter]
  PORT -.future.-> OTHER[其他有正式入站 API 的宿主]

  STORE --> MCP[Generic MCP / CLI Inbox]
```

dev-server 不 import 任何厂商 SDK，Runtime 不启动本地进程。厂商差异只存在于 `@spotpatch/bridge` Node 进程内，Vite 与 Next 仅转发同一组 CLI 子命令。

## 适配器端口

首版端口是包内私有契约，只包含已有实际消费者的方法，不公开未稳定插件 API：

```ts
interface AgentAdapter {
  readonly kind: "claude-channel" | "codex-app-server";
  readonly deliver: (
    handoff: ExternalHandoffSnapshot,
    lifecycle: AgentDeliveryLifecycle,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly close: () => Promise<void>;
}

interface AgentDeliveryLifecycle {
  readonly report: (
    phase: "dispatched" | "working" | "completed" | "failed" | "delivery-unknown",
  ) => Promise<void>;
}
```

约束：

- `lifecycle.report` 是 adapter 状态的唯一写入口；`deliver` 不返回第二份 phase，避免 response 与 notification 成为冲突状态源。它只在 `completed/failed` 后正常 resolve；若可能已写入但无法确认，必须先上报 `delivery-unknown` 再终止 Connector。Event Pump 自己只负责 `queued → dispatching`。
- adapter 只获得 Node 重新授权后的 snapshot，不接收浏览器提供的 cwd、command、threadId、model 或权限参数。
- 子进程、认证、宿主协议和输出解析是 adapter 内部职责；事件发现、cursor 恢复、有界等待、回执和退避由共享 Event Pump 负责。
- 不提供“任意 command + args” adapter。这种抽象会把受限交接扩大成通用本地命令执行器。

## 共享 Handoff Event Pump

Event Pump 是“执行完回到空闲，下次点击仍立即收到”的通用核心，它运行在 Connector 进程，不占用模型 turn。

```text
adapter 真正 ready
  → claim 目标 dev Session 的 active lease，并原子取得 baselineCursor
  → 启动 heartbeat
  → broker.wait(baseline/afterCursor)，共享 BridgeClient 自动记录 pickup receipt
  → receipt 未记录则在任何厂商 write 前停止
  → report dispatching
  → adapter.deliver(snapshot, lifecycle)，由 adapter 报告 dispatched/working/terminal
  → 仅 completed/failed 后更新 afterCursor
  → 立即再次 broker.wait(afterCursor)
```

规则：

1. 等待是 Broker long-poll，不产生模型 token，不使用文件或定时忙轮询。
2. claim 与读取 current baseline 必须是 Broker 内同一同步临界区；claim 后另调 current 会在其间发布时跳过第一条任务。旧交接仍可通过显式 MCP `get` 读取。
3. `HANDOFF_CURSOR_INVALID` 和 lease 失效可在同一精确 Session 内重新 claim、建立新 baseline 并继续等待；开发 Session 结束/重启会生成新 ID，当前 Connector 必须停止并提示重跑，不能拿旧 adapter/MCP/thread 静默重绑定。
4. Browser publish 在一个无 `await` 的临界区内决定 Inbox/active、替换 current、预留 `queued`、保存 requestId 结果并唤醒 waiter；响应原子返回实际 delivery mode，不能依据旧 capability 推断。
5. get/wait 自动 ack 只表示 Connector pickup，不表示厂商已接收。Active Pump 要求 receipt 成功后才开始 adapter write。已证明尚未写厂商 transport 的失败记 `failed`；可能已经写入的异常记 `delivery-unknown`，停止并释放 writer。两者都不自动重试。
6. 对**尚未取得任务**的发现/连接错误使用有上限的退避和 jitter；AbortSignal 立即终止 wait、heartbeat、退避和 adapter。
7. 同一 Connector 内以 cursor 去重；Browser requestId 只解决发布重放。跨进程 exactly-once 无法只靠内存 Broker 证明，因此不对外宣称 exactly-once。相同 root 存在多个 dev Session 时主动发现一律报歧义，不按最新交接猜测。
8. 同 `adapterKind` + 同 `connectorInstanceId` 的 claim 重试必须返回原 `leaseToken` 和原 `baselineCursor`，只刷新租期；不同 kind/instance 冲突失败。`connectorInstanceId` 是进程内去重键，不是认证凭据；心跳、上报与释放只认高熵 lease token。

## Claude Code Channel Adapter

### 成立条件

Claude Code 会话必须正在运行，且用户已对本会话显式启用 SpotPatch Channel。Channel 目前仍是 Research Preview；裸 server 使用 `--dangerously-load-development-channels server:spotpatch`，组织 `allowedChannelPlugins` 只接受 plugin + marketplace 形式。开发加载可绕过该 entry 的 plugin allowlist，但 `channelsEnabled` 总开关仍生效。需要长期 ready 时必须保持前台会话，或使用 pinned background session；未 pin 的后台会话可能在空闲后被 supervisor 停止。

### 协议映射

- Connector 作为 stdio MCP server 由 Claude Code 启动；只有 MCP initialize 完成、Channel 协议版本兼容且 stdio 仍存活后才 claim，UI ready 来自该真实 lease。
- initialize capability 声明 `experimental["claude/channel"] = {}`。
- Event Pump 获得新 snapshot 后发送 `notifications/claude/channel`。
- `meta` 只放符合标识符规则的键 `session_id`、`revision`、`cursor`，且值均为字符串；不放路径、指令或 token。
- `content` 只发稳定、短小的唤醒说明，要求 Claude 用精确 cursor 读取 Handoff；完整 DOM/CSS/源码仍由 MCP tool 从 Broker 取得。
- 不声明 permission relay，不自动批准 Bash/Write/Edit。Claude 本地权限策略仍是最终边界。

### 状态语义

`mcp.notification()` resolve 只能记为 `dispatched`，其含义仅是 bytes 已写入 stdio transport；官方协议没有 Channel notification ACK，也没有 completion ACK，未注册 Channel 或策略阻断仍可能静默丢弃。只有 active server 中 exact-cursor 的 `spotpatch_get_current_handoff` 才记 `working`；Generic MCP get 不改变主动状态。任务结束必须调用只在 active mode 暴露的 `spotpatch_report_handoff_result({ cursor, outcome: "completed" | "failed" })`，该 tool 是当前 Claude terminal 证据的唯一来源，不接受 phase、路径、summary、message 或 lease。Agent 未调用该结果 tool 时不能推断完成，达到集中 30 分钟上限后进入 `delivery-unknown`、停止 writer 并等待用户核对。

## Codex App Server Adapter

### 进程与线程

- 用户在 dev Session 的精确 canonical 项目根运行一条 `connect codex --allow-workspace-write` 即可显式启动 SpotPatch Codex Connector；不要求 nvm 或预先 setup。多个精确匹配 Session 时用 `--session <id>`，不按时间猜测。主动 Connector 不读取或写入 `.codex/config.toml`，而从受信的框架 adapter enum 生成固定 MCP command/args，并只通过 `thread/start.config` 注入专用 thread。
- Connector 从可信终端 PATH 解析、realpath 并验证绝对 Codex executable，当前只接受 `codex-cli 0.149.0`，默认拒绝项目 root 内二进制，再以固定 argv `["app-server"]`、`shell: false` 启动 stdio 子进程。
- 不尝试接管一个未知 Codex UI 会话；该 Connector 拥有一个专用 thread，一个项目一次连接只创建一个 thread。
- 连接先完成 `initialize` / `initialized`，再以 inline `mcp_servers.spotpatch` 执行 `thread/start`。inline 配置与持久 Codex Inbox 共用固定 `XDG_RUNTIME_DIR` / `TMPDIR` / `TMP` / `TEMP` 名称白名单，只请求 Codex 转发当前进程中的值，不传递完整环境。MCP command 内部追加已选定的 `--session`，配置把 `enabled_tools` 锁定为 `spotpatch_list_sessions` 并标记 server required。随后用 `mcpServerStatus/list(threadId)` 验证仅该 tool 对模型可见，并用 `mcpServer/tool/call(spotpatch_list_sessions)` 验证绑定后只返回精确选定 Session；只有两步都成功后才 claim。每个空闲 Handoff 用 `turn/start`。首版不用 `turn/steer`：忙时禁止新的主动写任务，避免两个独立组件修改被隐式合并。
- Codex `turn/start` 临时输入已验证 snapshot 的有界任务投影：revision、规范化的项目相对源码位置、仅标签名的元素标识和逐目标 instruction。它拒绝绝对路径、反斜杠路径、`.`/`..` 段、空路径段和控制字符，也不含 DOM selector/CSS/源码摘录、页面 URL、token 或厂商 ID。全部目标必须有可执行源码位置，且“位置 + 安全标签”投影在本次请求内唯一；缺失、非法路径或碰撞在写入 App Server 前直接 failed。主动配置将 full-context get/wait/ack 从模型工具面移除，状态预检还会拒绝任何额外 tool；项目当前源码是执行权威，固定指令要求不调试 SpotPatch 自身。这为约 225 KiB full result 的已知整体序列化路径建立了协议级阻断和自动化证据；修复后已在记录的 macOS/Next.js/Codex 0.149.0 环境人工完成连续两 revision，跨平台和可重复真实宿主自动化仍未完成。
- 只以 `turn/started`、`turn/completed`、JSON-RPC response/error 更新执行状态；不根据 stdout 自然语言猜测。
- 匹配 `turn/start` response 后报告 dispatched，匹配 `turn/started` 后报告 working；读取 `turn/completed.params.turn.status`，值为 `completed` 时只报告协议 completed，`failed`/`interrupted` 报告 failed。即使模型只解释“无法修改”也可能正常 completed，UI 必须要求用户核对 diff/checks。
- POSIX 上 App Server 作为独立进程组启动；关闭时先给整组发 `SIGTERM`，超时后发 `SIGKILL`，已有子孙进程清理自动化测试。Windows 只回退到直接终止 child，进程树清理还是 `not-tested`。
- Connector 和 inline MCP 都绑定启动时选定的 exact Session；该 Session 结束或重启后旧 ID 不可复用，Pump 必须停止并提示用户重跑命令，不进行无限退避或静默重绑定。
- SIGINT/SIGTERM 从 Session discovery 起即进入同一个 AbortSignal；若发生在 App Server initialize/preflight，立即关闭 transport 和受管进程，禁止继续创建 thread 或等待完整请求超时。

### 权限基线

Codex Connector 默认不能安静地获得写权。MCP 入口由 Connector 临时注入且不落盘；用户仍必须在 Node CLI 启动时显式选择 workspace-write 模式，浏览器请求不能提交或覆盖 MCP command、cwd、sandbox 或 approval。首版写模式必须：

- `cwd` 固定为 Connector 启动项目的 canonical root；
- sandbox 只允许 workspace write，不使用 danger-full-access；
- network access 默认关闭，但只约束 sandbox 内模型命令，不表示 App Server、模型 API 或独立 MCP server 完全无网络；
- approval policy 首版固定为 `never`，不接受 Connector/Browser/Handoff 覆盖；它表示不弹 approval prompt，并非自动批准，也不保证所有越界动作以同一种方式失败；
- workspace-write 主要限制写入，不声称项目外均不可读；临时目录行为使用锁定 Schema 的显式字段；
- thread/start 返回的附加 `writableRoots` 只接受空数组或同一 canonical root；可选 `runtimeWorkspaceRoots` 存在时必须精确等于该 root，拒绝任何外部 root；
- 已知命令/文件/permission/MCP elicitation 等反向 request 按各自 Schema decline/cancel，未知 method 返回协议错误，禁止默认允许；
- 0.149.0 当前通知携带 `emittedAtMs`；解析器只接受 `method`、`params` 与类型正确的可选时间戳，仍拒绝未知 envelope 字段；
- MCP 环境白名单只包含上述四个运行目录变量名；不包含 `HOME`、`PATH`、token 或浏览器字段，其名称和值都不进入 Handoff；
- Codex 既有配置中的其他已启用 MCP server 仍可能按正常分层启动；inline 同名 `spotpatch` entry 已有真实覆盖 POC，Connector 不把 sandbox network 约束误述为对独立 MCP 进程的限制；
- `thread/start` 对可写 cwd 可能持久化 Codex project trust，终端 `--allow-workspace-write` 必须披露并由真实 POC 记录前后配置，Browser 不得静默触发。

## 其他 Agent 的适配规则

新宿主只有同时满足下列条件才能实现主动 adapter：

1. 官方提供可机器调用的入站 event/turn/run API；
2. 协议有稳定请求 ID 和可解析的成功/失败边界；
3. 能固定 canonical project root，并由用户在 Node 侧授予执行权限；
4. 能确定取消、退出、输出上限和子进程清理；
5. 有锁定版本的合同测试。

若只支持 MCP tools，该宿主的能力等级是 `pull`；若只有一次性 CLI，可在独立 ADR 中评估 `run`，不得用通用 command template 假装成安全 adapter。

Cursor 当前继续使用 MCP Inbox；在没有经官方文档与真实宿主测试证明的入站能力前，UI 不得显示为“点击即执行”。

## 并发、幂等与失败

- 同一 adapter 的 `deliver` 调用串行化，禁止两个 `turn/start` 竞争同一 thread。
- 首版每个 dev Session 只允许一个 SpotPatch 管理的主动 adapter 持有 Broker lease；同 kind + 同 `connectorInstanceId` 的 claim 重试幂等返回原 lease/baseline，不同 kind/instance 的第二个连接 fail-fast。instance ID 不是认证凭据。该 lease 不约束同 root 的其他 dev Session，也不阻止普通 MCP Connector 读取 Inbox；产品不能承诺操作系统级全局单 writer。
- active job 未终止时不接受第二个主动写任务；不做 FIFO、latest-wins、自动合并或 `turn/steer`。Claude Channel 宿主虽可排队，SpotPatch 首版也不把该行为当作自己的写队列保证。
- 不实现多 Agent 主动广播写入。同一 dev Session 同时连接多个主动 adapter 的显式目标选择，以及相同 root 多 Session 的跨进程写冲突，属于后续独立能力。
- 交付超时是 `delivery-unknown`；不得自动重发可写任务。Connector 停止并释放 writer，Registry 保持 blocked；用户用精确 cursor 明确确认工作区已核对后只解除 hazard，再重新连接并创建新 revision。
- 当连接断开时，Handoff 仍按 TTL 留在 Broker；Runtime 回退到 Inbox 语义，不在浏览器自动启动进程。

## 安全禁区

- 禁止 Browser API 接受 `command`、`args`、`cwd`、`threadId`、`model`、`approvalPolicy`、`sandbox` 或环境变量。
- 禁止 adapter 绕过 Broker 直接信任浏览器上下文。
- 禁止在 descriptor、stdout/stderr、Channel meta 或 App Server clientInfo 中输出 snapshot 正文、token 或绝对路径。Codex turn 的有界相对位置/instruction 摘要只是给专用 Agent thread 的任务输入，不得转打到 Connector 日志。
- 禁止用文本日志猜测执行成功；只使用结构化协议事件。
- 禁止默认使用 Claude `--dangerously-skip-permissions` 或 Codex danger-full-access。
- 禁止因 adapter 不可用而扩大 Broker 到 LAN/公网，或把 snapshot 落盘成任务队列。

## 首版命令与能力表

| 宿主 | Connector 形态 | 启动方式 | 点击后的可验证语义 |
| --- | --- | --- | --- |
| Claude Code | Channel-aware MCP Connector | 项目 active MCP 配置 + 宿主 legacy env + 显式 Channel 会话参数 | 事件写入 Channel transport；无 notification/completion ACK，terminal 依赖 result tool |
| Codex | SpotPatch-owned App Server Connector | 精确项目根一条 zero-setup connect 命令，thread 级注入 MCP，并显式保持常驻 | `turn/start` 被接受；匹配 turn 事件可证明 working/terminal |
| Cursor | Generic MCP Inbox-only | 项目 MCP 配置 | 只能证明发布/取件，不主动唤醒 |
| 其他 MCP Agent | Generic MCP Inbox-only | 项目 MCP 配置 | 同上 |
| 其他有正式入站 API 的宿主 | 新建独立 adapter | 通过本页 Gate | 以该宿主合同测试为准 |

## 实现与发布 Gate

1. Event Pump 必须先用假 adapter 通过 baseline、首次交接、连续交接、cursor invalid 恢复、Session 结束时停止、取消、交付失败不重试测试。
2. Claude adapter 必须通过 capability/notification 官方 Schema 形态、通知顺序、非 Channel host 降级和真实 Claude Code 手工 E2E。
3. Codex adapter 必须用当前安装版本生成的 App Server Schema 做合同测试，并覆盖 initialize、thread、MCP status + exact-session tool preflight、固定环境名白名单、有界任务摘要、两个连续 turn、completed/failed/interrupted、未知 server request、进程退出和输出超限；首版明确不覆盖 steer。
4. 新 adapter 必须单独标注宿主版本和成熟度；某个 adapter 失效不得阻断 Generic MCP Inbox。
5. 真实宿主 E2E 未通过前，实现状态仍是 `local-validation`，不得在 README 声称为稳定支持。
