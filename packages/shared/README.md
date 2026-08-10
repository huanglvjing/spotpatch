<p align="center">
  <a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-logo-mark.svg" alt="SpotPatch logo mark" width="144" /></a>
</p>

# `@spotpatch/shared`

## English

The shared contract package for SpotPatch. It provides immutable data models, bounded protocol schemas, endpoint constants, error codes, runtime bootstrap types, Agent events, and AI configuration types used across Node and browser packages.

Applications should install a framework adapter such as [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite) instead of depending on this package for UI integration. Changes to this package are versioned because they define compatibility between independently built SpotPatch packages.

Requires Node.js `>=20.19.0` when used in Node environments.

## 简体中文

这是 SpotPatch 的共享契约包，提供不可变数据模型、有界协议 Schema、端点常量、错误码、Runtime bootstrap 类型、Agent 事件和 AI 配置类型，供 Node 与浏览器包共同使用。

业务应用应安装 [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite) 等框架适配器，而不是把本包当作 UI 接入。该包独立版本化，是因为它定义了不同 SpotPatch 构建产物之间的兼容契约。

在 Node 环境中使用时要求 Node.js `>=20.19.0`。

## Links / 链接

- [Repository / 仓库](https://github.com/huanglvjing/spotpatch)
- [Public models / 公共模型](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/03-%E5%85%AC%E5%85%B1API%E4%B8%8E%E6%95%B0%E6%8D%AE%E6%A8%A1%E5%9E%8B.md)
- [MIT License / 许可证](https://github.com/huanglvjing/spotpatch/blob/main/LICENSE)
