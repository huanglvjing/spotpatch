---
doc-id: "22-persistent-shell-motion-system"
title: "持续 Shell 与灵动岛动效系统方案"
status: "active"
version: "1.1.0"
last-updated: "2026-08-30"
implementation-status: "implemented; automated-gates-passing; browser-visual-and-performance-validation-pending"
source-range: "参考 Motion Demo；独立 Motion browser bundle、持续 Shell、多 Scene、真实 Agent 状态投影、性能、安全、无障碍与验收方案"
参考文献/依赖:
  - "05-runtime-lifecycle"
  - "09-local-protocol-security"
  - "10-ui-diagnostics"
  - "11-coding-standards"
  - "12-testing-acceptance"
  - "16-ai-agent-execution"
  - "19-external-agent-handoff"
  - "21-floating-workbench-island"
  - "external-agent-04-handoff-protocol"
  - "external-agent-07-ux-performance-observability"
---

# 持续 Shell 与灵动岛动效系统方案

## 1. 文档目的与当前状态

本文定义 SpotPatch 下一版灵动岛动效系统。目标不是增加若干彼此无关的进入/退出动画，而是把入口、上下文采集、Planner、Agent 派发、运行和结果反馈组织成同一个持续存在的浮动实体：

```text
Pill → Capturing → Planner → Agent Charging → Handoff → Running → Result → Planner/Pill
```

截至 2026-08-30，本方案的第三版产品实现已完成。Runtime 保留默认右下角、自由拖拽、边缘吸附和 Session 位置恢复；Pill、Planner 与 Execution Island 共享同一个 `position: fixed` Shell。`execution-island.ts` 复用现有 SpotPatch 矢量 Logo，以独立 SVG paint-server id 避免隐藏 Scene 抢占渐变引用，并拥有 62px Compact、真实计时、真实活动展开和可访问状态。独立 `runtime-motion.js` browser bundle 注册 Motion 扩展；GSAP Core 只负责可中断 Shell Geometry Morph、短时派发反馈和一次性 1px 品牌光扫。核心 Runtime 只负责把真实 Runtime、内置 `AgentJobSnapshot`、外部 `DispatchSummary` 与 Codex `managedPhase` 归一化为视觉投影。

当前自动化类型、DOM、注入、状态回调和包体 Gate 已通过；真实受控 Chromium 的截图、触摸、200% 缩放与 Performance trace 仍是发布前 required Gate。未取得这些证据前，不得声称视觉和性能已在真实浏览器完成验收。

浮动位置、拖拽、边界钳制和 Session 恢复继续由 (见 doc-id:21-floating-workbench-island) 唯一负责；本文只拥有持续 Shell、视觉状态投影、动画编排和 Agent 动效的规范事实。Runtime 业务状态、Agent Job 与外部交接协议仍由其原文档拥有，本文不得新增或改写协议语义。

## 2. 视觉参考审计

本方案第三版实现曾使用独立 HTML 视觉稿审计比例、信息层级和动效节奏。相关一次性参考稿完成工程化落地后已从仓库清理；下列结论是正式代码需要持续遵守的规范事实。

### 2.1 可保留的设计语言

- 外层 Shell 持续存在，内部 Scene 随信息密度变化；
- Compact 以 62px 高度承载当前最重要的信息，并按 Receiving 430px、Handoff 448px、Running 468px、Checking 440px、Success 356px 的集中 Size Token 改变宽度；
- Compact 与 Expanded 复用 Logo、标题、状态与同一个 Shell，看起来是同一实体；
- 捕获使用紫色、就绪使用 Mint、派发使用紫蓝青方向光、错误使用低饱和红；
- 大形态变化集中在唯一 Shell，微动画优先使用 `transform` 和 `opacity`；
- Logo 只保留极弱品牌光，关键状态只播放一次细光扫，不制造 HUD 或持续霓虹；
- `prefers-reduced-motion` 下保留信息，移除非必要位移和循环动画。

### 2.2 不得复制的 Demo 行为

