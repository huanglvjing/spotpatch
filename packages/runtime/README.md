<p align="center">
  <a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-logo.svg" alt="SpotPatch" width="560" /></a>
</p>

# `@spotpatch/runtime`

## English

The browser Runtime used by SpotPatch framework adapters. It contains the element picker, bounded DOM and CSS collectors, source-context client, localized Shadow DOM workbench, multi-target state, prompt composer, and optional Agent review UI.

Applications should install and configure [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite) rather than bootstrap this package directly. The adapter supplies authenticated development configuration and guarantees that the Runtime is absent from production output.

This package never owns provider credentials or unrestricted filesystem access.

## 简体中文

这是 SpotPatch 框架适配器使用的浏览器 Runtime，包含元素选择器、有界 DOM/CSS 采集器、源码上下文客户端、本地化 Shadow DOM 工作台、多目标状态、Prompt 生成器和可选 Agent 审阅界面。

业务应用应安装并配置 [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite)，而不是直接启动本包。框架适配器负责提供经过认证的开发期配置，并保证生产产物不包含 Runtime。

本包不持有 Provider 凭据，也不具备不受限制的文件系统访问能力。

## Links / 链接

- [Repository / 仓库](https://github.com/huanglvjing/spotpatch)
- [UI and diagnostics / UI 与诊断](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/10-UI%E4%B8%8E%E8%AF%8A%E6%96%AD.md)
- [MIT License / 许可证](https://github.com/huanglvjing/spotpatch/blob/main/LICENSE)
