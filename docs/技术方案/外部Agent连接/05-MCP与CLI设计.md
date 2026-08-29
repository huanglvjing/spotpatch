---
doc-id: "external-agent-05-mcp-cli"
title: "外部 Agent 连接：MCP 与 CLI 设计"
status: "active"
version: "0.5.1"
last-updated: "2026-08-26"
source-range: "MCP stdio tools/resources/prompts、CLI JSON、客户端配置与厂商增强边界"
参考文献/依赖:
  - "external-agent-02-research-compatibility"
  - "external-agent-03-architecture-packages"
  - "external-agent-04-handoff-protocol"
  - "external-agent-06-security"
  - "external-agent-08-testing-delivery"
  - "external-agent-09-active-dispatch-adapters"
  - "external-agent-10-convergence"
---

# 外部 Agent 连接：MCP 与 CLI 设计

## Generic MCP Server 定位

SpotPatch Generic MCP Server 是一个本地、对项目内容只读、项目作用域的上下文连接器。它只会在 Broker 内存中记录幂等取件回执，不提供源码或配置写入能力。它不是：

- 另一个 AI Agent；
- 远程模型 Provider；
- 文件系统 MCP Server；
- 通用 Shell/Git 工具；
- Vite/Next dev-server 本身；
- 厂商会话代理。

Server 默认使用 stdio，stdout 只写合法 MCP frame/JSONL，所有诊断只写经过脱敏的 stderr。首版不监听 MCP HTTP 端口，避免与内部 Broker 端口混淆。Claude Channel 使用独立 CLI mode 和同一组读取工具；普通 `mcp` mode 永远不取得主动 adapter lease。

## 必需 MCP tools

工具名使用 `spotpatch_` 前缀，避免与宿主工具冲突。首版只定义四个：

### `spotpatch_list_sessions`

用途：列出当前 MCP root/cwd 所属项目的活跃 SpotPatch 开发会话。

参数：无。模型不能传 root、path 或 glob。

返回每项只包含 sessionId、framework、是否有 current handoff、targetCount、清洗后的页面摘要、publishedAt、expiresAt。默认上限内排序，不含正文和 token。

### `spotpatch_get_current_handoff`

用途：立即读取当前或指定安全会话的最新未过期交接。

参数：

- 可选 `sessionId`：只能来自同项目 `list_sessions`；
- 可选 `cursor`：用于精确确认某 revision，不允许作为任意查历史接口。

返回：结构化 `HandoffSnapshot`、`receiptRecorded` 和一段有界、任务导向的人类可读摘要。摘要在开头按目标保留相对路径、行列和用户 instruction，不含 DOM/CSS/源码摘录、页面 URL、token 或不透明 ID。结构化结果仍是完整事实源；短文本用于客户端截断/Tool UI 不展示 structured content 时仍能立即获得可执行意图，不复制完整正文。

### `spotpatch_wait_for_handoff`

用途：等待用户下一次显式发送，提供接近“点击后立即到 Agent”的体验。

参数：

- 可选 `sessionId`；
- 可选 `afterCursor`；
- 可选 `timeoutMs`，由 Connector 裁剪到集中范围。

语义：

- 已有 current 且未提供 `afterCursor`：立即返回；
- current cursor 与 `afterCursor` 不同：立即返回新 revision；
- 尚无更新：通过 Broker 有界长等待；
- 超时：返回 `{ outcome: "timeout" }`，不是 tool error；
- 用户/host 取消：传播 AbortSignal，关闭 Broker request，不自动重试。

工具描述必须告诉模型：超时后若用户仍需要等待，可以再次调用；禁止 Connector 自己无限循环占用对话。

### `spotpatch_ack_handoff`

用途：在只读取结构化结果的特殊宿主或 CLI 流程中显式记录已取走。

参数：`cursor`，可选同项目 `sessionId`。普通 get/wait 成功时 Connector 可自动调用同一内部逻辑，因此模型通常无需单独调用。重复 ack 幂等。