| Demo 行为 | 正式产品处理 | 原因 |
| --- | --- | --- |
| CDN 加载 GSAP | 禁止远程动画脚本 | 违反离线、本地优先、CSP 和依赖锁定边界 |
| 固定 timeout 推进 PREPARE/DISPATCH/ATTACHED | 只消费真实业务事件 | 固定时序会伪造 Agent 已接收或正在运行 |
| 固定事件数组循环展示读文件、补丁和检查 | 只展示真实有界活动 | 不能虚构工具调用、文件或检查结果 |
| 5 秒后自动成功 | 只消费真实 terminal 状态 | 动画时间不能决定业务完成 |
| 模拟 0–100% 捕获条 | 使用 collecting/ready/partial 阶段 | 当前协议没有可证明的完成百分比 |
| 成功后自动清空并回 Pill | 仅真实 `completed/applied/reverted` 终态停留 1500ms 后回 Pill；`awaiting-review/review-required` 保持可审阅 | 既完成闭环，也不能隐藏仍需 Diff、Apply 或 Revert 的结果 |
| 点击 Context Ready 再进入 Planner | 选中后立即开放编辑 | 现有直接输入契约不能被动画增加一步阻塞 |
| 大范围持续 blur/filter | 只在短反馈阶段使用 | 降低持续 paint 成本并避免文字模糊 |

## 3. 设计原则

1. **一个实体**：紧凑入口、Planner 和执行岛共享一个持续 Shell；Scene 只负责内容。
2. **真实事件**：Motion 只能投影现有 Runtime、Agent Job 和 External Handoff 状态。
3. **单一所有权**：Shell 几何只由浮动表面控制器写入；Motion 不直接写位置。
4. **业务无等待**：动画不得延迟目标编辑、取消、复制、Apply、Revert 或错误展示。
5. **可中断**：新业务状态、拖拽、Resize、Escape、HMR 和 dispose 都能确定性取消旧动画。
6. **渐进增强**：Web Animations API 不可用或用户减少动画时，立即切换到最终 Scene。
7. **有界装饰**：一次性光扫、活动摘要和动画实例数量均有固定小上限。
8. **包体受控**：不以视觉升级为理由无条件放宽 Runtime 体积、安全或性能门禁。

## 4. 持续 Shell DOM 契约

正式结构采用一个 `position: fixed` Shell：

```text
spotpatch-root / ShadowRoot
├── selection-highlights
├── hover-highlight
└── floating-surface                    # 唯一 fixed Shell
    ├── surface-chrome                  # 背景、细边框与极弱静态品牌光
├── scene-pill                      # 标准 button
    ├── scene-capturing                 # 非阻塞状态
    ├── scene-planner                   # 现有 role=dialog 工作台
    └── scene-execution                 # Handoff/Running/Result
```

当前实现创建一次并复用 `floating-surface`、Pill、Planner 和 Execution Island。非活动 Scene 使用 `hidden + inert + aria-hidden` 退出布局、交互与可访问树；Motion 只切换现有节点，不复制 Planner、TargetList 或 Agent Panel。

约束：

- `floating-surface` 是唯一设置 `position: fixed`、`left/top/width/height` 和主圆角的元素；
- 现有 Picker Trigger 仍是原生 `<button>`，不能把点击语义转移到普通 `div`；
- Planner 继续使用 `role="dialog"`、标题关联、表单与原生控件；
- 非活动 Scene 在交互开始前必须 `inert` 且退出可访问树，不能只设置透明度；
- 装饰层全部 `aria-hidden="true"`、`pointer-events: none`，不得覆盖拖拽、输入或操作按钮；
- Scene DOM 创建一次并复用，不在每次动画中重新创建 TargetList、Agent Panel 或 Diff DOM；
- Motion 结束只处理可见性、焦点和动画资源，不触发 Runtime 状态变化。

## 5. 状态所有权与视觉投影

### 5.1 不新增第二套业务状态机

现有 Runtime 继续拥有 `idle | inspecting | selected | previewing`。Agent Job 继续使用公共 `AgentJobStatus`；外部 Agent 继续使用 `ExternalHandoffDispatchPhase`。Motion 层只维护当前视觉 Scene、动画 generation 和短生命周期 transition，不持久化业务状态。

建议的 Runtime 私有视觉类型：

```ts
type FloatingSurfaceScene =
  | "pill"
  | "capturing"
  | "planner"
  | "agent-charging"
  | "handoff"
  | "running"
  | "success"
  | "failed";

interface FloatingSurfaceMotionProjection {
  readonly scene: FloatingSurfaceScene;
  readonly tone: "neutral" | "capturing" | "ready" | "running" | "success" | "danger";
  readonly headline: string;
  readonly action: string;
  readonly meta: string;
  readonly activity?: FloatingSurfaceActivity;
  readonly recentActivities: readonly FloatingSurfaceActivity[];
  readonly startedAt?: string;
}
```

