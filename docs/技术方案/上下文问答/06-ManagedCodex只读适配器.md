---
doc-id: "context-qa-06-managed-codex"
title: "上下文问答：Managed Codex 只读适配器"
status: "proposed"
version: "1.2.0"
last-updated: "2026-09-02"
source-range: "Codex App Server Ask profile、只读源码投影、事件/答案合同、线程与清理"
参考文献/依赖:
  - "context-qa-02-audit-compatibility"
  - "context-qa-03-architecture"
  - "context-qa-04-model-protocol"
  - "context-qa-08-security-performance"
  - "external-agent-10-convergence"
---

# 上下文问答：Managed Codex 只读适配器

## 与 managed 写模式的关系

Managed Codex Ask 使用新 profile `managed-ask-v1`。它与当前 `managed-apply-v1` 只共享进程和协议基础设施，不共享权限、snapshot、grant、状态或结果：

| 维度 | `managed-ask-v1` | `managed-apply-v1` |
| --- | --- | --- |
| 目的 | 返回 Answer | 生成、验证并回写变更 |
| 文件系统 | read-only 临时投影 | writable 独立 Git snapshot |
| 终态 | Answer Schema + 引用通过 | audit/check/apply 或 review-required |
| Diff/check/apply | 禁止 | 核心能力 |
| 用户同意 | 当前 Session 的源码远程传输 | 持久 managed write grant + 任务门禁 |
| 线程 | 每 Ask 新建并清理 | 每 revision 新建并清理 |

已有写 grant 不自动替代 Ask 数据同意；Ask 也不创建/升级写 grant。

## 编码前阻断式 POC

在写产品代码前，必须对锁定 Codex 版本完成：

1. 生成 experimental App Server JSON Schema；
2. required notifications 至少含 `turn/started`、`turn/completed`、`item/started`、`item/completed` 和 `item/agentMessage/delta`；
3. `turn/start` 接受目标 Answer `outputSchema`；
4. `item/completed` 返回最终 `agentMessage.text`，并能区分/筛选 `phase: final_answer`；
5. `sandboxPolicy.type = readOnly` 的 restricted roots 或等价命名 permission profile 在当前平台真实阻断写入和 root 外读取；
6. `ephemeral: true` 在 `thread/start` 是否可用由该版本 Schema/真实请求确认；若不可用，证明独立临时 `CODEX_HOME` + terminal `thread/delete` + cleanup journal 能清除 rollout；
7. hooks、plugins、apps、web search、MCP、subagents 和 instruction sources 可以被隔离/证明为空；
8. 取消、进程崩溃和删除失败不会留下源码投影或可恢复答案正文。

任一项没有证据时，Managed Codex executor 为 unavailable，UI 只保留 Key 或配置说明。中断、进程崩溃和 cleanup 故障注入的完整跨平台矩阵属于 Gate Q6；Q1 必须至少证明成功、协议拒绝和本地 cleanup `finally` 均不遗留业务源码或答案正文。

## 2026-09-01 Q1 POC 证据

`experiments/contextual-ask-q1/` 对本机认证的 `codex-cli 0.151.0` 完成一次真实 App Server 回合：

- 生成 Schema 包含 required notifications、`outputSchema`、final `agentMessage`、ephemeral thread、命名 permission selector 和经典 `readOnly`；
- 当前 generated `readOnly` union 不含 restricted roots，因此 POC 没有伪造该字段，而是使用 `spotpatch-ask-readonly` 命名 profile；
- profile 为 root deny、minimal read、精确 projection root read、network disabled；
- target source 读取成功，projection 外合成哨兵读取被拒绝，projection 写入被拒绝且文件不存在；
- `instructionSources`/hooks/MCP 均为 0，`fileChange` 为 0；
- final `item/completed.agentMessage` 通过 Answer POC Schema，turn completed，ephemeral thread 不出现在 `thread/list`。

该证据使 Q1 可进入公共协议实施，但只代表单机可行性，不代表 Q6/Q7 发布矩阵已通过。

## 2026-09-02 Q6 正式实现证据