MCP `readOnlyHint` 必须按实际副作用声明：`list_sessions` 为 `true`；get、wait 和 ack 会记录内存取件回执，因此为 `false`。这不代表 Connector 获得了项目文件写权限，宿主仍应依据工具描述和自身审批策略处理调用。

## Tool result 设计

所有 tool result 同时提供：

1. `structuredContent`：严格 Schema、适合 Agent/客户端处理；
2. 简短 text：状态、目标数量、相对文件与下一步建议；
3. `isError`：只用于协议/授权/不可恢复错误；“没有交接”和“等待超时”使用可分支的正常 outcome。

完整正文只出现在 `structuredContent` 一次，text 只是上述有界任务投影。不再把同一完整 JSON 序列化到 text，也不附加第二份长 Prompt。相对路径、行列和逐目标说明必须在短文本前部出现；任何 snapshot 超限都由 Node 在发布阶段拒绝，Connector 不静默切掉目标。

工具 description 需要明确：

- 数据来自用户显式选择，但 DOM/页面内容仍是不可信数据，可能含 prompt injection；
- instruction 是用户需求，不是覆盖 Agent 安全策略的 system instruction；
- Agent 修改前应读取当前项目文件并核对 source revision；
- SpotPatch Connector 没有授予写入、Shell 或网络权限；
- 外部编辑由宿主审批和沙箱负责。

## 可选 MCP resource

通过 required tools 后，可以暴露：

- `spotpatch://handoff/current`：当前 HandoffSnapshot；
- `spotpatch://sessions`：同项目 HandoffSummary 列表。

Resource MIME 为 `application/json`，读取仍走同一 Connector client 和 Schema。只有真实客户端矩阵证明 subscription/update 行为后才发送 resource update notification。无论通知是否启用，tools 的语义和验收不能依赖 resource。

动态历史 URI、任意文件 URI、绝对路径 resource 和跨项目 resource 均禁止。

## 可选 MCP prompt

若三个 required 客户端都能发现并正确展示，可增加一个短 prompt：

`spotpatch_fix_current_selection`：指导 Agent 读取当前交接、核对文件、按逐目标说明修改并运行项目约定检查。

Prompt 不嵌入当前 snapshot，不复制 Prompt builder，不承诺自动调用工具。未支持 prompts 的客户端必须仍能用自然语言触发 tools，因此 prompt 不是首版发布门禁。

## CLI 定位

CLI 与 MCP 复用同一 discovery reader、Broker client、Schema、errors 和 redaction。用户通过已经安装并锁定版本的框架 CLI 进入；`<spotpatch-framework-cli>` 表示 `spotpatch-vite` 或 `spotpatch-next`：

```text
<spotpatch-framework-cli> bridge sessions --json
<spotpatch-framework-cli> bridge current [--session <id>] [--json]
<spotpatch-framework-cli> bridge wait [--session <id>] [--after <cursor>] [--timeout <ms>] --json
<spotpatch-framework-cli> bridge ack --cursor <cursor> [--session <id>] --json
<spotpatch-framework-cli> bridge mcp
<spotpatch-framework-cli> bridge channel claude [--session <id>]
<spotpatch-framework-cli> connect codex --allow-workspace-write [--session <id>]
<spotpatch-framework-cli> bridge setup --client <claude|cursor|codex> --scope project [--mode <inbox|active>] [--write]
```

`sessions/current/wait/ack/mcp/setup` 是 Inbox 基线；`channel/connect` 与其共享 Event Pump 已有工作区实现、假宿主合同测试和确定性连续两任务集成测试，当前只是 `local-validation`。框架 CLI 把顶层 legacy `connect` 转发给同一 Bridge CLI；旧的 `bridge connect` 仍兼容，但两者都不是 managed 默认路径，也不维护第二套实现。`spotpatch-bridge` 仅供显式直接安装 `@spotpatch/bridge` 的高级/内部场景使用。Claude 真实连续双次 E2E 仍为 `not-tested`；旧 attached Codex 已在记录的 macOS/Next.js/Codex 0.149.0 环境人工完成连续两 revision，该证据不适用于 managed。所有命令都不构成跨宿主或跨平台稳定支持声明。