该类型不进入 `@spotpatch/shared`、配置、网络协议或 Storage。`headline/action/meta` 必须由本地化消息或真实协议状态生成；`startedAt` 优先使用真实 Job 快照时间。外部协议没有时间字段时，Runtime 记录真实请求开始或首次非终态观测的本地墙钟，仅作为 elapsed 起点，不伪造服务端进度。

### 5.2 Runtime 状态映射

| 真实输入 | Scene | 行为 |
| --- | --- | --- |
| `idle` | `pill` | 紧凑入口；有保留目标时使用恢复语义 |
| `inspecting` | `capturing` | 显示正在选择/采集，不显示假百分比 |
| `selected` | `planner` | 立即开放目标说明编辑，不等待动画或网络 |
| `previewing` | `planner` | Shell 几何不重置，只切换 Planner 内部内容 |

“Context Ready”不是新的阻塞 Scene：如果上下文在 Planner 展开前已经真实 ready，可以在展开过渡中使用 Mint 确认；否则 Planner 按现有契约立即出现，ready 到达时只在 Planner 摘要区播放一次短 Mint 反馈。`partial` 必须保持警告语义，不能使用成功色。

### 5.3 内置 Agent Job 映射

| `AgentJobStatus` | Scene | 展示阶段 |
| --- | --- | --- |
| `queued`、`preparing` | `handoff` | `PREPARE`；仅表示服务端已返回对应快照 |
| `running` | `running` | `RUNNING`；最近活动来自真实 `AgentActivityItem` |
| `validating` | `running` | `VALIDATE` |
| `awaiting-review` | `success` | `REVIEW READY`；点击执行岛返回 Planner 并保留 Diff |
| `applying` | `running` | `APPLY` |
| `applied`、`completed` | `success` | `DONE`；停留 1500ms 后收回 Pill；期间点击可返回 Planner |
| `cancelling` | `running` | `CANCELLING` |
| `cancelled` | `planner` | 返回 Planner，并保留取消结果，不使用成功态 |
| `reverting` | `running` | `REVERT` |
| `reverted` | `success` | `REVERTED`；停留 1500ms 后收回 Pill |
| `failed` | `failed` | 显示现有稳定错误文案；点击后返回 Planner 并保留详情 |

点击 Run/Send 时 Runtime 仅暂存本次按钮与目标 Agent Card；只有真实 workspace health/probe/job 创建状态，或 active dispatch 事件出现后，才开始短时按压反馈和 Shell 收拢。请求在 Job/dispatch 创建前失败、取消或降级为 inbox 时必须留在 Planner 并展示真实错误，不能播放“Agent 已取件”。

### 5.4 外部 Agent 交接映射

| `ExternalHandoffPublishDelivery` / `ExternalHandoffDispatchPhase` | Scene | 语义 |
| --- | --- | --- |
| `mode: inbox` | `planner` | 已发布至收件箱；不伪装为主动执行 |
| `queued`、`dispatching` | `handoff` | `DISPATCH` |
| `dispatched` | `handoff` | `ATTACHED`；仅表示真实派发已建立 |
| `working` | `running` | Agent 已报告工作中 |
| `completed` | `success` | 真实完成；点击执行岛后返回 Planner |
| `failed` | `failed` | 显示既有失败信息 |
| `delivery-unknown` | `failed`/Planner 警告 | 不推断成功或运行，保留恢复操作 |

内置 Agent 与外部 Agent 的原始状态先归一化为同一个视觉投影，再交给 Motion；不得在两个面板中各复制一套动画状态机。

Codex managed 模式继续以 `managedPhase` 为更精确事实源：`preparing` 映射 Handoff；`running/auditing/validating/applying` 映射 Running；`completed/review-required` 映射 Success；`failed/cleanup-warning` 映射 Failed；`cancelled` 返回 Planner。Execution Island 只显示 Agent 身份、当前真实动作和状态；revision、deliveryStatus、executionStatus、模型与审计详情继续留在 Planner，避免重复信息。

## 6. 动画编排流程

### 6.1 Pill → Capturing → Planner

1. 标准按钮按下后，Runtime 先进入真实 `inspecting`；
2. Shell 从 Pill 形态扩展为 Capturing，状态点和有限光纹表达正在选择；
3. 选中目标后 Runtime 进入 `selected`，Shell 立即向 Planner 目标矩形 Morph；
4. Planner 内容以 `opacity + translateY` 揭示，当前目标输入按既有焦点规则获得焦点；
5. 上下文 ready 后在摘要区播放 Mint 确认，不生成假进度或额外页面。

