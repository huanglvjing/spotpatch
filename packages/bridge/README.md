<h1><a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-npm-icon.png" alt="SpotPatch" width="48" height="48" align="absmiddle" /></a> <code>@spotpatch/bridge</code></h1>

## English

The development-only local bridge between SpotPatch and external Agent hosts. Its Inbox mode exposes four bounded, project-content-read-only MCP tools and matching CLI commands for listing local sessions, reading the current user-published handoff, waiting once, and recording an in-memory pickup receipt.

Active mode is explicit and adapter-specific: the experimental Claude Channel server can notify an already-running, Channel-enabled Claude Code session; the zero-setup Codex Connector injects SpotPatch MCP into a dedicated App Server thread after explicit `--allow-workspace-write` consent. Cursor and generic MCP hosts remain Inbox-only. The shared managed-writer lease is scoped to one development session and is not an operating-system-wide lock.

Handoff content stays in the SpotPatch development server's memory and is read through an authenticated IPv4-loopback Broker. Claude Channel events contain only bounded session/revision/cursor references. A Codex App Server turn instead receives a bounded task projection derived from the validated handoff: a normalized project-relative source location, a tag-only element identity, and each user instruction. Absolute, backslash-based, dot-traversal, empty-segment, and control-character paths are rejected before the vendor request. Full DOM, selectors, styles, source excerpts, page data, and tokens do not enter the active Codex turn. Targets without an actionable source location, or multi-target projections that are not unique, fail before `turn/start` rather than asking Codex to guess. Its injected MCP process is bound to the exact selected development session, and only the session-list probe is exposed to the Codex model. Explicit Generic Inbox mode exposes all four Inbox tools, with get/wait providing the full validated context; Claude active mode exposes those exact-session-scoped tools plus its result-reporting tool. SpotPatch never bypasses host permissions, relays approvals, enables sandbox-command network access, or interprets a completed Agent turn as proof that the requested code change is correct.

Run the framework adapter commands from the exact project root that owns the active SpotPatch development session:

```bash
pnpm exec spotpatch-next bridge setup --client claude --scope project --mode active --write
MCP_PROTOCOL_NEGOTIATION=legacy claude --dangerously-load-development-channels server:spotpatch

pnpm exec spotpatch-next connect codex --allow-workspace-write
```

Replace `spotpatch-next` with `spotpatch-vite` in Vite projects. Setup is a dry run unless `--write` is supplied. No `nvm` step is required; the installed framework package only requires the current Node.js process to satisfy `>=20.19.0`. The legacy environment variable belongs on the Claude host process, not only on its MCP child. If the exact root has multiple active development sessions, first run `bridge sessions --json`, then add `--session <opaque-id>` to `channel claude` or `connect codex`; omitting it fails rather than choosing the newest session.

```text
pnpm exec spotpatch-next bridge channel claude [--session <opaque-id>]
pnpm exec spotpatch-next connect codex --allow-workspace-write [--session <opaque-id>]
```

Claude Channels remain a Research Preview, require a running session, and have no completion acknowledgement; terminal state depends on Claude calling the SpotPatch result tool. Codex active mode does not read or write project setup: an exact-session, session-list-only SpotPatch MCP entry is injected into the owned thread for readiness verification. Other MCP servers already enabled in normal Codex configuration can still start. The Connector accepts exactly `codex-cli 0.149.0`; optional `setup --client codex` remains Inbox-only. Codex App Server integration remains experimental and the Connector must remain running. After `Codex connected and ready` appears, the quiet long-running process is idle normally; preparation, App Server acceptance, matching turn start, and terminal lines are printed only after their respective evidence exists. The Connector becomes ready for another request only after a terminal state. `SIGINT`/`SIGTERM` also cancels Session discovery or App Server preflight and closes any process already started. If the development Session ends or restarts, the exact-session Connector stops and must be rerun instead of silently attaching to a new Session. POSIX process-group cleanup has automated coverage; Windows process-tree cleanup is `not-tested`.

This integration is `local-validation`, not stable host support. Deterministic fake-host/two-handoff tests pass, and a consecutive two-revision Codex flow has been manually validated on the recorded macOS/Next.js/Codex 0.149.0 environment after the bounded-task and exact-session fixes. Claude's real two-click flow, repeatable real-host automation, other Codex versions, and Windows process-tree cleanup remain `not-tested`; Cursor remains Inbox-only.

This package is development-only and requires Node.js `>=20.19.0`.

## 简体中文

这是 SpotPatch 与外部 Agent 宿主之间仅限开发期的本地桥接包。Inbox 模式提供四个对项目内容只读、有明确边界的 MCP 工具和对应 CLI，用于列出本地会话、读取用户明确发布的当前交接、单次等待，以及在内存中记录取件状态。

