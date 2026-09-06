<h1><a href="https://github.com/huanglvjing/spotpatch"><img src="https://raw.githubusercontent.com/huanglvjing/spotpatch/main/docs/assets/spotpatch-npm-icon.png" alt="SpotPatch" width="48" height="48" align="absmiddle" /></a> <code>@spotpatch/astro</code></h1>

Development-only Astro integration for native templates and React islands. Shares source selection, editor navigation, DOM/CSS context, prompts, AI review/apply/revert, Contextual Ask, external-Agent controls and data-flow tooling with the other SpotPatch adapters. React is not required for native Astro.

## Status and compatibility

`@spotpatch/astro` is a published public integration. The supported matrix is Astro **5.18.2, 6.4.8 and 7.2.8** on Node.js **22.12+**, validated on Linux, macOS and Windows; the React-island fixtures use React **18.3.1** and the matching official Astro React integrations. Other Astro patches, React versions, SSR deployment adapters and third-party UI framework internals are outside the verified matrix unless documented otherwise. See the [current plan and acceptance evidence](../../docs/技术方案/Astro适配/02-功能对齐实施方案.md); the initial source-only plan is retained as history.

## Install

Install the adapter as a development dependency from the npm registry:

```bash
pnpm add -D @spotpatch/astro@latest
pnpm exec spotpatch-astro init
```

If a third-party registry mirror has not synchronized every newly published SpotPatch dependency, retry against the official npm registry instead of weakening dependency ranges or adding SpotPatch internals directly:

```bash
pnpm add -D @spotpatch/astro@latest --registry=https://registry.npmjs.org
```

`init` safely adds the integration to a supported static `astro.config.*`, enables data flow, Contextual Ask and external-Agent controls, enables Trusted direct when an Astro project check is discoverable, and initializes the private Managed Codex project grant. It preserves existing integrations, adapters, `base`, Vite settings and explicit SpotPatch options. Ambiguous dynamic configurations fail without writing; use `pnpm exec spotpatch-astro check` for a read-only verification.

The resulting configuration has this shape (or add it manually if the initializer reports an unsupported dynamic configuration):

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import spotPatch from "@spotpatch/astro";