### 6.2 Planner → Agent Card → Handoff

1. Run/Send Button 播放 100–220ms 按压反馈；
2. 收到真实 Job/active dispatch 确认后，按钮和目标 Agent Card 播放一次低强度局部反馈；
3. 请求开始后保持 Planner 几何，并将 Scene 标记为 `agent-charging`；该状态只表示请求正在发出，不表示 Agent 已接受；
4. 收到真实 `queued/preparing/dispatched/working/managedPhase` 后只保留最新视觉投影，反馈完成后 Shell 通过一次可中断 FLIP 收拢；
5. Execution Island 出现或真实阶段/活动改变时，底边播放一次 1px 紫→蓝→青光扫；不创建光路、粒子或 Agent Core。

`prefers-reduced-motion`、页面 hidden、几何无效或目标不可见时跳过装饰并直接显示真实状态。任何视觉反馈失败都不能回滚已经发生的业务请求。

### 6.3 Running 与结果

- Running Island 默认是 468×62px 的 Compact；Receiving、Handoff、Checking 和 Success 分别使用 430、448、440 和 356px 的集中宽度 Token，窄视口统一钳制到 16px 安全边距；
- 内置 Agent 的 elapsed timer 由真实 `AgentJobSnapshot.createdAt` 和墙钟计算，每秒更新；页面 hidden 时停止 interval，恢复后从墙钟校正；
- 有真实活动时，点击 Compact 可 Morph 到 520×164px Expanded；Logo、主标题和状态仍使用同一 DOM，只切换真实 Expanded 文案并增加最近 3 条真实活动；
- Compact ↔ Expanded 除 Shell 几何外，还对同一 Logo、文案区和右侧状态做局部 FLIP；详情层在展开后延迟 100ms 轻量揭示，收起时先淡出再隐藏，避免内容先跳到终点或瞬间消失；
- 不循环伪造工具名称、文件路径、检查或日志；没有活动时只显示阶段；
- 不显示 completion percentage；没有服务端开始时间时也不伪造计时器；
- Expanded 状态下再次点击 Running Island 可返回 Planner 查看完整活动和取消入口；Escape 只收回 Compact；
- `awaiting-review/review-required/failed` 保持可检查；真正 terminal success 停留 1500ms 后视觉收回 Pill，计时不决定业务状态；
- 关闭 Planner 只改变当前呈现，不取消或完成 Agent Job。

## 7. 几何与拖拽协调

`floating-surface-controller.ts` 继续作为 Shell 位置的唯一写入者；它只写 `left/top` 并持久化归一化锚点。Scene CSS 决定最终宽度与圆角，Motion 在切换前后各读取一次 Shell 矩形，并在短 Morph 内动画唯一 Shell 的 `width/height/x/y/border-radius`。CSS 的 `999px` 胶囊圆角在进入动画前会按当前可见宽高换算为有效半径，避免初次展开时从虚假的 999px 插值。Compact ↔ Expanded 额外读取三个共享内容锚点的局部位置，只动画 `transform`；普通 Agent 阶段变化不产生这组额外测量。不使用 `scaleX/scaleY` 拉伸内容和圆角，也不写 `left/top`。

位置控制器负责：

- 根据已提交归一化锚点计算最终 `left/top`；
- 在唯一 Shell 上协调 `left/top`、视口钳制、边缘吸附与 Session 恢复；
- Scene 改变、Planner 内容 Resize、VisualViewport 改变时重新钳制；
- Shell Morph 活跃时忽略由 Resize/内容更新触发的临时重定位，避免把动画中的宽高与 transform 当成最终尺寸；Morph 完成或被新投影中断后，再以最终 CSS 几何做一次确定性 reconcile；
- 普通 pointer 点击由可中断 Motion 从当前可见几何继续；只有移动超过拖拽阈值、真正开始拖动时才取消当前 Motion，再由位置控制器接管；
- 拖拽期间暂停大形态 Morph，只更新位置；
- 释放后完成吸附，再允许下一次 Scene Morph；
- 窄视口按既有底部工作台规则降级，不把 Demo 的居中大面板尺寸复制到移动端。

Motion 不直接写 `left/top`，位置控制器不切换 Scene 内容。运行时只有 GSAP 控制 Shell `transform`；CSS 不对同一 Shell `transform` 做并行动画。

## 8. 动画技术决策

