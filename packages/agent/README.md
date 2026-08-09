<p align="center">
  <a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-logo.svg" alt="SpotPatch" width="560" /></a>
</p>

# `@spotpatch/agent`

## English

The Node-only Agent engine used by SpotPatch framework adapters. It owns OpenAI-compatible provider sessions, capability probes, bounded file tools, isolated Git worktrees, validation checks, Diff review, Apply, and conflict-safe Revert.

Applications should enable this capability through a framework adapter such as [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite). This package is public so the adapter dependency graph can be installed and versioned; it is not a standalone UI integration.

Security boundaries:

- no model-controlled arbitrary shell;
- no browser-side API keys;
- bounded paths, reads, writes, Diff sizes, turns, and tool calls;
- no implicit stash, reset, commit, push, publish, or deployment;
- review is the default apply mode.

Requires Node.js `>=20.19.0`.

## 简体中文

这是 SpotPatch 框架适配器使用的 Node-only Agent 引擎，负责 OpenAI-compatible Provider 会话、能力探测、有界文件工具、隔离 Git worktree、项目检查、Diff 审阅、Apply 和冲突安全的 Revert。

业务应用应通过 [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite) 等框架适配器启用该能力。本包公开发布是为了形成可安装、可版本化的依赖图，不是独立 UI 接入入口。

安全边界包括：不向模型开放任意 Shell、不把 API Key 放入浏览器、限制路径/读写/Diff/轮次/工具调用，并且不隐式执行 stash、reset、commit、push、发包或部署。默认应用模式必须经过审阅。

要求 Node.js `>=20.19.0`。

## Links / 链接

- [Repository / 仓库](https://github.com/huanglvjing/spotpatch)
- [AI execution model / AI 执行模型](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/16-AIAgent%E6%89%A7%E8%A1%8C%E4%B8%8E%E5%8F%98%E6%9B%B4%E5%AE%A1%E9%98%85.md)
- [MIT License / 许可证](https://github.com/huanglvjing/spotpatch/blob/main/LICENSE)
