---
doc-id: "context-qa-12-claude-code"
title: "上下文问答：Claude Code 只读执行器"
status: "proposed"
version: "1.0.0"
last-updated: "2026-09-27"
implementation-status: "implemented; local-live-gate-passed; product-internal"
source-range: "本机 Claude Code headless 无工具会话、快照内嵌、流审计、错误映射与验证证据"
参考文献/依赖:
  - "context-qa-03-architecture"
  - "context-qa-04-model-protocol"
  - "context-qa-06-managed-codex"
  - "context-qa-08-security-performance"
  - "context-qa-10-evolution"
---

# 上下文问答：Claude Code 只读执行器

## 定位

`ask_claude_code_v1`（kind `claude-code`，标签 “Claude Code”）用开发者本机已安装并已登录的 Claude Code 回答 Ask。实现位于 `packages/bridge/src/active/claude/ask-adapter.ts`，与 Key 执行器、Managed Codex 共享 `ContextualAskExecutor` 端口和 `AskAnswerDraft` 结果，不共享执行实现。

它与 (见 doc-id:context-qa-10-evolution) 的 “Claude Code 答案回传” 不是同一能力：后者经 Channel 把问题交给用户正在运行的 Claude 会话，宿主权限由用户自理；本执行器由 dev-server 为每个问题启动一个独立 headless 进程，权限由 SpotPatch 通过命令行参数收紧并逐事件审计。

## 执行模型

每个问题：

1. 重新解析可执行文件：只在 `PATH` 的绝对路径条目中查找 `claude`（Windows 为 `claude.exe`），取 realpath，要求是可执行普通文件，且**不在项目根内**；`--version` 必须匹配 `x.y.z (Claude Code)` 且不低于 2.1.283。
2. 在系统临时目录创建空工作目录 `spotpatch-ask-claude-*` 作为 `cwd`，结束后无论成败均删除。
3. 从服务端签发的只读快照读取已授权源码，按 `handleId` 加 1 起行号嵌入 Prompt（总计上限 240,000 字符；超出的来源列出 handle 并要求模型给出证据不足警告，不静默丢弃）。快照本身仍受 32 文件、单文件 64 KB、总计 512 KB 的限制。
4. Prompt 经 stdin 传入，不出现在进程参数中。
5. 以下参数启动，输出上限 8 MB、超时 280 秒：

```text
--print --output-format stream-json --verbose
--tools "" --strict-mcp-config --setting-sources ""
--disable-slash-commands --no-session-persistence
--json-schema <Ask 答案 wire schema> --model <sonnet|opus|haiku>
```

子进程环境额外设置 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`，避免在 `~/.claude/projects` 留下自动记忆目录。进程以独立进程组运行，超时、取消、输出超限或审计失败时整组 `SIGKILL`。

不使用 `--bare`：它跳过钥匙串读取，会使 claude.ai 账户登录失效。

## 只读证明

`readOnlyProven` 不依赖 Prompt 措辞，而依赖运行时证据：

| 检查 | 失败码 |
| --- | --- |
| 第一个事件必须是 `system/init` | `ASK_PROTOCOL_INCOMPATIBLE` |
| `init.tools` 只允许 `StructuredOutput`（`--json-schema` 引入、无副作用） | `ASK_WRITE_ATTEMPTED` |
| `init.mcp_servers` 必须为空 | `ASK_WRITE_ATTEMPTED` |
| 任何 `tool_use` 名称不是 `StructuredOutput` | `ASK_WRITE_ATTEMPTED` |
| `result` 不是 `success` 或 `is_error` | `ASK_EXECUTOR_UNAVAILABLE` |
| `structured_output` 不符合 wire schema | `ASK_ANSWER_INVALID` |

任一审计失败立即终止进程组。答案随后仍经 dev-server 的引用投影校验，与其他执行器相同。

## Capability 与模型

- 探测不调用模型：可信可执行文件 + 版本 + `claude auth status` 的 `loggedIn`。成功缓存 5 分钟，失败缓存 30 秒。
- 模型列表为 Claude Code 别名 `sonnet`、`opus`、`haiku`，默认 `sonnet`；浏览器提交的其他模型名被拒绝。答案元信息显示 `init.model` 报告的实际模型（例如 `claude-sonnet-5`）。
- `providerDataConsentRequired: true`：所选源码快照会经用户自己的 Claude 账户发送给 Anthropic，提交前必须勾选同意。

## 装配与偏好

Vite、Astro、Next 适配器通过 `createManagedAskExecutors` 同时注册 Managed Codex 与 Claude Code。`contextualAsk.defaultExecutor` 可取 `{ kind: "claude-code" }` 让其排在首位；未指定偏好时顺序为配置 Key、Managed Codex、Claude Code。UI 只显示通过探测的执行器，不可用者在执行器下方给出稳定原因。

## 能力边界

- 模型只能看到嵌入的授权快照，不能自行搜索或读取其他文件；Key 执行器和 Managed Codex 可在快照内按需读取/搜索。
- 仍是单轮问答，没有追问或会话历史。
- Windows 路径解析已实现，但尚无 Windows 实机证据。

## 验证证据（2026-09-27，macOS，Claude Code 2.1.283）

- 单元测试 `packages/bridge/src/active/claude/{ask-adapter,process}.test.ts` 使用假 `claude` 可执行文件覆盖：探测与缓存、未登录、版本过低、项目内可执行文件、参数与 stdin、默认模型、非法模型、init 额外工具、MCP server、非 StructuredOutput 工具调用、缺少 init、非成功结果、非法答案、取消与临时目录清理。
- 真实门禁 `pnpm test:contextual-ask-claude:live`（`SPOTPATCH_RUN_CLAUDE_ASK_LIVE=1`）通过：多文件问题返回的每个引用都落在授权来源行数内，且运行后 `~/.claude/projects` 未新增目录。
- 在 playground 页面端到端选择 `<h1>` 并以 Claude Code 提问，约 7–11 秒返回带 `src/main.tsx:31` 引用的答案。

以上为本机证据，不构成跨平台 Beta 放行（见 doc-id:context-qa-11-cross-platform-beta）。
