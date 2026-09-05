# CLI 初始化项目授权

## 范围与决策

将 managed Codex 的一次项目授权从开发服务的交互终端迁移到本地 CLI 初始化步骤。Vite、Next.js、Astro 共用 `runSpotPatchBridgeCli` 和既有 `ManagedGrantStore`，不新增浏览器授权接口，不放宽 managed profile。

```sh
# 已接入项目任选对应框架；不修改 integration 配置。
pnpm exec spotpatch-vite bridge init
pnpm exec spotpatch-next bridge init
pnpm exec spotpatch-astro bridge init
```

Vite/Next 的 `init` 在接入成功后执行同样的授权；Astro 的 `init` 是权限初始化入口，仍需先完成 `astro add` 或手动 integration 配置。Astro 不伪装成已实现完整自动接入器。

## 安全与生命周期

- 执行 `init` 即初始化一次项目授权，无需附加参数或交互输入。命令帮助和执行输出说明授权范围与撤销入口。旧 `--allow-managed-codex` 参数仅作兼容别名；未知或重复参数失败且不写授权。
- 授权范围仍是独立临时快照的修改，以及 SpotPatch 审计、校验与冲突检查后的合规回写，不是 attached 直接写入授权。
- 校验当前根目录有 `package.json`，按真实路径绑定当前用户的私有 grant；不写项目可提交配置、不复制厂商凭证。
- 已有效的授权不重复写入；无效记录不覆盖，要求先撤销。沿用私有目录、属主、权限和原子写入检查。
- CLI 不启动 Codex、不发起模型请求、不等候开发服务，也不宣布已连接。安装、登录及 schema/security preflight 仍由 Supervisor 执行。
- 无授权时，默认 Supervisor 立即返回 `awaiting-consent`，不创建 readline 或等待 stdin。CLI 初始化后再次连接会重读 grant；撤销后恢复未授权状态。已有可信宿主的显式授权回调契约保留。
- UI 显示匹配框架的初始化命令；有效授权可跨开发服务生命周期复用。旧版本若已卡在 readline，需要重启一次开发服务加载新代码。

## 验证

CLI 单测覆盖三个适配器、幂等、无参数初始化、旧命令兼容、非法参数与无效 grant；Supervisor 测试覆盖无交互立即返回、外部初始化后重新连接、撤销及跨生命周期恢复。真实 Codex 登录/可用性不由授权成功推断。

2026-09-05 本地回归：完整单测 941 通过、5 条件跳过；类型检查、ESLint、11 包构建通过；Astro 5.18.2 / 6.4.8 / 7.2.8 浏览器用例 12/12 通过。未自动给业务项目写入授权，未执行真实模型改码任务。其余旧专题页中的 dev 终端 `yes` 描述属于历史交互，本页替代该交互，不替代既有隔离与校验规范。
