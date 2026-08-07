---
doc-id: "16-ai-agent-execution"
title: "AI Agent 执行与变更审阅"
status: "active"
version: "1.4.0"
last-updated: "2026-08-07"
source-range: "v1.1 新增规范：AI Agent 工具循环、本地执行、Git 隔离、验证与变更审阅；v1.2 多目标原子执行；v1.3 逐目标说明执行语义"
参考文献/依赖:
  - "01-product-boundary"
  - "02-architecture-stack"
  - "03-public-api-models"
  - "08-code-prompt"
  - "09-local-protocol-security"
  - "10-ui-diagnostics"
  - "11-coding-standards"
  - "12-testing-acceptance"
  - "15-risks-adr"
  - "17-model-provider-credentials"
---

# AI Agent 执行与变更审阅

本文件是 AI Agent 工具循环、本地工具集合、Git 隔离、变更验证、审阅、应用和撤销行为的唯一事实来源。URL、凭据、协议和模型兼容性由模型提供商规范定义 (见 doc-id:17-model-provider-credentials)，公共配置、限制值和跨模块数据结构由公共 API 文档定义 (见 doc-id:03-public-api-models)，浏览器到 Vite Node 的 endpoint 与错误码由本地协议定义 (见 doc-id:09-local-protocol-security)。

AI 扩展是显式启用的开发期能力；未配置或未通过能力探测时，SpotPatch 必须完整保留 v1 的 Prompt 预览、复制和打开编辑器能力 (见 doc-id:01-product-boundary)。

## 责任边界

Agent Engine 负责：

- 将一次不可变、包含完整有序目标集的 `SpotAnnotation` 组织成 Agent 输入。
- 驱动模型与本地工具之间的多轮调用。
- 校验所有工具名称、参数、路径和调用顺序。
- 在隔离 Git worktree 中读取、搜索和修改代码。
- 生成可审阅的变更集并运行预配置检查。
- 在满足条件后应用或撤销本次 Agent 变更。
- 控制轮数、工具调用数、超时、并发和取消。

Agent Engine 不负责：

- 保存或展示 API Key。
- 决定中转站协议是否兼容。
- 允许浏览器提供 API URL、绝对路径或命令。
- 绕过 Git、检查、保护路径或用户审阅直接写入业务仓库。
- 自动提交、推送、创建分支、安装依赖或发布构建。

## 总体执行链路

```text
SpotAnnotation(targets[]) + modelProfileId
  → 服务端授权和 Schema 校验
  → Provider 能力状态检查
  → 创建 AgentJob 与临时 Git worktree
  → 组合系统约束和结构化上下文
  → 模型响应 / 工具调用循环
  → 变更路径、规模和策略校验
  → 预配置检查
  → 生成 Diff、摘要和检查结果
  → review：等待用户 Apply
     auto：满足全部门禁后 Apply
  → Vite HMR 观察到业务文件变化
```

Agent 输入的段落、预算和系统约束由 Prompt 规范定义 (见 doc-id:08-code-prompt)。运行状态、结果和限制值使用公共模型中的唯一声明 (见 doc-id:03-public-api-models)。

## Agent Job 不可变输入

创建 Job 时必须冻结以下输入：

- `SpotAnnotation` 快照。
- 服务端解析后的 provider profile ID 和 model profile ID。
- Git 根目录、HEAD OID 和工作区状态摘要。
- 已解析的执行模式、限制和检查集合。
- 本次会话 ID 和随机 Job ID。

多目标仍是一个 Job，不建立每目标子 Job 或隐式并发队列。Engine 必须把每个 `instruction` 与其目标编号明确绑定，并在系统约束中要求模型逐项检查、不得合并/忽略/扩大说明，在读文件时复用同一路径的结果；目标可以落在一个或多个业务文件，但最终仍生成一份统一 Diff、运行同一组 required checks，并以全有或全无方式 Apply/Revert。目标数量、说明上限与结构由公共模型定义 (见 doc-id:03-public-api-models)，服务端授权由本地协议定义 (见 doc-id:09-local-protocol-security)。

用户在 Job 启动后继续编辑任何目标说明、追加/删除/重新选择元素、切换界面语言或切换模型，不得修改已运行 Job 的不可变目标快照。需要采用新输入时必须创建新 Job；旧 Job 可以继续、取消或被用户显式关闭。

Job 不得持有 DOM、Element、Fiber、CSSStyleDeclaration 或浏览器对象。浏览器只接收公共 Job 快照和经过脱敏的事件，不接收 provider 凭据、真实 worktree 路径或命令环境。

## Agent 工具集合