export default defineConfig({
  integrations: [spotPatch({ ai: false })],
});
```

Start your normal development command (`pnpm dev`, or your existing programmatic `astro.dev()` launcher). Use the picker button or `Mod+Shift+S`. Do **not** put this integration into `vite.plugins`, and do not add the Vite/React adapter to an Astro project just to enable SpotPatch.

## Options and boundaries

`spotPatch(options?: AstroSpotPatchOptions)` is exported both as default and by name. `AstroSpotPatchOptions` uses the shared `SpotPatchOptions` contract, including `dataFlow`, `contextualAsk`, `externalAgent` and `trustedFastMode`. Defaults and validation are shared with the dev-server; Astro's default include is `**/*.{astro,js,jsx,ts,tsx}`, resolved against the project root. Dependencies, generated directories, query subrequests, virtual modules, and files outside the real project root are excluded. Custom filters cannot bypass the root boundary.

- Native HTML/SVG/custom elements in `.astro` get original UTF-16 line/column coordinates. Explicit existing SpotPatch markers are preserved with a warning.
- Components, fragments, `slot`, `script` and `style` are not directly marked. Native children/fallback content can be marked. Script processing and scoped CSS remain Astro's responsibility.
- ClientRouter navigation and template HMR dispose/recreate the shared UI and preserve the existing session draft behavior.
- React JSX/TSX islands use the shared compiler and original three-part markers. Browser instrumentation is not injected into their server-side execution.
- Vue/Svelte/MDX internals, runtime-generated HTML, lit-html and shadow roots do not gain new exact-location guarantees. The picker may report a marked ancestor or unknown source instead.
- `build`, `preview`, `sync` and `enabled: false` install no SpotPatch transforms, runtime or middleware. Importing the package itself still requires the declared Node environment.
- The protocol stays on the dev server origin at `/__spotpatch`; Astro `base` does not prefix it. Proxies must preserve that route and the existing Host/Origin/token protections. Remote/LAN access is off by default.

## Optional AI

Start with `ai: false`. To enable configured-key execution, remove that override and use the existing [provider and credential configuration](../../README.md#optional-ai-agent). Only server-side environment variables are read, using Vite's final mode and `envDir`; never use `PUBLIC_` variables for credentials.

For example, set `SPOTPATCH_AI_BASE_URL`, `SPOTPATCH_AI_MODEL` and `SPOTPATCH_AI_API_KEY` in a git-ignored local environment file. Use a Git repository, review the diff before Apply, and configure project-appropriate checks explicitly. A TypeScript check alone is **not** an Astro template check; install/configure `astro check` in the host if needed. Tests use synthetic provider responses, not a paid provider. See [AI execution](../../docs/技术方案/16-AIAgent执行与变更审阅.md) for the shared worktree, limits and conflict-safe revert contract.

## Data flow, Ask and external Agents

Enable the optional modules in your existing integration:

```js
spotPatch({
  ai: false, // remove when using configured-key AI
  dataFlow: {},
  contextualAsk: {},
  externalAgent: true,
});
```

- Data flow analyzes native frontmatter and browser scripts in separate scopes, retaining physical-file coordinates and source hashes. Processed browser scripts and React islands receive request/trigger instrumentation; imports are traced by the shared analyzer. Native reports describe the source document's scopes, not a fabricated React component tree.
- Server requests remain **declared, not observed** and are labeled as server evidence. Browser fetch/XHR observation never reads response bodies or retains parameter values. Inline scripts keep their execution semantics; uninstrumented/dynamic calls may remain unassigned or partial rather than gaining invented provenance. Astro navigation is excluded only by its active loader URL and abort signal.
- Ask uses the shared read-only executors, bounded source/import snapshots, citations, cancellation and workspace coordination. A configured-key provider or a verified managed Codex executor is still required to answer. No question is sent without the normal consent flow.
- Managed Codex Ask provides a separate Model picker from the local app-server catalog. Selection is revalidated on execution and does not alter global Codex configuration. Configured-key providers use their configured executor/model profiles; no arbitrary provider model names are accepted from the browser.
- Relative `<script src>` sources can enter Ask's authorized import snapshot. Standalone external-script side effects are not automatically attributed to a selected template element; calls without a proven invocation chain remain page-level/unassigned evidence.
- External-Agent Inbox and managed controls use the shared broker, grants, authentication and conflict protection. Their existing experimental/adapter-specific restrictions still apply; enabling Astro does not certify every external client or platform.

Use the shared in-page managed controls for the normal external-Agent workflow. From the linked host project, inspect the adapter's bridge CLI:

Before connecting for the first time, run `pnpm exec spotpatch-astro init`. It safely updates the integration and initializes the private project grant. For an already-integrated project that needs authorization only, `pnpm exec spotpatch-astro bridge init` uses the shared Vite/Next authorization path without changing integration files. There is no subsequent dev-terminal `yes` prompt. Grants remain revocable, and authentication/security checks remain mandatory.

```bash
pnpm exec spotpatch-astro bridge --help
```

The advanced attached-connector fallback is `pnpm exec spotpatch-astro connect codex --allow-workspace-write` (or `node node_modules/@spotpatch/astro/dist/cli.js connect codex --allow-workspace-write`). Running init authorizes that connector's workspace-write path; it is not equivalent to managed isolation/validation and is not the default setup. Installing the integration does not edit external-Agent configuration or start an AI change.

## Trusted direct validation

With AI configured, `trustedFastMode: true` uses the shared explicit-consent execution mode. A configured required check takes precedence. Otherwise discovery requires the host to declare and install Astro, `@astrojs/check` and TypeScript, plus a regular `tsconfig.json` and a Git workspace. It invokes the installed `@astrojs/check` diagnostic executable with fixed arguments and a worktree-relative root, not the `astro check` wrapper (which also runs sync). It does not automatically install packages or execute `astro.config.*`.

Managed validation temporarily exposes the existing workspace dependency lookup chain only after the Agent turn, only for the recognized fixed diagnostic command, and removes those links afterward. Installed checkers/dependencies remain trusted local code, not an OS sandbox. Generated `.astro` content/type artifacts are not automatically synchronized in the isolated snapshot; projects requiring them must configure appropriate required checks. Check failures prevent automatic application.

To prepare the host's checker deliberately:

```bash
pnpm add -D @astrojs/check typescript
pnpm exec astro check
```

Ensure the host `tsconfig.json` includes its `.astro` sources. Missing required validation fails closed; `tsc` alone is never substituted for Astro validation. See [Astro's type-checking documentation](https://docs.astro.build/en/guides/typescript/#type-checking). Additional Vue/Svelte checks, when relevant, remain the host's responsibility.

## Maintainer verification

Run from the SpotPatch root, with no other process using the fixture ports:

```bash
pnpm --filter @spotpatch/astro... build
pnpm exec vitest run packages/astro
pnpm exec playwright install chromium
pnpm test:astro
pnpm test:astro:compatibility
```

Browser tests use ports 4327–4329 and a shared source fixture copied into generated directories for Astro 5/6. Run browser and production checks sequentially: they intentionally use the same fixture projects. If your shell proxies HTTP, put `127.0.0.1,localhost` in `NO_PROXY`/`no_proxy` for local health checks. Full release gates additionally include typecheck, lint, all unit tests, existing framework regressions and package validation.

Optional read-only template acceptance against an existing project (does not start or modify the host):

```bash
SPOTPATCH_ASTRO_SOURCE_DIR=/absolute/path/to/your-project/src \
  pnpm exec vitest run packages/astro/src/host-source-compatibility.test.ts
```

This checks preservation and compilation of template source, not the host's authentication, proxy, SSR adapter or full runtime behavior.

## 简体中文

这是已发布到 npm 的 Astro 公共集成，不要求 React。执行 `pnpm add -D @spotpatch/astro@latest` 和 `pnpm exec spotpatch-astro init`；初始化器会安全更新静态 `astro.config.*`、开启数据链路/Ask/外部 Agent、在可发现 Astro 检查时开启可信极速，并完成 Managed Codex 私有项目授权。动态或含糊配置会无写入失败，可用 `spotpatch-astro check` 只读核验或按上方示例手动配置。不要放入 `vite.plugins`。若第三方镜像尚未同步完整依赖，临时增加 `--registry=https://registry.npmjs.org`，不要直接安装内部包规避依赖约束。

正式验证矩阵为 Node.js 22.12+ 与 Astro 5.18.2、6.4.8、7.2.8，并覆盖 Linux、macOS、Windows；该声明不自动扩展到任意补丁版本、SSR adapter 或第三方 UI 框架内部。原生模板与 React 岛屿复用定位、编辑器、DOM/CSS、Prompt 和 AI 审阅/应用/回滚；通过 `dataFlow: {}`、`contextualAsk: {}`、`externalAgent: true` 启用数据链路、只读问答和外部 Agent。可信快速模式需要已配置的必需检查或完整的本地 Astro checker，不能用 `tsc` 冒充模板验收。

前后端作用域隔离，浏览器不能证明服务端执行；inline 脚本不改成模块，动态 DOM/其他 UI 框架不能伪报精确定位。外部 Agent 的实验性限制继续有效。生产不注入 SpotPatch。安装、连接命令见上文；完整边界、测试替身及真实宿主未验证项见[本轮技术方案与验收](../../docs/技术方案/Astro适配/02-功能对齐实施方案.md)。