当前 ADR-037 managed 产品路径不再要求用户运行 `connect codex`：该命令只在一个迁移发布周期内保留为高级诊断/回退，并明确标记 legacy direct-workspace。正常路径由 `init` 配置后随 `pnpm dev` 启动 Supervisor；Browser control API 也不接收或拼接本节命令。

### 主动命令生命周期（ADR-036 legacy attached 基线）

- `channel claude` 由 Claude Code 作为项目 MCP stdio server 启动；它在真实 initialize 完成后注册读取/结果上报 tools，确认 Channel 兼容协议，再 claim 原子 baseline；MCP 连接关闭时终止 Event Pump、心跳和 lease。当前锁定 Claude Code 组合必须把 legacy 协商环境设置在**宿主 Claude 进程**上：`MCP_PROTOCOL_NEGOTIATION=legacy claude --dangerously-load-development-channels server:spotpatch`；只修改 MCP server 子进程环境不能改变宿主的握手选择。
- legacy `connect codex --allow-workspace-write` 曾是主动 Codex 的单命令入口，现只保留一个迁移发布周期作为高级诊断/回退。它不创建、读取或修改项目 `.codex/config.toml`，并继续使用固定 MCP、会话、版本、cwd、sandbox、approval 和环境白名单；Browser/交接不能提供这些字段。managed 默认路径的完整固定 profile 见 (见 doc-id:external-agent-10-convergence)。
- 两个主动命令都必须从 dev Session 的精确 canonical 项目根启动；子目录或祖先目录不会被自动升格为可写根。若该根有多个活跃 dev Session，先用 `sessions --json` 取得 opaque ID，再向 `channel claude` 或 `connect codex` 传 `--session <id>`；不指定时 fail-fast，不猜测最新 Session。
- 两种模式都必须先让 adapter 真正 ready，再原子 claim 并取得 `baselineCursor`，不执行启动前已存在的写任务；随后持续使用同一个 Broker client 的 wait/自动取件回执，每次任务进入明确 `completed/failed` 后回到 idle。多个匹配 dev Session 时主动连接 fail-fast，要求用户显式选择。
- SIGINT/SIGTERM、stdio 关闭、App Server 退出或 lease 失效进入同一幂等清理链；信号在 Session discovery 和 App Server initialize/preflight 阶段同样生效，不能等到 Event Pump 启动后才可取消。

### CLI 输出

- `--json` 的 stdout 只输出一个版本化 JSON 对象；无颜色、进度、日志或额外行。
- 人类模式只展示 Summary 和修复建议，默认不把源码/DOM 全量打印到终端。
- stderr 只写脱敏诊断；token、绝对路径和正文禁止出现。
- Codex 人类模式的 stderr 必须区分有证据的 SpotPatch `preparing`、App Server `accepted`、匹配 turn 的 `working`、协议 terminal 或 `delivery-unknown`；Broker `dispatching` 不能表述为“Codex 已收到”。不打印 Agent 推理、文件路径、instruction、thread/turn ID 或命令输出。观察器异常不得改变派发结果。
- SIGINT/SIGTERM 取消 wait 并使用稳定退出码。

### 目标退出码

| 退出码 | 语义 |
| --- | --- |
| `0` | 成功，或 wait 正常返回新 handoff |
| `2` | 参数/Schema 错误 |
| `3` | 当前项目无活跃 Session |
| `4` | 当前无 handoff 或已过期 |
| `5` | Session 歧义，需要显式选择 |
| `6` | 协议版本不兼容 |
| `7` | 本地授权/发现文件不安全 |
| `8` | Broker 不可达或 Session 已关闭 |
| `130` | 用户取消 |

wait timeout 是否使用 `0 + outcome=timeout`，而不是非零退出；这样脚本可把正常等待超时与连接故障分开。

