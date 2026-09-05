<h1><a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-npm-icon.png" alt="SpotPatch" width="48" height="48" align="absmiddle" /></a> <code>@spotpatch/compiler</code></h1>

## English

The framework-neutral source compiler shared by SpotPatch adapters. It filters JSX/TSX source, injects development-only source markers, and preserves source maps so a selected browser element can be traced back to authorized source context.

Applications should install a framework adapter such as [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite). This package is adapter infrastructure, not a standalone browser plugin or user-facing integration.

The compiler does not own framework lifecycle, HTTP transport, UI, credentials, or AI execution. Those responsibilities remain in their dedicated packages.

Data-flow instrumentation also accepts original-coordinate module scopes for processed Astro browser scripts. Native DOM event triggers preserve named-listener identity; shared JS/TS helpers retain invocation attribution. Parsing `.astro` templates and injecting native template markers belong to `@spotpatch/astro`, not this package.

Requires Node.js `>=20.19.0`.

## 简体中文

这是 SpotPatch 框架适配器共享的框架无关源码编译器，负责过滤 JSX/TSX、注入仅开发期存在的源码标记并保留 Source Map，使浏览器中选中的元素能够追溯到经过授权的源码上下文。

业务应用应安装 [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite) 等框架适配器。本包属于适配器基础设施，不是独立浏览器插件或用户接入入口。

Compiler 不负责框架生命周期、HTTP 传输、UI、凭据或 AI 执行，这些职责分别归属于其他专用包。

要求 Node.js `>=20.19.0`。

## Links / 链接

- [Repository / 仓库](https://github.com/huanglvjing/spotpatch)
- [Architecture / 架构](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/02-%E6%80%BB%E4%BD%93%E6%9E%B6%E6%9E%84%E4%B8%8E%E6%8A%80%E6%9C%AF%E6%A0%88.md)
- [MIT License / 许可证](https://github.com/huanglvjing/spotpatch/blob/main/LICENSE)
