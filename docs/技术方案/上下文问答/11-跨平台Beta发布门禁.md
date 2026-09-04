---
doc-id: "context-qa-11-cross-platform-beta"
title: "上下文问答：跨平台 Beta 发布门禁"
status: "proposed"
version: "1.0.0"
last-updated: "2026-09-02"
implementation-status: "implementation-complete; local-evidence-complete; remote-ubuntu-windows-evidence-pending"
source-range: "Ubuntu、Windows、macOS、Node 20/22、npm tarball、Vite/Next 宿主矩阵与 beta 放行"
参考文献/依赖:
  - "context-qa-00-index"
  - "context-qa-06-managed-codex"
  - "context-qa-09-testing-delivery"
  - "15-risks-adr"
---

# 上下文问答：跨平台 Beta 发布门禁

## 当前结论

Q7 的代码、自动化矩阵和本机验证已完成；Ubuntu/Windows GitHub-hosted runner 尚未执行本工作区改动。当前状态是 **beta candidate implementation**，不是 beta。只有远端 required jobs 全绿并记录不可变 run URL 后，才能把 `context-qa-00-index` 和本页改为 `active/beta`。

这一区分是发布安全边界：Windows 路径、`.cmd`、进程树和 npm 可选依赖不能由 macOS 模拟结果证明；workflow 文件存在也不等于 runner 已通过。

## 支持合同

| 维度          | Beta 合同                                                               |
| ------------- | ----------------------------------------------------------------------- |
| Node          | `20.19.0` 与当前 Node 22 LTS；包 `engines` 下限保持 `>=20.19.0`         |
| OS            | `ubuntu-latest`、`windows-latest`；`macos-latest` 作为现有开发/回归平台 |
| 包管理消费    | 发布的 10 个 `@spotpatch/*` tarball 必须可由纯 npm 在空项目一次安装     |
| Vite          | `5.4.21`、`6.4.3`、`7.3.6`                                              |
| Next/React    | Next `15.3.9` + React `18.3.1`；Next `16.3.0` + React `19.2.8`          |
| Managed Codex | `@openai/codex@0.151.0`，每次连接复验版本与 generated Schema            |

Vite 与 Next 的版本号是 beta 的已审计点，不表示任意未来 minor 自动受支持。升级版本必须先扩展矩阵并保留 production 零残留证据。

## npm tarball 黑盒

`scripts/verify-contextual-ask-beta-package.mjs` 是发布前和 CI 共用的单一黑盒入口：

1. 用启动该脚本的精确 pnpm 入口构建 10 个包；
2. 对每个包单独执行 `pnpm pack --json`，不读取 workspace source 作为消费者依赖；
3. 在 canonical realpath 的一次性目录创建纯 npm 项目，一次安装全部 tarball 与指定宿主版本；
4. `npm ls --all --json` 证明每个内部依赖只解析到本次 tarball 版本，阻断 registry 旧版本或 workspace link 污染；
5. 分别验证 CJS、ESM、browser/node subpath、Next loader 和 npm bins；
6. 启动真实 Vite dev server，验证源码标记、虚拟 Runtime/Ask 配置，再做 production build 与残留扫描；
7. 启动 fake Responses Provider 与真实 Next dev server，完成 init、bootstrap、双 executor capability 和 Configured Key 两轮只读工具 probe，再做 production build 与残留扫描；
8. 无论成功失败都终止受控宿主并删除一次性目录。

黑盒不得把包改回 workspace protocol，也不得从源码目录直接 import；否则不能证明 npm 发布物可消费。

## CI 矩阵

### 完整框架版本组合

Ubuntu Node 22 负责 3×2 笛卡尔矩阵：

| Vite   | Next 15 + React 18 | Next 16 + React 19 |
| ------ | -----------------: | -----------------: |
| 5.4.21 |           required |           required |
| 6.4.3  |           required |           required |
| 7.3.6  |           required |           required |

### OS 与 Node 组合

| OS      | Node 20.19 |  Node 22 | 宿主代表            |
| ------- | ---------: | -------: | ------------------- |
| Ubuntu  |   required | required | 旧栈 / 完整框架矩阵 |
| Windows |   required | required | 旧栈 / 新栈         |
| macOS   |   required | required | 旧栈 / 新栈         |