主动模式必须由用户显式启动，并按宿主分别实现：实验性的 Claude Channel server 只能通知一个已经运行且启用了 Channel 的 Claude Code 会话；零配置 Codex Connector 在用户传入 `--allow-workspace-write` 后，把 SpotPatch MCP 注入专用 App Server thread。Cursor 和普通 MCP 宿主仍为 Inbox-only。共享的受管 writer lease 只约束一个开发 Session，不是操作系统级全局锁。

交接正文只保存在 SpotPatch 开发服务内存中，并通过带鉴权的 IPv4 loopback Broker 读取。Claude Channel 事件只携带有界的 session/revision/cursor 引用。Codex App Server turn 则接收从已验证 Handoff 派生的有界任务投影：规范化的项目相对源码位置、仅标签名的元素标识和每个用户 instruction；绝对路径、反斜杠路径、点号越界、空路径段和控制字符会在厂商请求前被拒绝。完整 DOM、selector、样式、源码摘录、页面数据和 token 不进入主动 Codex turn。目标缺少可执行源码位置或多目标投影不唯一时，会在 `turn/start` 前失败，不让 Codex 猜测。其注入的 MCP 进程强制绑定到精确开发 Session，且只向 Codex 模型暴露 Session 列表预检。显式 Generic Inbox 模式提供全部四个 Inbox 工具，其中 get/wait 提供完整的已验证上下文；Claude 主动模式提供这些绑定到精确 Session 的工具，并另外提供结果上报工具。SpotPatch 不绕过宿主权限、不转发审批、不为沙箱命令开放网络，也不会把 Agent turn 的 completed 冒充成代码修改正确。

请在当前 SpotPatch dev Session 所属的精确项目根使用框架适配器命令：

```bash
pnpm exec spotpatch-next bridge setup --client claude --scope project --mode active --write
MCP_PROTOCOL_NEGOTIATION=legacy claude --dangerously-load-development-channels server:spotpatch

pnpm exec spotpatch-next connect codex --allow-workspace-write
```

Vite 项目将 `spotpatch-next` 替换为 `spotpatch-vite`。setup 默认只预览，只有显式添加 `--write` 才会落盘。不需要执行 `nvm`；只要当前 Node.js 进程满足框架包声明的 `>=20.19.0`。legacy 环境变量必须设置在 Claude 宿主进程，不是只设置给 MCP 子进程。若精确项目根有多个活跃 dev Session，先运行 `bridge sessions --json`，再给 `channel claude` 或 `connect codex` 添加 `--session <opaque-id>`；缺省时会失败，不猜测最新 Session。

```text
pnpm exec spotpatch-next bridge channel claude [--session <opaque-id>]
pnpm exec spotpatch-next connect codex --allow-workspace-write [--session <opaque-id>]
```

Claude Channels 仍为 Research Preview，需要会话正在运行，且没有 completion ACK；终态依赖 Claude 调用 SpotPatch 结果 tool。Codex 主动模式不读取或写入项目 setup，而是向 Connector 拥有的 thread 注入 exact-session、仅 Session-list 可见的 SpotPatch MCP 入口做就绪验证；用户普通 Codex 配置中已启用的其他 MCP server 仍可能启动。Connector 当前只接受 `codex-cli 0.149.0`；可选的 `setup --client codex` 仅用于 Inbox。Codex App Server 集成仍是实验能力，Connector 进程必须保持运行。出现 `Codex connected and ready` 后命令安静常驻是正常空闲状态；SpotPatch 准备派发、App Server 接受、匹配 turn 开始和终态都只在各自证据成立后输出，且只有 terminal 后才重新 ready。SIGINT/SIGTERM 在 Session discovery 或 App Server 预检期间也会取消启动并关闭已创建的进程。开发 Session 结束或重启时，绑定旧精确 Session 的 Connector 会停止并要求重跑，不会静默附着新 Session。POSIX 进程组清理有自动化覆盖；Windows 进程树清理仍为 `not-tested`。

该集成当前仅为 `local-validation`，不是稳定宿主支持。确定性的假宿主/连续两 Handoff 自动化已经通过；有界任务和 exact-session 修复后，又在记录的 macOS/Next.js/Codex 0.149.0 环境人工验证了连续两个 revision。Claude 真实双次流程、可重复真实宿主自动化、其他 Codex 版本和 Windows 进程树清理仍为 `not-tested`；Cursor 保持 Inbox-only。

本包仅限开发期，要求 Node.js `>=20.19.0`。

## Links / 链接

- [Repository / 仓库](https://github.com/huanglvjing/spotpatch)
- [External Agent design / 外部 Agent 方案](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/19-%E5%A4%96%E9%83%A8Agent%E8%BF%9E%E6%8E%A5%E4%B8%8E%E4%BA%A4%E6%8E%A5%E6%8F%90%E6%A1%88.md)
- [MIT License / 许可证](https://github.com/huanglvjing/spotpatch/blob/main/LICENSE)