正式产品链路已落在 `@spotpatch/bridge` 的独立 `managed-ask-v1` executor，并由 Vite/Next 在 `contextualAsk.enabled` 时注册；它没有复用 `managed-apply-v1` 的 writable snapshot、write grant、diff、check 或 apply 状态。实现当前锁定且只接受已审计的 `codex-cli 0.151.0`，每次连接重新验证 executable realpath、版本和 required generated Schema surface；版本变化一律 `ASK_PROTOCOL_INCOMPATIBLE`，必须重新审计后才能更新锁。

- 每次 capability/Ask 都创建独立只读 projection、独立 `CODEX_HOME`、独立 App Server 进程和 ephemeral thread；连续两个真实 Ask 不 resume/fork/steer，结束后 runtime home 为空；
- thread 激活 `spotpatch-ask-readonly`，校验 cwd/runtime root、active profile、空 `instructionSources`、空 hooks 和空 MCP；固定配置关闭 network/web/apps/plugins/hooks/remote plugin/subagents；
- `outputSchema` 使用 OpenAI Structured Outputs 支持的无 `oneOf` 规范化 wire block；服务端再按 block kind 做互斥字段验证并投影为公共 `AskAnswerDraft`，因此不会降低公共 Answer 合同；
- 只有匹配 thread/turn 的 authoritative completed final `agentMessage` 与 successful terminal 同时成立才返回；turn start/completed 按锁定 Schema 从 `turn.id` 关联，delta 不作为答案；
- 非空 diff、fileChange/dynamic/MCP/web/subagent/image activity、write/command/permission approval、未知 reverse request、hook activity、重复 final、无 final、失败/中断、协议畸形均 fail closed；终态后的迟到写事件也保留为连接级失败；
- projection 在启动前校验 grant hash，文件/目录设为只读，结束后全树复验 hash/新增项；成功、失败、取消、进程崩溃和 cleanup 失败都执行 runtime/projection 清理；
- App Server 父进程只接收联网/证书所需的有界环境；command shell 另用 allowlist policy，仅暴露 PATH、locale、临时目录和证书字段，`CODEX_HOME`、HOME、auth/API Key 与 proxy credential 不进入模型命令环境；
- `thread/delete` 对真实 ephemeral thread 返回的精确 “not persisted and cannot be deleted” 视为已证明无持久线程；其他删除错误仍使 Ask 失败。由于本实现强制并复验 ephemeral 且整个私有 `CODEX_HOME` 随 Job 删除，不启用 persisted-thread fallback，也不需要长期 cleanup journal。

真实登录态 macOS gate 使用产品 executor 完成 capability 加两个独立 Ask，最终复验约 35 秒，两个答案均有源码引用且 runtime 目录为空。mock JSONL 覆盖乱序/重复、迟到写、权限升级、hook/MCP、turn failure、取消、进程崩溃和删除故障。

这关闭 Q6 的正式实现与本机 authenticated gate，但不等于 beta 发布：Ubuntu、Windows、Node 20/22 和 npm 安装 fixture 仍属于 Q7 发布矩阵，未通过前不得宣传跨平台可用。

## 只读源码投影

Codex 需要文件系统工具，因此 Manager 从通用 `AskReadSnapshot` 创建 Job 私有投影：

```text
<os-temp>/spotpatch-ask-<opaque>/workspace/
└── src/... # 最多 maximumReadFiles 个已授权普通文本文件
```

源清单只通过 `turn/start` 输入传递，不写入 workspace。投影只含 target source 与确定性候选文件，内容与 Key executor 的 snapshot 相同。不得复制 `.git`、`.env*`、锁文件、凭据、用户目录、原项目绝对路径或未授权 untracked 文件。目录位于业务仓库外，权限归当前用户，文件在启动 App Server 前设为只读。

源文件中即使存在 `AGENTS.md`/规则命名，也按普通未授权文件排除；`thread/start` 返回的 `instructionSources` 必须为空。若 Codex 自动加载任何额外 instruction、hook、MCP、plugin 或 app，preflight fail closed。

## 固定配置

Ask 配置由服务端常量构造，Browser/问题/selection 不可覆盖：

```text
profile                 managed-ask-v1
permission profile      spotpatch-ask-readonly
cwd/runtime root        当前 Job 只读投影
filesystem              root deny + minimal read + projection read
workspace write         none
network tools           disabled
web search              disabled
approval                never
agents/subagents         disabled
hooks/plugins/apps       disabled
MCP servers              empty
process/*                client never calls
thread/shellCommand      client never calls
```