这两张表取并集形成 10 个 npm jobs。另有 Ubuntu Node 20/22 的真实 Chromium Ask E2E，以及三平台 × Node 20/22 的 format、lint、typecheck、unit、build、compat quality jobs。

## Windows 专项约束

- 不通过 `shell: true` 拼接 npm 或 Codex 参数；测试消费使用 Node 安装目录的 `node_modules/npm/bin/npm-cli.js`；
- 不把 URL `.pathname` 当 Windows 文件路径，统一使用 `fileURLToPath`；
- Next 开发宿主退出时只对已记录 PID 调用 `taskkill /t /f`，不使用进程名或模糊匹配；
- npm 全局 Codex 的 `codex.cmd` 只作为定位锚点，不作为执行载体；解析平台可选包后直接 spawn 经 realpath/containment/regular-file/X_OK 复验的 vendor `codex.exe`；
- x64 与 arm64 目标分别固定为 `x86_64-pc-windows-msvc` 与 `aarch64-pc-windows-msvc`；未知架构或缺失可选包均返回 unavailable，不降级到不受审计的 shim 执行。

## 分层证据

| 层                      | 证明内容                                                        | 不证明的内容                           |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------- |
| unit/fault injection    | 协议乱序、写入攻击、取消、迟到、清理、严格结果                  | OS 发行物可运行                        |
| Chromium E2E            | 双 executor UI 身份下的单/多目标、引用、转草稿、可访问性        | 真实模型质量                           |
| npm host black-box      | 发布 tarball、Vite/Next dev/build、Key probe、production 零残留 | Windows/Ubuntu，除非对应 runner 实跑   |
| Codex distribution gate | npm 安装的 0.151.0 原生 executable 与 generated Schema          | 登录态答案                             |
| authenticated live gate | 两个独立 Ask、引用、无 history、runtime cleanup                 | 其他 OS，除非该 OS 有安全登录态 runner |

Codex CLI 支持 npm 安装；App Server 以 JSONL 协议提供深度集成并允许生成与运行版本匹配的 Schema。Windows 同时存在原生 CLI sandbox 与 WSL 路径；本 beta 的 Windows job 验证原生 npm CLI，不把 WSL 结果代替原生结果。依据：[Codex CLI](https://learn.chatgpt.com/docs/codex/cli)、[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)、[Windows WSL](https://learn.chatgpt.com/docs/windows/wsl)。

## 本机证据

2026-09-02 在 macOS 完成：

- Node 20.19.0 / Vite 5.4.21 / Next 15.3.9 / React 18.3.1 npm 黑盒；
- Node 22.23.2 / Vite 6.4.3 / Next 15.3.9 / React 18.3.1 npm 黑盒；
- Node 22.23.2 / Vite 7.3.6 / Next 16.3.0 / React 19.2.8 npm 黑盒；
- 876 unit passed / 4 skipped，24 Chromium E2E passed；
- Next 15/16 的 webpack、Turbopack、production 6 个 loader POC passed；
- format、lint、typecheck、package build、publint、attw、performance、production leakage/budget、compat passed；
- 本机 `codex-cli 0.151.0` distribution/schema gate 和 authenticated 双 Ask live gate passed。

Ubuntu/Windows 结果当前为 **not run**，不是 failed，也不是 passed。

## Beta 放行与失败处理

放行必须同时满足：

1. 当前提交的全部 required CI jobs 成功；
2. 10 个 npm jobs 无 allow-failure、无手工跳过；
3. Windows 两个 npm jobs 都完成 Codex distribution/schema gate；
4. CI 与 release 都调用同一个 `contextual-ask-beta.yml`，release job 必须显式等待完整 10 组合 Gate；
5. 记录 commit SHA、CI run URL、各矩阵结论与 package versions；
6. 更新本页和 `context-qa-00-index` 为 `active/beta`，不修改首阶段范围。

任一 OS/Node/宿主组合失败时保持 internal。可以修复并重跑相同 commit，也可以明确缩小支持合同后重新评审；不得删除失败矩阵但继续宣称原支持范围。