### 8.1 当前实现：独立 GSAP Core Motion bundle

- `gsap@3.15.0` 使用精确版本并由 pnpm lockfile 固定，不使用 CDN；
- `runtime-motion.js` 是独立开发期 browser bundle，GSAP 不进入 `runtime-client.js`；
- GSAP 只在短 Morph 内控制 Shell 的 `width/height/x/y/border-radius`，并控制 Scene `opacity`、一次性光扫和短时派发反馈；浮动控制器仍唯一写入 `left/top`；
- CSS 负责静态表面、文字切换、状态点呼吸和视觉 token；同一属性不由 CSS 与 GSAP 同时驱动；
- 不注册 Flip/MotionPath 等插件：当前单 Shell FLIP 不需要额外插件；
- 新状态或拖拽会 kill 旧 timeline/tween 并立即应用最新最终 Scene。

### 8.2 未采用方案

| 选项 | 决策 | 事实依据 |
| --- | --- | --- |
| GSAP Core | 采用，独立 bundle | Timeline 适合连续 Scene 编排；精确锁定；本地打包；不污染核心 Runtime |
| Framer Motion / Motion React | 不进入 Runtime | Runtime 不是 React；不允许两个系统控制同一 Shell transform |
| Web Animations API | 不采用 | 项目已存在隔离且可取消的 GSAP Core Motion 体系；继续复用可避免并行动画所有权 |
| 新建自有 Timeline 引擎 | 禁止 | 会重复调度、插值、取消和资源清理能力 |

生产预算实测：`runtime-client.js` gzip 48,307 B，`runtime-motion.js` gzip 35,368 B（macOS Node 26、gzip level 9）。完整执行岛 renderer 已从核心 Runtime 隔离到 Motion bundle；核心保留无 Motion 的即时文本降级。对应门禁为 48 KiB 与 35 KiB，均只为当前实测保留有限跨平台余量；不得将 GSAP 合并进核心 Runtime，也不得在没有再次测量与隔离评估的情况下继续提高预算。

## 9. Motion Token 与视觉约束

所有时长、曲线、色调和 Scene 尺寸策略集中到一个所有者。建议令牌族：

| 令牌族 | 初始校准范围 | 用途 |
| --- | --- | --- |
| press | 120ms | 按钮短反馈 |
| copy | 220ms | 文案和状态替换 |
| reveal | 260ms | Scene 内容揭示 |
| morph | 480ms | Shell 与 Compact/Expanded 形态变化 |
| sweep | 680ms | 关键状态的一次性 1px 光扫 |
| result-hold | 1200–1800ms | 有限结果确认；不得控制业务状态 |

范围不是可直接散落到代码的常量。实施时需在 `ui-constants.ts` 或单一 motion token 模块选定值，CSS 和 TypeScript 通过同一配置消费；测试断言语义和最终结果，不复制毫秒值。

视觉限制：

- 表面只允许极弱、静态的品牌径向光；
- Logo 使用现有 22px 矢量标识，不附加外层图标 Card；
- 状态点只以 `transform + opacity` 做低强度呼吸；
- 关键状态最多播放一条 1px 一次性光扫，页面 hidden 或 reduced motion 时跳过；
- `will-change` 只在动画开始前设置于 Shell/活动元素，结束或取消立即清除；
- blur/filter 仅用于短 Scene 切换或短 Agent Card 反馈，不长期动画 Planner 正文；
- Veil 若保留，只动画 opacity；`backdrop-filter` 使用固定值且不得遮断宿主页面操作语义。

## 10. 生命周期、并发与可中断性

Motion Controller 维护最多一条 Morph timeline 与一条 Dispatch timeline。派发期间到达的真实 Handoff/Running 投影只保留最新一份，接收动画完成后再应用；快速重复 Send 在已有 Dispatch timeline 活跃时直接忽略，不生成第二条 timeline。每次普通新投影：

1. kill 旧 timeline 与所有受控 tween；
2. 清理旧 Scene 的临时 class、`will-change` 和光扫状态；
3. 应用最新目标 Scene 与最终几何；
4. 从当前屏幕几何到新矩形执行一次可中断 Geometry Morph，并揭示活动 Scene；中断时先捕获当前可见宽高、位置和圆角，不跳回旧终点。

以下事件必须使旧动画失效：Runtime 状态变化、Agent 新快照、外部交接新状态、真实拖拽开始、HMR dispose。普通点击不提前清空动画，而由随后发生的 Scene/Layout 更新捕获当前可见几何并连续接管。timeline 的 `onComplete` 只清理装饰层，不改变业务状态，因此迟到回调不能覆盖新 Scene。