若当前 Codex 只支持 broad read-only full access、无法限制到投影和必要平台 defaults，不得启用。`approval: never` 不代表安全；真正边界是 OS/permission profile 的不可写和可读 root。

## 线程与 turn

每个 Ask 使用新 thread，不 resume、不 fork、不 steer、不 compact：

1. 独立 runtime/config/auth 预检；
2. `thread/start` 指向投影，优先使用已验证的 ephemeral；
3. 校验 effective cwd/runtime roots、active profile、instructionSources、hooks/MCP；
4. `turn/start` 发送一个问题、选择摘要、source manifest 和严格 `outputSchema`；
5. 只处理匹配 threadId/turnId 的事件；
6. 收到 authoritative final agentMessage + successful turn 后校验 AnswerDraft；
7. 生成 AnswerResult 后尝试删除 thread；锁定版本对 ephemeral thread 的精确 not-persisted 结果等价于已清理；
8. 无论成功、失败或取消都删除独立 runtime 与投影。若未来版本不能证明 ephemeral，则该版本直接 unavailable，不静默回退持久 thread。

输出的 wire Schema 与 (见 doc-id:context-qa-04-model-protocol) 的 `AskAnswerDraft` blocks/citations/warnings 等价。由于 Structured Outputs 不接受 block `oneOf`，wire block 固定包含 nullable/empty 占位字段；服务端按 kind 强制互斥并转换为严格公共 Draft。Codex 提交的 citation 使用预先签发的 handleId 和行范围；Manager 验证 handleId、行界、hash 和目标关联，再生成 result sourceId 并投影 fileId。不能从任意路径字符串创建引用。

## 事件判定

- `turn/start` response：请求被接受，不是 dispatched answer；
- `turn/started`：running；
- `item/agentMessage/delta`：仅用于有界 UI 接收反馈，不能作为最终答案；
- `item/completed` + `agentMessage` + `phase: final_answer`：最终文本候选；若锁定版本不提供 phase，POC 必须证明唯一权威聚合规则；
- `turn/completed status=completed`：协议成功终态；必须与最终 item 同时成立；
- `turn/completed failed/interrupted`：失败/取消；丢弃候选；
- `turn/diff/updated` 非空、`fileChange` item、写 approval、permissions upgrade、未知高风险 request：`ASK_WRITE_ATTEMPTED`，中断 turn、降级 capability；
- reasoning、plan、command output 不进入 Answer/UI，也不作为引用。

必须按 item ID 去重并以 `item/completed` 为权威，不能简单拼 delta 后直接展示。完整 Answer 在服务端验证通过前，Runtime 只显示“正在接收”，不显示可复制的半截内容。

## 反向请求

已知请求采用固定拒绝：

- file change / apply patch approval：decline/cancel；
- command/network/permissions approval：decline/cancel；
- requestUserInput/elicitation：返回空/取消；
- dynamic tool、MCP tool 和 subagent：预检应使其不可出现，出现即协议违规；
- 未知 server request：协议错误并中断，不能默认批准或忽略。

Ask 不需要让 Codex 调用 SpotPatch MCP 回传工具；App Server 的 answer item 是唯一回传通道。这样不会把实验性 dynamic tools 与普通结果混为一体。

## 模型和 capability

requested/effective model 分开记录；`model/rerouted` 只更新安全 label 和诊断，不改变 Job ID。账户 readiness 继续使用完整 `account/read` 契约，不能从 `account: null` 单字段猜测。

连接级 capability 必须绑定 executable realpath、精确版本、生成 Schema hash、平台、read-only profile、answer event fixture 和 cleanup fixture。升级 Codex 后重新探测；不能用无上限 semver 加“字段看起来没变”直接沿用。

## 完成标准

- 真实 Codex 连续两个独立 Ask 都能返回并清理，不共享 thread/history；
- outputSchema 错误、无 final item、重复 final、迟到 item、turn failed、取消和进程崩溃全部有确定终态；
- 写文件、root 外读取、web、MCP、hook、plugin、subagent 和权限升级的负向测试全部被阻断；
- 原项目、投影和 Codex runtime 清理证据可验证，源码/答案不进入长期日志；
- macOS、Ubuntu、Windows 及项目路径空格/Unicode 的 required matrix 通过后才可标 beta。
