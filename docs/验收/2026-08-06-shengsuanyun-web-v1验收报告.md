---
doc-id: "acceptance-shengsuanyun-web-2026-08-06"
title: "shengsuanyun-web v1 验收报告"
status: "active"
version: "1.0.0"
last-updated: "2026-08-06"
source-range: "运行验收证据；非规格拆分"
参考文献/依赖:
  - "06-source-resolution"
  - "09-local-protocol-security"
  - "12-testing-acceptance"
  - "13-project-integration"
  - "14-implementation-plan"
---

# shengsuanyun-web v1 验收报告

本文记录实施计划 Milestone 5 (见 doc-id:14-implementation-plan) 的可复现运行证据，不新增或改写规范事实。完成标准以测试与验收
规范为准 (见 doc-id:12-testing-acceptance)，目标项目约束以接入规范为准
(见 doc-id:13-project-integration)。

## 验收基线

| 项目             | 验收值                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- |
| 日期/平台        | 2026-08-06，macOS，Node.js 26.0.0（正式 Node 支持范围外的附加本地验证）             |
| SpotPatch commit | `69cfc5e82fcbb527020f03a1cd804d629a4b14d4`                                          |
| 目标项目 commit  | `de590c326e7105b1bafe0499125aa6d52c029090`                                          |
| 目标依赖         | Vite 6.4.3、React 18.3.1、Ant Design 5.29.3、Framer Motion 11.18.2、Tailwind 3.4.19 |
| 浏览器           | `@playwright/test` 1.62.1 所带 Chromium，无复用登录态                               |

Node 20.19/22 与 macOS/Ubuntu/Windows 的任务已进入 CI 矩阵；本报告没有远程 CI
运行记录，因此不把“已配置”表述为“远程已通过”。

## 接入方式与回滚

由于 `@spotpatch/vite` 尚未发布到 npm，本轮使用 `npm link --no-save` 临时链接本地构建
产物，并只在 `vite.config.ts` 中把 `spotPatch(...)` 放到 `react()` 前。验收结束后移除
链接并逐行回滚配置。

最终检查结果：

- `shengsuanyun-web` 的 `git diff --exit-code` 为 0。
- `git status --short` 无输出。
- `node_modules/@spotpatch/vite` 不存在。
- 未改动目标项目 198 个 TSX/JSX 文件，也未改动 lockfile。

永久接入应等待入口包发布，再按接入规范安装 devDependency 和修改一处 Vite 配置
(见 doc-id:13-project-integration)。

## 自动化与兼容门禁

| 门禁            | 本地结果                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| 单元测试        | 30 files，178 tests，通过                                                                                             |
| Chromium E2E    | 12 tests，通过                                                                                                        |
| 生产/包体测试   | 5 tests，通过                                                                                                         |
| Transform 性能  | 未缓存代表性 JSX，median `< 5 ms`、P95 `< 20 ms` 门禁通过                                                             |
| Vite/React 兼容 | Vite 5.4.21 + React 18.2、Vite 6.4.3 + React 18.3 的 build/dev/protocol 通过；Vite 7.3.6 + React 18.3 的完整 E2E 通过 |
| Runtime 包体    | raw 81,940 bytes；gzip level 9 为 20,372 bytes，低于 35 KB                                                            |
| 浏览器依赖边界  | runtime bundle 中未发现 Oxc、MagicString、launch-editor、Zod 或 Node 内置模块签名                                     |

## 真实页面分层抽样

在首页 582 个可见候选中按 tag 与 marker 分层抽取 75 个元素。脚本逐个通过真实 picker
完成选择，等待源码 API 和浏览器上下文采集结束后记录聚合值。

| 指标                    | 结果                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------- |
| exact                   | 63/75（84%）                                                                          |
| probable                | 12/75（16%）                                                                          |
| approximate / unknown   | 0/75                                                                                  |
| 带 marker 元素 exact 率 | 63/63（100%）                                                                         |
| 可定位到源码            | 75/75（100%）                                                                         |
| 组件名存在              | 75/75（100%）                                                                         |
| 组件名人工核对          | 75/75（100%）；逐项核对 49 个唯一“相对源码位置 → 组件名”映射，均与调用点/所属组件一致 |
| runtime 实例            | 1                                                                                     |
| 页面异常                | 0                                                                                     |
| 绝对路径泄漏            | 0                                                                                     |
| 选择摘要时延            | median 0.7 ms，P95 1.0 ms                                                             |
| 完整上下文时延          | median 8.2 ms，P95 14.4 ms                                                            |

样本覆盖 `a/button/div/h1–h4/img/li/p/path/span/svg`，以及应用组件、React Router
Link、Ant Design 图标/菜单/下拉组件。置信度含义只采用源码解析规范中的定义
(见 doc-id:06-source-resolution)。

## 专项验证

### 生产零残留

目标项目 `npm run build` 成功，Vite 转换 4,273 个模块。对完整 `dist/` 扫描以下类别，
命中均为 0：source marker、本地 API 前缀、runtime key、token header、UI host。

### 协议与 LAN

- 携带有效会话令牌的 loopback source-context 请求返回 200。
- 响应只含 `src/components/error-boundary/index.tsx` 相对路径，不含 `/Users/`。
- 同一有效令牌改用真实 `192.168.0.105:4199` Host/Origin 后返回 403，错误码为
  `ORIGIN_NOT_ALLOWED`。

协议和错误码本身不在此重复定义 (见 doc-id:09-local-protocol-security)。

### React、Portal 与其他集成

- 首页 StrictMode 始终只有一个 runtime。
- 真实 Ant Design Button 与 Portal 内标题均可选择，结果均为
  `probable/react-fiber` 且有可修改源码；Portal 位于 `body` 下并在应用 `#root` 外。
- `/login` 是懒加载模块；首次进入后 marker、源码读取和 Prompt 流程正常。
- `.svg?import&react` 的 SVGR 输出可用，SpotPatch marker 命中为 0，未重复处理虚拟结果。
- Tailwind、CSS Module、Framer Motion、Fragment、map/list、SVG 与 HMR 由固定 E2E fixture
  覆盖；真实首页抽样同时覆盖 Tailwind 页面和第三方组件降级。

### 登录隐私

在独立 BrowserContext 中向真实登录表单填写专用测试手机号和密码，并在 URL 中加入
专用 token，再对表单生成完整 Prompt：

- 三项专用 secret 命中 0。
- 绝对路径命中 0。
- Prompt 中存在明确脱敏占位符。
- 页面异常 0，runtime 实例 1。

## 可复现命令

目标开发服务器完成临时接入并运行后，在 SpotPatch 根目录执行：

```bash
pnpm exec node tests/acceptance/sample-visible-elements.mjs http://127.0.0.1:4199/ 75
pnpm exec node tests/acceptance/verify-login-privacy.mjs http://127.0.0.1:4199
pnpm exec node tests/acceptance/verify-antd-portal.mjs http://127.0.0.1:4199
```

脚本只输出聚合结果和相对源码位置，不输出会话令牌、源码正文、表单值或绝对路径。

## 未闭环的外部事项

- npm 首次发布和目标项目永久安装尚未执行；这需要 registry 凭据和发布授权，不属于本轮
  临时接入权限。
- 目标项目现有依赖审计报告为 14 项（6 low、3 moderate、5 high）。本轮未引入这些问题，
  也未执行可能产生破坏性升级的 `npm audit fix`。
- 远程 CI 需要在代码推送后观察；本报告只声明本地实际运行结果。