页面 `visibilitychange` 为 hidden 时暂停状态点呼吸并停止计时 interval；有限业务状态转换可以直接完成到最终样式。恢复可见后按墙钟校正计时，不重播已发生的派发或成功光扫。

## 11. 性能预算

- Shell 大 Morph 可以短时动画唯一 Shell 的宽高、位置与圆角；其他元素只动画 transform/opacity/颜色；
- 每个状态变更最多一组布局读取、一组批量写入，读写不能交错循环；
- 每次形态切换只在内容更新前后各读取一次 Shell 矩形；不在每帧调用 `getBoundingClientRect()`；
- Planner 内容使用单个 `ResizeObserver` 或现有统一 view-change 调度，单帧最多协调一次；
- 除 1 秒一次的真实 elapsed timer 外，禁止 JS interval、requestAnimationFrame 装饰循环和手写逐帧插值；
- 目标 scroll/ResizeObserver 只更新目标高亮，不测量 Motion Shell；
- dispose 后 Animation、ResizeObserver、MediaQuery 和 visibility listener 全部为零；
- Runtime gzip 继续受生产预算测试约束。新增视觉代码必须先尝试压缩结构、复用 CSS 和按需隔离，不能只提高阈值；任何预算调整需要独立测量和说明。

真实 Chromium 验收必须记录至少一次：Scene Morph、Compact/Expanded 和 Running 状态期间的 Layout、Paint、Long Task 与内存。肉眼流畅不能替代 Performance trace。

## 12. 安全与隐私

- 不加载 CDN、远程字体、远程图片、动画配置或脚本；
- 不使用 `innerHTML` 拼接状态、Agent 活动、组件名、路径或错误；
- Motion 只消费已本地化的固定状态和现有清洗后的有界活动摘要；
- 光扫和 `data-*` 不携带 Prompt、源码、目标说明、凭据、URL、模型真实地址或 Agent 输出；
- 不新增 Storage 字段、网络请求、协议状态或权限；
- Shadow Root style 继续继承唯一有效 CSP nonce；
- Motion 错误只降级为即时 Scene，不进入 Agent 错误码，也不能吞掉真实业务错误。

## 13. 无障碍与输入

- Pill 继续是具有可读名称、键盘激活和 `aria-pressed` 的原生按钮；
- Capturing/Handoff/Running/Result 使用克制的 `role="status"` 或现有 polite live region，不逐帧播报；
- Planner 保持现有 `role="dialog"`、标题关联、焦点管理和原生表单；
- Scene 过渡开始时立即从非活动 Scene 移除焦点和交互，避免透明控件可点击；
- Planner 展开完成后再执行视觉焦点收口；reduced motion 路径立即完成；
- Running Island 是原生按钮，并以 `aria-expanded` 表达 Compact/Expanded；取消仍在 Planner 中使用现有真实按钮；
- 状态不能只靠紫/Mint/红区分，必须同时提供文本；
- 200% 缩放、触摸、键盘、屏幕阅读器和高对比度模式均为 required 验收。

## 14. 响应式与降级

| 条件 | 行为 |
| --- | --- |
| 窄视口 | Planner 使用既有底部受限布局；Pill/Execution Island 保持安全边距，不复制 Demo 的 930px 居中尺寸 |
| 工作台内容过高 | Shell 高度钳制；正文内部滚动；标题、关闭和主操作可见 |
| Motion 扩展未注册或 GSAP 不可用 | 核心 Runtime fallback 立即设置最终 Scene/几何，核心功能完整 |
| `prefers-reduced-motion: reduce` | 无 Morph、光扫、呼吸或 blur；即时切换并保留文字状态 |
| 页面 hidden | 暂停装饰动画；有限状态切换直接收口 |
| 几何无效 | 跳过 FLIP，直接显示真实状态 |
| 动画中 Resize/缩放 | 取消旧 generation，基于新视口应用最新 Scene |
| 动画中拖拽 | 几何控制器接管；Motion 收口后等待释放 |

## 15. 项目组织与职责

当前实现按“核心契约 + 独立 browser bundle”组织：