## 客户端设置生成器

设置是便捷性的关键，但自动修改 IDE/Agent 配置属于外部状态变更。首版遵循：

1. 默认只打印项目级配置片段、目标文件和启动命令，不读取或回显现有配置，避免 dry-run 泄漏其中的 secret；
2. 只有显式 `--write` 才写入；交互 UI 也必须再次确认；
3. JSON 写入前严格解析并结构化合并，不用正则拼接；Codex TOML 不尝试通用解析或合并，只接受全文精确等于已知 SpotPatch 生成内容的幂等/迁移情形，其余拒绝并给出手工片段；
4. 原子写入；更新 JSON 前创建同目录、权限 `0600`、不会被覆盖的单份 `.spotpatch.bak`，备份冲突时拒绝写入；不得覆盖其他 MCP server；
5. 重复执行幂等；已存在但 SpotPatch 命令不同则拒绝写入。只允许两种精确自动迁移：用户明确请求 Claude `--mode active` 且当前 SpotPatch entry 与同版本生成的 legacy Inbox entry **逐字段完全相等**；或 Codex 文件全文精确等于上一版无 `env_vars` 的单 SpotPatch entry。两者都必须先备份再原子写入；
6. 优先项目 scope，禁止默认修改用户全局 Claude/Cursor/Codex 配置；
7. 配置中不写 bridge token、端口、绝对源码路径或 secret；Connector 启动后动态发现；
8. 命令指向项目当前安装的 SpotPatch 版本，避免无锁定 `npx latest` 供应链漂移。

实现还必须拒绝配置文件 symlink、非普通文件、超过 1 MiB 的现有配置，以及可被 group/world 写入的 `.cursor`/`.codex` 目录；新建配置目录使用 `0700`。这些检查失败时不尝试“修复”外部状态。

各客户端确切配置路径和字段由 (见 doc-id:external-agent-02-research-compatibility) 的 POC 证据确定；本页不复制易变 JSON/TOML 示例。`--mode active` 首版只允许 Claude；Cursor/Codex 的持久项目 MCP 配置仍是 Inbox。Codex Inbox setup 不合并任意已有 TOML：仅当现有全文精确等于 SpotPatch 上一版本生成的无 `env_vars` 单 entry 时，先创建不覆盖的私有备份再原子迁移；任何自定义/多配置内容仍 fail closed。新生成的 Codex Inbox entry 与主动 inline entry 共用同一固定运行目录 `env_vars` 名称白名单；Claude/Cursor 配置不被泛化加入该 Codex 字段。主动 Codex 不消费持久文件，而由 `connect codex` 通过 thread 级配置注入同一份生成器维护的 MCP 入口，避免持久 setup 与主动唤醒耦合。

## Inbox 自然语言触发建议

设置成功后，最小操作应为：

- 当前已有交接：“读取当前 SpotPatch 交接，核对源码并按每个目标的说明修改。”
- 先武装等待：“等待下一次 SpotPatch 交接；收到后核对当前文件并修改。”

Runtime 可以为 Inbox 提供一键复制这两句的本地化提示，但不能声称它们是跨 Agent 的保留命令。主动 adapter 已 ready 时不再要求用户重复输入这类提醒。

## 主动适配模式

### Claude Channel / Agent SDK adapter

Claude active setup 把项目 `spotpatch` MCP command 指向 `channel claude`。用户仍必须以官方 Channel 开关启动运行中的 Claude Code 会话；当前 Research Preview 的裸 server 启动形式为 `MCP_PROTOCOL_NEGOTIATION=legacy claude --dangerously-load-development-channels server:spotpatch`。legacy env 必须作用于 Claude 宿主进程。该开发参数针对该 entry 绕过 plugin allowlist，但组织级 `channelsEnabled` 仍可关闭 Channels；若要走组织 allowlist，必须把 server 包成含 marketplace 身份的 plugin，不能把裸 server 写进 `allowedChannelPlugins`。

