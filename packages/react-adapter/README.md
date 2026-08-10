<p align="center">
  <a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-logo-mark.svg" alt="SpotPatch logo mark" width="144" /></a>
</p>

# `@spotpatch/react-adapter`

## English

The isolated React/Fiber compatibility boundary used by SpotPatch to associate rendered host elements with probable business components and source-marker evidence.

Applications should install and configure [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite) instead. This package is versioned separately so React internals remain isolated from the browser Runtime and framework adapters; it is not a standalone integration surface.

The package peer range is React `>=18.2.0 <20`, but SpotPatch's current public Vite support promise remains React 18.2–18.3. React 19 behavior may degrade in a controlled way and must not be inferred from the peer range alone.

## 简体中文

这是 SpotPatch 隔离 React/Fiber 兼容逻辑的边界，用于把渲染后的 Host Element 与可能的业务组件及源码标记证据关联起来。

业务应用应安装并配置 [`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite)。本包独立版本化是为了把 React 内部实现与浏览器 Runtime、框架适配器隔离，不是独立接入入口。

Package peer 范围是 React `>=18.2.0 <20`，但 SpotPatch 当前 Vite 正式支持承诺仍是 React 18.2–18.3。React 19 可能受控降级，不能仅根据 peer 范围推断完整支持。

## Links / 链接

- [Repository / 仓库](https://github.com/huanglvjing/spotpatch)
- [Support boundary / 支持边界](https://github.com/huanglvjing/spotpatch/blob/main/docs/%E6%8A%80%E6%9C%AF%E6%96%B9%E6%A1%88/01-%E4%BA%A7%E5%93%81%E5%AE%9A%E4%B9%89%E4%B8%8E%E8%BE%B9%E7%95%8C.md)
- [MIT License / 许可证](https://github.com/huanglvjing/spotpatch/blob/main/LICENSE)