```text
packages/runtime/src/ui/
├── floating-surface-position.ts          # 已实现：纯位置与吸附
├── floating-surface-controller.ts        # 扩展：唯一 Shell 几何、拖拽、Resize 协调
├── execution-island.ts                   # Compact/Expanded、真实 Logo、timer、活动与清理
├── execution-island.test.ts
├── motion-extension-contract.ts          # 核心：投影/元素/控制器契约与全局注册
├── motion-controller.ts                  # 独立入口使用：GSAP/CSS 编排和生命周期
├── motion-controller.test.ts
├── runtime-view.ts                        # DOM 与业务输入接线
└── runtime-view.test.ts

packages/runtime/src/motion-entry.ts       # @spotpatch/runtime/motion 子路径
packages/vite/src/runtime-motion.ts        # 注册独立 Motion 扩展
packages/vite/dist/runtime-motion.js       # 独立 browser 产物
```

职责边界：

- `runtime-view` 归一化真实业务状态，不实现 timeline；
- `motion-controller` 不调用 Agent API、不改变 Runtime State、不保存业务状态；
- `floating-surface-controller` 不理解 Agent 阶段和文案；
- 全局扩展通过 `Symbol.for("spotpatch.motion.v1")` 注册；没有注册时走无动画 fallback；
- `agent-panel` 和 `external-handoff-panel` 继续拥有详细内容，不各自创建大范围 Shell 动画；
- 如果实施证明 `motion-state` 只有一个极小映射且独立测试无价值，应合并进 `floating-surface-motion.ts`，不得保留空包装器。

## 16. 测试与验收

### 16.1 纯状态单元测试

- Runtime 四状态到 Scene 的完整映射；
- 全部 `AgentJobStatus` 映射，无默认猜测分支；
- inbox 与全部 `ExternalHandoffDispatchPhase` 映射；
- unknown/缺失输入安全回 Planner 或当前真实 Scene；
- ready/partial 颜色语义不混淆；
- 映射不修改输入，输出不可变。

### 16.2 Motion/DOM 单元测试

- 同一个 Shell 在 Pill、Planner、Running 间复用；
- 新 generation 取消旧 Animation，迟到 Promise 不覆盖新状态；
- reduced motion/无 WAAPI 时即时收口；
- Scene 的 `hidden/inert/aria-hidden/pointer-events` 与焦点一致；
- 几何无效时跳过 FLIP；快速重复派发不增加 timeline 或装饰层；
- 派发期间只应用最后一个真实状态投影；一次真实阶段变化最多触发一次光扫；
- Compact/Expanded 复用同一 Logo、标题、状态和 Shell，并只展示真实活动；
- timer 只在 running 且存在 Job 快照时间或真实本地观测起点时启动，hidden/dispose 后清理；
- 页面 hidden 暂停装饰、visible 只恢复当前 Scene；
- dispose 后无 Animation、Observer 和 listener；
- Motion 不调用 Agent API、不写 Storage、不改变 Runtime 业务状态。

### 16.3 Runtime 集成测试

- 选中后立即可编辑；动画不延迟 `showSelection()`；
- Trigger 点击与拖拽判定保持现有行为；
- Planner 标题栏拖拽和 Scene Morph 不争夺几何；
- 真实 Agent/外部交接状态逐项映射；inbox 不进入 Running；
- 失败、取消、delivery-unknown 不显示成功；
- result 回 Planner 后 Diff、Apply/Revert、错误与目标草稿仍存在；
- HMR 后只有一个 Shell 和一套监听器。

### 16.4 Chromium 与性能验收

- Pill→Capturing→Planner、Handoff→Running→Result、Compact↔Expanded 关键截图；
- 右下、左上、自由位置和边缘吸附下 Morph 均不越界；
- 桌面、窄视口、触摸、200% 缩放、动态视口和 reduced motion；
- 中文、英文、长组件名、长路径、长错误和真实活动摘要；
- Animation 期间 hit area 与视觉几何一致，无透明可点击控件；
- Performance trace 无新增不可解释 Long Task；布局仅限唯一 Shell；
- Runtime gzip、生产零残留、CSP nonce 和包验证继续通过。

禁止使用固定 sleep 验证动画。测试等待 Scene data 状态、Animation finished、最终几何或可访问状态；截图只覆盖稳定关键帧。

## 17. 实施顺序与 Gate

### 当前实施证据与后续 Gate

