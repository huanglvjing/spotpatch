<h1><a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-npm-icon.png" alt="SpotPatch" width="48" height="48" align="absmiddle" /></a> <code>@spotpatch/analyzer</code></h1>

## English

The Node-only static component data-flow analyzer used by SpotPatch framework adapters. It builds a bounded TypeScript Program, resolves import and symbol identities, traces supported component event/effect/Store call paths to fetch or Axios callsites, and emits immutable, sanitized evidence reports.

Applications should install a framework adapter such as [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite). This package is adapter infrastructure, not a standalone CLI, browser plugin, or general-purpose code analyzer.

The analyzer never executes project source and does not own HTTP endpoints, browser recording, UI, credentials, or AI. It does not collect request/response values. Unsupported or budget-truncated paths remain partial or unknown instead of being guessed.

Requires Node.js `>=20.19.0`.

## 简体中文

这是 SpotPatch 框架适配器使用的 Node-only 组件数据链路静态分析器。它创建有界 TypeScript Program，按 import/symbol identity 解析代码，从受支持的组件事件、effect 与 Store 调用链追踪到 fetch/Axios callsite，并输出不可变、已清洗、带证据的报告。

业务应用应安装 [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite) 等框架适配器。本包属于适配器基础设施，不是独立 CLI、浏览器插件或通用代码分析器。

Analyzer 不执行项目源码，也不负责 HTTP endpoint、浏览器观测、UI、凭据或 AI；它不采集请求/响应原值。范围外或预算截断的路径保持 partial/unknown，不进行猜测。

要求 Node.js `>=20.19.0`。

## Links / 链接

- [Repository / 仓库](https://github.com/huanglvjing/spotpatch)
- [Data-flow Beta status / 数据链路 Beta 状态](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/%E7%BB%84%E4%BB%B6%E6%95%B0%E6%8D%AE%E9%93%BE%E8%B7%AF/13-Beta%E5%AE%9E%E7%8E%B0%E7%8A%B6%E6%80%81%E4%B8%8E%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C.md)
- [MIT License / 许可证](https://github.com/huanglvjing/spotpatch/blob/main/LICENSE)