Server 声明 `experimental["claude/channel"] = {}` 和 `tools = {}`。Event Pump 只发短消息：

```text
SpotPatch handoff revision N is ready for this project.
Call spotpatch_get_current_handoff with the exact cursor, verify the current files,
implement the request, then call spotpatch_report_handoff_result.
```

`meta` 只含 `session_id`、`revision`、`cursor` 字符串，不含路径、instruction、源码或 token。读取 exact cursor 后，Channel server 才能记录 `working`；Agent 完成或失败后调用只在 active mode 注册的 `spotpatch_report_handoff_result({ cursor, outcome })`。该工具只更新 Broker 生命周期，不写项目文件，也不接收 summary/路径/命令。若 Agent 没有上报，dispatch 保持非终态直至有界超时并进入 `delivery-unknown`，不能假装回到 idle。

`mcp.notification()` resolve 只更新为 `dispatched`，不能直接更新为 `working/completed`。Channel 协议没有 completion ACK；当前实现只能依赖 exact-cursor 取件 tool 作为 working 证据，并依赖 `spotpatch_report_handoff_result` 作为 terminal 证据。Agent 未调用结果 tool 时不得猜测完成，超时进入 `delivery-unknown`。首版不声明 permission relay，也不使用 `--dangerously-skip-permissions`。真实双次点击 E2E 未通过前，只能标 experimental/local-validation。

### Codex App Server adapter（ADR-036 legacy attached 基线）

legacy attached 路径可在精确项目根运行 `connect codex --allow-workspace-write [--session <id>]` 启动 SpotPatch-owned App Server client；它不是 managed 默认安装步骤。CLI 的运行时要求为 Node.js `>=20.19.0`。attached 与 managed 共用集中兼容政策：最低稳定版 `0.149.0`，不设未来上限，但当前 absolute executable 生成的 Schema 与真实 capability preflight 必须同时通过；该历史入口仍只用于迁移诊断。App Server 是官方 deep-integration interface，但 command 仍为 experimental。legacy 协议顺序为：

```text
resolve/verify absolute codex executable and version
→ spawn <absolute-codex> app-server (shell=false)
→ initialize / initialized
→ thread/start(canonical cwd, workspace-write, approval=never, ephemeral,
               inline mcp_servers.spotpatch + runtime env name allowlist)
→ mcpServerStatus/list(threadId) 验证仅 spotpatch_list_sessions 对模型可用
→ mcpServer/tool/call(spotpatch_list_sessions) 验证绑定后只返回选定 Session
→ active/claim 原子取得 baseline
→ 每个新 Handoff: turn/start(固定 thread、固定 sandbox policy、有界任务摘要)
→ turn/started / turn/completed
→ idle
```

首版不使用 `turn/steer`，不接管未知 Codex UI thread，不持久化 threadId，不自动重放进程重启前的任务。`mcpServerStatus/list` 只证明该 thread 中名为 `spotpatch` 的 server/tool 已注册；还必须由 App Server 直接调用 `spotpatch_list_sessions`，并在严格解析的结构化结果中确认只有用户选定 Session，才可 claim，避免 MCP 启动在不同运行目录时把“工具可见”误报为“Broker 可读”。状态页同时必须证明 SpotPatch server 仅暴露 Session-list，出现额外 tool 即 fail closed。`turn/start` 的用户输入包含 revision、经清洗且规范化的项目相对路径/行列、仅标签名的元素标识、逐目标 instruction 以及固定执行约束；绝对路径、反斜杠路径、`.`/`..` 段、空路径段和控制字符均在厂商写入前拒绝。输入不包含 DOM selector、CSS、源码摘录、页面 URL 或 token。全部目标必须有可执行源码位置，且“位置 + 安全标签”投影在本次多目标内唯一；缺失或碰撞都在厂商写入前报告 failed，避免让模型猜目标。主动 Codex 配置已从模型工具面移除 get/wait/ack，并有额外工具拒绝的自动化证据，从而针对“整体序列化约 225 KiB result”的已知失败路径实施协议级阻断；修复后已在记录的 macOS/Next.js/Codex 0.149.0 环境人工完成连续两 revision，但仍缺少跨平台和可重复真实宿主自动化。项目当前源码是执行权威。Client 只接受有界 JSONL，按 request ID 关联响应：成功 response → `dispatched`，匹配 `turn/started` → `working`，匹配 `turn/completed.params.turn.status` → 协议终态。`completed` 只表示 model turn 正常结束，不证明要求已实现。开发 Session 结束或重启时 exact-session Connector 必须停止并要求重跑，不能用旧 ID 无限退避或静默切换新 Session。已知反向 request 按各自 Schema 返回 `decline`/`cancel` 等有效结果；未知 method 才返回协议错误，任何情况都不自动审批。