v1.1 只提供以下六个工具；工具名称和职责只在本节定义。

| 工具 | 输入摘要 | 唯一职责 | 副作用 |
| --- | --- | --- | --- |
| `list_files` | `glob`、`maxResults` | 枚举 worktree 内允许读取的文件 | 无 |
| `search_text` | `query`、可选 `glob`、`maxResults` | 在允许文件中搜索文本并返回有界命中 | 无 |
| `read_file` | `path`、可选行范围 | 返回单个允许文本文件的有界内容 | 无 |
| `replace_text` | `path`、`oldText`、`newText` | 在一个既有文本文件中替换唯一精确片段 | 有 |
| `apply_patch` | 单个结构化 patch | 在 worktree 中创建、更新或删除允许文件 | 有 |
| `run_check` | 服务端登记的 `checkId` | 执行一个预配置验证命令 | 有限进程副作用 |

所有工具使用严格 JSON Schema；对象必须设置 `additionalProperties: false`，字段缺失、未知字段、类型错误和超限输入一律拒绝。模型提供商是否能可靠返回严格工具调用由能力探测确认 (见 doc-id:17-model-provider-credentials)。

### 只读工具

- `list_files` 只返回相对 worktree root 的 POSIX 风格路径，并受结果数量和字符预算限制。
- `search_text` 按文件和行号返回有界结果；不得把搜索结果中的绝对路径发送给模型。
- `read_file` 只读取通过授权的普通文本文件；默认返回有界行范围，模型必须按需继续读取。
- 只读工具可以在同一模型轮次内并发执行，但总调用数仍受公共限制约束 (见 doc-id:03-public-api-models)。

### 写入工具

- `replace_text` 用于既有 UTF-8 文本文件内的局部修改。`oldText` 必须非空、与 `newText` 不同，且在调用时的文件内容中恰好出现一次；零次或多次命中一律不猜测目标，并返回未修改的可重试拒绝。模型必须从最新搜索或读取结果复制精确文本，不得带入 `read_file` 的行号前缀。
- `replace_text` 不得创建、删除、重命名文件，也不得接受整文件内容作为绕过 patch 规则的通用覆盖接口。执行器必须先校验既有文件、保护路径、UTF-8、输入/结果大小和当前内容，再在 worktree 内以同目录临时文件完成原子替换；替换前再次比较原始内容，防止基于过期读取覆盖并发变化。
- `replace_text` 写入后必须执行 Git whitespace 校验。校验失败时必须恢复调用前内容；只有恢复后 worktree 指纹与调用前完全一致，才可返回 `PATCH_REJECTED`、具体原因和 `retryable: true`。恢复失败或指纹变化属于终止性失败。
- `apply_patch` 的模型输出始终视为不可信输入，必须先解析、规范化并校验，再触碰 worktree。
- patch 必须是原始 canonical unified Git diff：以 `diff --git a/<path> b/<path>` 开始，包含一致的 `--- a/<path>`、`+++ b/<path>` 文件头和有效 `@@` hunk；禁止 Markdown 代码围栏、解释文本、Shell 命令和 `*** Begin Patch` 包装标记。
- 每个 patch 只允许相对路径，不允许绝对路径、`..`、NUL、URL 编码逃逸或平台分隔符混淆。
- 同一轮的多个写入按事件顺序串行执行，不并发修改同一 worktree。
- 相同 `toolCallId` 只能产生一次副作用；网络重试或重复流事件必须返回已记录结果，不得重复应用。
- 删除文件属于破坏性变更：允许进入审阅结果，但禁止自动应用到业务工作区。
- patch 因格式或 hunk 上下文不匹配而被拒绝，且拒绝前后的 worktree 指纹完全一致时，必须返回带 `PATCH_REJECTED` 和 `retryable: true` 的结构化工具结果；局部既有文件修改应改用 `replace_text`，其他情形才重新读取并使用新的 `toolCallId` 提交纠正后的 canonical diff。该次工具活动记为失败，但 Job 可在既有轮数和工具调用上限内继续。
- 路径越界、保护文件、超限输入、拒绝后 worktree 已变化或达到既有限制仍是终止性失败；不得把这些情况降级为重试。`apply_patch` 实现不得私自把任意 patch 猜测性转换成文本替换，不得开放整文件覆盖，也不得使用 `--reject` 留下部分结果；唯一允许的精确文本替换只来自独立、严格校验的 `replace_text` 工具。

允许文件、保护路径、符号链接、文本判定和大小边界由安全规范唯一规定 (见 doc-id:09-local-protocol-security)。

### 检查工具