| 阶段 | 当前状态 | 证据与剩余项 |
| --- | --- | --- |
| P0 规范与基线 | 已完成 | 本文、状态枚举核对和参考 Demo 非规范边界已固化；参考 HTML 保持用户资产 |
| P1 纯视觉投影 | 已完成 | `runtime-view.ts` 显式映射 Runtime、内置 Agent、外部 dispatch 与 Codex managed phase；无协议扩展或伪进度 |
| P2 持续 Shell | 已完成 | `spotpatch-floating-surface` 是唯一 fixed Shell；拖拽控制器只注册该 Shell；Runtime View 测试覆盖场景复用和可访问性 |
| P3 有限 Motion | 已完成 | 独立 GSAP Core bundle、可中断 FLIP、reduced-motion、visibility 和 dispose 清理已完成 |
| P4 真实 Agent 动效 | 已完成 | Run/Send 短反馈、一次性光扫、真实 Logo、Compact/Expanded、真实活动及 managedPhase 已接入 |
| P5 全量验收 | 进行中 | 全仓 lint、typecheck、762 项单测（另 2 项按既有条件跳过）、build、bundle budget 与 production leakage 均通过；真实 Chromium 截图、触摸、缩放与 Performance trace 待补 |

### P0：规范与基线

- 固化本方案、参考 Demo 非规范边界和当前截图/包体；
- 记录现有 Trigger/Dialog DOM、Runtime/Agent/交接状态映射；
- 确认现有测试全部通过。

Gate：文档无冲突；未把 Demo 定时数据写成产品事实；工作树中的参考 HTML 保持用户资产，不纳入运行时代码。

### P1：纯视觉投影

- 实现 `floating-surface-motion-state` 和完整枚举测试；
- 不改协议、不加状态、不接 DOM 动画。

Gate：全部公开状态均显式映射；无 `default => success/running` 猜测。

### P2：持续 Shell

- 把 Trigger/Dialog 收敛为同一 fixed Shell；
- 保留原生 button、dialog、焦点、拖拽和 Session 位置；
- 完成无动画即时切换与 DOM 集成测试。

Gate：单一 Shell、无重复 fixed 表面、无透明交互层、核心流程无回归。

### P3：有限 Motion 编排

- 接入独立 GSAP Core bundle、Scene 交叉揭示、Shell FLIP、取消和 reduced motion；
- 完成 visibility/resize/drag/HMR 生命周期。

Gate：没有自有逐帧引擎、无未释放 timeline/listener、Motion 不改变业务状态。

### P4：真实 Agent 动效

- 接入 Run/Send 按压、真实派发后的短反馈、Handoff/Running/Result 与 Compact/Expanded；
- 内置 Agent 与外部 Agent 统一视觉投影；
- 删除被替代的基础双表面动画、重复 CSS 和旧断言。

Gate：无假百分比、假阶段、假工具活动或假成功；失败与未知交付不被美化为成功。

### P5：全量验收与收口

- format、lint、全部 package typecheck、unit、performance、production leakage、build、E2E、package validate；
- Chromium Performance、截图、触摸、缩放、reduced motion 和 CSP 验收；
- 审核未使用导出、CSS token、动画 class、监听器和参考 Demo 残留；
- 验收后更新 `status`、`implementation-status` 和实现证据。

Gate：全部 required checks 通过；没有未解释 skip、死代码、重复状态、散落策略值或未经测量的包体放宽。

## 18. 决策摘要

| 决策 | 结论 |
| --- | --- |
| 产品模型 | 一个持续 Shell，Scene 随真实信息密度变化 |
| 业务状态 | 复用 Runtime、Agent Job 和 External Handoff；不新增协议状态 |
| 动画技术 | 独立 GSAP Core bundle + CSS；不实现自有 Timeline 引擎 |
| GSAP | 精确锁定 3.15.0；本地打包；不进入核心 Runtime；不使用 CDN |
| React Motion | 不进入非 React Runtime |
| 几何所有者 | `floating-surface-controller` 唯一写 Shell 几何 |
| Context Ready | 不阻塞 Planner；真实 ready 后局部 Mint 确认 |
| Agent 阶段 | 只由真实快照/交接状态驱动 |
| 进度 | 无真实百分比就只显示阶段 |
| 结果 | 返回 Planner 并保留结果，不自动清空 |
| 装饰 | 极弱静态品牌光、状态点呼吸、关键状态一次性 1px 光扫 |
| 安全 | 无远程资源、无新网络/Storage/权限、无用户 HTML 注入 |
| 降级 | reduced motion 或 Motion 扩展不可用时即时切换 |
| 实施状态 | 代码已实现；自动化与真实 Chromium 视觉/性能验收尚未全部完成 |