写权限只来自启动时显式参数：canonical cwd、workspace-write、network disabled、approval 固定为 `never`；不使用 danger-full-access。`never` 表示不弹 approval prompt，Codex 在 sandbox 内 best effort，不表示所有越界行为都以同一种错误失败。workspace-write 主要约束写入，不等于只能读取项目目录；`networkAccess: false` 只约束 sandbox 内模型生成命令的网络，不关闭 App Server 模型 API 或独立 MCP server 所需网络。Codex 会按自身配置分层继续加载用户已启用的其他 MCP server；thread 级同名 `spotpatch` 配置已用 0.149.0 POC 验证会覆盖项目层同名 entry，但 Connector 不尝试禁用无关 MCP。当前 App Server 在 `thread/start` 解析可写项目时可能把 project trust 写入用户 Codex `config.toml`；`--allow-workspace-write` 的终端披露必须明确该外部副作用，不能由浏览器静默触发。POSIX 上 App Server 以独立进程组启动，关闭时先向整组发 `SIGTERM`、超时再发 `SIGKILL`，并有子孙进程清理测试；Windows 当前只回退到直接终止 child，进程树清理证据仍为 `not-tested`。通知 envelope 只接受锁定 Schema 的 `method`、`params` 和可选非负安全整数 `emittedAtMs`；有效工作区策略只接受 canonical cwd 及无额外 root 或同一 root，畸形/超限输出、未知 envelope 字段、外部可写 root 或 App Server 退出均 fail closed。

ADR-037 managed 的 Supervisor、grant、独立快照、新 thread、固定命名 permission profile、配置隔离、四状态轴、required checks 与安全回写完全以 (见 doc-id:external-agent-10-convergence) 为准；不得从上述 legacy 命令复制 direct-workspace、单 thread、其他 MCP 或精确版本字符串。

### Cursor 与其他工具

Cursor 当前没有经官方文档与真实测试证明的稳定入站事件/turn 入口，因此仅为 Generic MCP Inbox-only，不承诺点击后主动唤醒。其他工具也默认为 Inbox-only；只有在正式入站 API、固定权限边界、版本化响应和合同测试都成立后才能增加窄 adapter。禁止用“任意 CLI 命令模板”制造表面兼容。

## 禁止的 MCP/CLI 设计

- `spotpatch_run_shell(command)`、通用 filesystem write 或 Git reset 工具；
- 工具参数接受 root、绝对路径、glob、URL、端口或 token；
- MCP server 在 import 时启动网络/文件副作用；
- stdio stdout 混入日志或启动 banner；
- Connector 自动扫描并连接任意 localhost 端口；
- 用客户端产品名分叉 Handoff JSON；
- 在 CLI 中解析自然语言选择项目/会话；
- 设置命令默认修改全局配置或下载未锁定的最新包；
- resource notification 触发无限模型轮次或被描述为可靠主动消息。
- active adapter 广播到多个 Agent、忙时自动 queue/latest-wins/steer，或在投递结果未知时自动重试。
- Browser/annotation 控制 executable、args、cwd、thread、model、environment、approval 或 sandbox。
