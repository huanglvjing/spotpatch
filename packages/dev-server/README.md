<p align="center">
  <a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-logo.svg" alt="SpotPatch" width="560" /></a>
</p>

# `@spotpatch/dev-server`

## English

The framework-neutral, Node-only development service shared by SpotPatch adapters. It owns validated options, session and source registries, authorized local HTTP handlers, bounded source context, editor launching, Runtime bootstrap configuration, and optional Agent orchestration.

Applications should install a framework adapter such as [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite). Browser code must never import this package, and provider credentials must remain in its trusted Node environment.

The service is development-only. Production adapters must omit it together with all private endpoints and source-registration state.

Requires Node.js `>=20.19.0`.

## 简体中文

这是 SpotPatch 框架适配器共享的框架无关、Node-only 开发服务，负责经过校验的选项、会话与源码注册、授权本地 HTTP Handler、有界源码上下文、编辑器启动、Runtime bootstrap 配置和可选 Agent 编排。

业务应用应安装 [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite) 等框架适配器。浏览器代码绝不能导入本包，Provider 凭据也必须只保留在可信 Node 环境中。

本服务仅限开发期。生产适配器必须同时移除本包、全部私有端点和源码注册状态。

要求 Node.js `>=20.19.0`。

## Links / 链接

- [Repository / 仓库](https://github.com/huanglvjing/spotpatch)
- [Security model / 安全模型](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/09-%E6%9C%AC%E5%9C%B0%E5%8D%8F%E8%AE%AE%E4%B8%8E%E5%AE%89%E5%85%A8.md)
- [MIT License / 许可证](https://github.com/huanglvjing/spotpatch/blob/main/LICENSE)