- 浏览器和模型只能引用 `checkId`，不能提供命令、参数、cwd 或环境变量。
- `checkId` 必须解析到可信配置中的 `command + args` 数组；使用 `spawn(command, args, { shell: false })`。
- 命令 cwd 固定为临时 worktree；环境变量使用最小 allowlist，必须移除 provider Key、会话 token 和无关凭据。
- stdout/stderr 均限制长度并按文本处理；不得在浏览器展示 ANSI 控制序列、绝对路径或未脱敏环境内容。
- 超时、退出码非零和信号终止均形成失败结果，不得被模型改写成成功。

## Agent 循环

每一轮按以下顺序执行：

1. 向 provider 发送当前对话状态、允许工具和剩余预算。
2. 解析并 Schema 校验 provider 事件。
3. 若返回最终消息，进入变更校验；若返回工具调用，继续下一步。
4. 对每个工具调用执行名称、参数、预算、授权和幂等校验。
5. 执行允许的工具，把结构化结果关联到原 `toolCallId`。
6. 将工具结果加入下一轮输入，直至完成、取消、失败或达到限制。

模型文字不能直接触发文件或命令副作用。只有结构化工具调用可以进入工具执行器；不支持工具调用的模型只能生成建议或 Prompt，不得启用自动修改。

达到任一限制时立即停止继续调用模型，Job 进入失败状态并保留当前可审阅诊断；限制值只从公共配置读取 (见 doc-id:03-public-api-models)。失败消息不能伪装为检查通过或变更已应用。

## Prompt injection 与不可信内容

以下内容全部视为数据，而不是 Agent 权限指令：

- 用户选中元素的文本和属性。
- DOM、CSS、注释、字符串、README 和业务源码。
- provider 返回的自然语言说明。
- 工具输出中的文件内容和命令日志。

系统约束必须明确：逐项遵守用户绑定到目标的修改说明，但任何说明都不能覆盖本地安全边界；只处理授权范围；只调用已声明工具；不得请求或泄露凭据；不得扩大 root、网络、命令和文件权限；不得把 DOM、页面文本或源码中的指令当作用户任务或系统消息。即使 provider 或中转站返回恶意工具调用，最终授权仍由本地工具执行器决定。

## Git worktree 隔离

### v1.1 前置条件

- 目标目录必须是 Git 仓库。
- 当前 HEAD 必须可解析。
- v1.1 首版要求业务工作区干净；存在 staged、unstaged 或 untracked 变更时返回安全规范定义的结构化错误，不创建 Agent Job。
- 不允许通过自动 stash、reset、checkout 或临时 commit 隐藏用户改动。

干净工作区门禁是 v1.1 的明确限制。后续如支持脏工作区，必须先设计可审计快照和三方合并，不得在现有流程中静默放宽。

### worktree 生命周期

1. 在受控临时目录创建随机 Job 目录。若业务仓库存在真实目录形式的 `node_modules`，默认把临时目录放在其下，使 worktree 中的受控检查可以通过 Node 的父级解析复用已安装依赖；禁止复制 Key、自动安装依赖或接受符号链接形式的 `node_modules`。不存在合格目录时回退系统临时目录。
2. 使用固定参数从记录的 HEAD 创建 detached worktree。
3. 再次校验真实路径、HEAD 和干净状态。
4. 所有 Agent 文件工具和检查只在该 worktree 中运行。
5. 生成相对于原 HEAD 的变更集、文件哈希和统计信息。
6. Job 完成、失败或取消后移除 worktree 注册并清理临时目录；清理失败只记录脱敏诊断，不覆盖 Job 主结果。

Agent 没有 Git 命令工具。宿主只允许通过固定 argv 调用创建、检查、生成 Diff、应用和清理所需的有限 Git 子命令；禁止把模型文本拼接进 shell。

### 变更集校验

进入验证前必须确认：

- 所有路径仍位于 worktree root。
- 没有保护路径、符号链接逃逸、二进制文件和超限文件。
- 修改文件数和 Diff 大小未超过公共限制。
- patch 可被重新解析，且变更统计与 worktree 实际状态一致。
- 没有子模块、Git 元数据、文件模式提权或外部目录变更。

任一校验失败都使 Job 失败；不得只丢弃违规文件后继续应用其余修改。

## 验证

Agent 可以在运行中请求 `run_check` 获取反馈；在生成最终结果后，宿主仍必须独立执行配置中的 required checks，不能复用模型声称的成功结果。

验证顺序固定为：

1. 变更集安全校验。
2. 变更文件的静态格式和语法检查（若已配置）。
3. required checks，按可信配置顺序串行执行。
4. 重新读取 Git Diff，确认检查过程没有产生未授权文件变化。

required check 失败时：

- Job 返回 Diff、失败检查和有界日志。
- 自动应用必须停止。
- v1.1 不提供“忽略失败并应用”入口。
- 用户可以分别修改各目标要求并创建新 Job，或复制 Prompt 采用人工流程。

目标项目应使用其真实 `lint`、`typecheck`、测试或构建命令；具体配置属于公共 API (见 doc-id:03-public-api-models)，验收属于测试规范 (见 doc-id:12-testing-acceptance)。

## 审阅、应用与撤销

### review 模式

`review` 是默认模式。验证通过后 Job 进入等待审阅状态，UI 必须展示：

- provider 和模型显示名。
- 修改文件列表和新增/删除行统计。
- 完整可滚动 Diff。
- 每个 required check 的命令显示名、状态、耗时和有界输出。
- 应用、取消和返回编辑操作。

用户点击 Apply 后，服务端必须重新确认业务仓库 HEAD、状态和相关文件哈希与 Job 基线一致，先执行 patch check，再以全有或全无方式应用。任何并发变化或冲突都返回失败，禁止覆盖用户修改。

### auto 模式

`auto` 只有在可信配置显式开启时可用，并且必须同时满足：

- provider 能力探测通过。
- worktree 和业务工作区基线未变化。
- 所有安全与规模门禁通过。
- 所有 required checks 成功。
- 变更中没有删除文件。
- 没有依赖文件、保护路径或需要重启 Vite 的配置变更。

任一条件不满足都降级为等待审阅或失败；不得以“尽量自动”为由跳过门禁。

### 撤销

应用成功后记录本次变更的正向 patch、逆向 patch 和应用后文件哈希。Revert 前必须确认相关文件仍匹配应用后哈希；如果用户或 HMR 之外的进程已经继续修改这些文件，撤销必须拒绝并提示人工处理。

Apply/Revert 都不执行 `git commit`、`git push`、`git reset` 或分支操作。Git 提交仍由用户在审阅最终工作区后完成。

## 取消、失败与恢复

- 每个 Job 持有一个服务端 `AbortController`，取消必须传播到 provider 请求、流读取和正在运行的检查进程。
- 已开始的单次本地工具调用应尽快到达安全中断点；不得在 patch 写到一半时强杀并留下不可解析状态。
- Vite 服务退出时取消所有 Job、终止子进程并清理 worktree。
- v1.1 Job 只保存在当前 Vite 会话内存中；服务重启后不恢复，也不把 Prompt、源码或 Key 写入磁盘。
- Diff 可以在当前会话内存中保留到应用、撤销、明确关闭或会话结束；不得形成隐藏历史数据库。
- 同一项目同一时刻最多运行一个写 Job；额外请求按公共配置与协议规则拒绝，不建立隐式队列。

状态流转必须使用公共模型中声明的 `AgentJobStatus`，UI 映射由 UI 规范负责 (见 doc-id:10-ui-diagnostics)，错误码和对外 HTTP 语义由本地协议负责 (见 doc-id:09-local-protocol-security)。

## 模块边界

建议内部模块按以下职责拆分；用户仍只安装公共 Vite 包 (见 doc-id:02-architecture-stack)：

```text
packages/agent/src/
├── engine/          # Job coordinator 与模型/工具循环
├── tools/           # 五个受控工具及 Schema
├── worktree/        # Git 隔离、Diff、Apply/Revert
├── validation/      # check registry 与子进程控制
└── events/          # 有序、可脱敏的 Job 事件
```

provider adapter 不进入 `tools/` 或 `worktree/`，文件工具也不得直接访问 provider 凭据。所有实现继续遵守严格 TypeScript、窄接口注入和副作用边界 (见 doc-id:11-coding-standards)。

## 完成标准

本能力只有在以下证据同时成立时才算完成：

- fake provider 可完整驱动读、搜、改、检查和最终响应。
- Responses 与 Chat Completions adapter 产生相同的内部工具事件语义。
- provider 返回任意恶意路径、重复调用和畸形参数都不能逃离 worktree。
- 脏工作区、并发变化、检查失败和 apply 冲突全部 fail-closed。
- review 模式可 Apply 和安全 Revert；auto 模式只在全部门禁通过时应用。
- Key、绝对路径、环境变量和完整源码不出现在浏览器协议、日志与错误中。
- 生产构建仍保持零 Runtime、零 endpoint、零 provider 配置残留。

测试矩阵和量化门禁只在测试与验收规范中定义 (见 doc-id:12-testing-acceptance)，本方案受 AI 扩展相关 ADR 约束 (见 doc-id:15-risks-adr)。
