import type { DataDependency, SpotPatchLocale } from "@spotpatch/shared";

import { createButton, createMarkedElement } from "./dom.js";
import type {
  DataFlowPanel,
  DataFlowPanelSnapshot,
  DataFlowViewState,
} from "./data-flow-panel-contract.js";

interface Labels {
  readonly server: string;
  readonly client: string;
  readonly bindings: string;
  readonly changes: string;
  readonly componentEmpty: string;
  readonly componentTab: string;
  readonly componentTitle: string;
  readonly consumed: string;
  readonly declared: string;
  readonly diagnostics: string;
  readonly disabled: string;
  readonly error: string;
  readonly evidence: string;
  readonly loading: string;
  readonly logicalObserved: string;
  readonly noParameters: string;
  readonly observed: string;
  readonly pageEmpty: string;
  readonly pageTab: string;
  readonly pageTitle: string;
  readonly parameters: string;
  readonly refresh: string;
  readonly unknown: string;
}

const LABELS = Object.freeze({
  "zh-CN": Object.freeze({
    server: "服务端（静态证据）",
    client: "浏览器",
    bindings: "数据去向",
    changes: "修改说明",
    componentEmpty: "当前组件没有找到可证明的接口。未找到不等于没有请求。",
    componentTab: "数据链路",
    componentTitle: "组件数据链路",
    consumed: "读取字段",
    declared: "代码声明，尚未在本次页面会话中观测",
    diagnostics: "诊断",
    disabled: "数据链路能力未启用，请在插件配置中设置 dataFlow: {}。",
    error: "数据链路报告加载失败",
    evidence: "证据",
    loading: "正在分析源码并合并运行时证据…",
    logicalObserved: "本次会话已进入 tRPC 调用链",
    noParameters: "未提取到可证明的参数键",
    observed: "本次会话已实际请求",
    pageEmpty: "当前已选页面范围内没有静态接口或运行时网络记录。",
    pageTab: "页面接口",
    pageTitle: "页面接口",
    parameters: "请求参数",
    refresh: "刷新证据",
    unknown: "未知",
  }),
  "en-US": Object.freeze({
    server: "Server (static evidence)",
    client: "Browser",
    bindings: "Data destinations",
    changes: "Changes",
    componentEmpty:
      "No proven interface was found for this component. This does not prove that no request exists.",
    componentTab: "Data flow",
    componentTitle: "Component data flow",
    consumed: "Consumed fields",
    declared: "Declared in code, not observed in this page session",
    diagnostics: "Diagnostics",
    disabled: "Data flow is disabled. Set dataFlow: {} in the plugin options.",
    error: "Failed to load the data-flow report",
    evidence: "Evidence",
    loading: "Analyzing source and merging runtime evidence…",
    logicalObserved: "Dispatched through the tRPC link in this session",
    noParameters: "No proven parameter keys were extracted",
    observed: "Actually requested in this session",
    pageEmpty:
      "No static interface or runtime traffic is available for the selected page scope.",
    pageTab: "Page APIs",
    pageTitle: "Page interfaces",
    parameters: "Request parameters",
    refresh: "Refresh evidence",
    unknown: "Unknown",
  }),
}) satisfies Readonly<Record<SpotPatchLocale, Labels>>;

function badge(document: Document, text: string, tone: string): HTMLElement {
  const element = createMarkedElement(document, "span");
  element.className = "spotpatch-data-flow-badge";
  element.dataset.tone = tone;
  element.textContent = text;
  return element;
}

function detailRow(document: Document, label: string, value: string): HTMLElement {
  const row = createMarkedElement(document, "div");
  row.className = "spotpatch-data-flow-detail";
  const key = createMarkedElement(document, "span");
  key.textContent = label;
  const content = createMarkedElement(document, "code");
  content.textContent = value;
  row.append(key, content);
  return row;
}

function renderDependency(
  document: Document,
  dependency: DataDependency,
  labels: Labels,
): HTMLElement {
  const card = createMarkedElement(document, "article");
  card.className = "spotpatch-data-flow-card";
  const header = createMarkedElement(document, "div");
  header.className = "spotpatch-data-flow-card-head";
  const endpoint = createMarkedElement(document, "div");
  endpoint.className = "spotpatch-data-flow-endpoint";
  const method = createMarkedElement(document, "strong");
  method.textContent = dependency.method ?? labels.unknown;
  const path = createMarkedElement(document, "code");
  path.textContent =
    dependency.url === undefined
      ? (dependency.operation ?? labels.unknown)
      : `${dependency.url.origin ?? ""}${dependency.url.pathname}`;
  endpoint.append(method, path);
  const states = createMarkedElement(document, "div");
  states.className = "spotpatch-data-flow-badges";
  states.append(
    badge(
      document,
      dependency.execution === "observed"
        ? dependency.kind === "rpc"
          ? labels.logicalObserved
          : labels.observed
        : labels.declared,
      dependency.execution === "observed" ? "success" : "neutral",
    ),
    badge(
      document,
      dependency.proof,
      dependency.proof === "proven" ? "proof" : "warning",
    ),
    badge(document, dependency.association, "neutral"),
  );
  header.append(endpoint, states);
  if (dependency.environment !== undefined)
    states.append(badge(document, labels[dependency.environment], "neutral"));

  const parameters =
    dependency.parameters.length === 0
      ? labels.noParameters
      : dependency.parameters
          .map(
            (parameter) =>
              `${parameter.position}.${parameter.path}${parameter.type === undefined ? "" : `: ${parameter.type}`}${parameter.sensitive ? " [sensitive]" : ""}${parameter.condition === undefined ? "" : ` [when ${parameter.condition}]`}`,
          )
          .join("\n");
  const consumed =
    dependency.response.consumedFields.length === 0
      ? labels.unknown
      : dependency.response.consumedFields.join(", ");
  const bindings =
    dependency.suppliedBindings.length === 0
      ? labels.unknown
      : dependency.suppliedBindings.join(", ");
  const body = createMarkedElement(document, "div");
  body.className = "spotpatch-data-flow-card-body";
  const observationIds = new Set(dependency.observationIds);
  const staticEvidenceCount = dependency.evidenceIds.filter(
    (id) => !observationIds.has(id),
  ).length;
  body.append(
    detailRow(document, labels.parameters, parameters),
    detailRow(document, labels.consumed, consumed),
    detailRow(document, labels.bindings, bindings),
    detailRow(
      document,
      labels.evidence,
      `${String(staticEvidenceCount)} static · ${String(dependency.observationIds.length)} runtime`,
    ),
  );
  card.append(header, body);
  return card;
}

function createReportRoot(
  document: Document,
  titleText: string,
): Readonly<{ root: HTMLElement; status: HTMLElement; list: HTMLElement }> {
  const root = createMarkedElement(document, "section");
  root.className = "spotpatch-data-flow-panel";
  const title = createMarkedElement(document, "h3");
  title.textContent = titleText;
  const status = createMarkedElement(document, "p");
  status.className = "spotpatch-data-flow-status";
  const list = createMarkedElement(document, "div");
  list.className = "spotpatch-data-flow-list";
  root.append(title, status, list);
  return Object.freeze({ root, status, list });
}

export function createDataFlowPanel(
  document: Document,
  enabled: boolean,
  locale: () => SpotPatchLocale,
  changesRoot: HTMLElement,
  diagnosticsRoot: HTMLElement,
  onViewChange: () => void,
): DataFlowPanel {
  let labels = LABELS[locale()];
  const component = createReportRoot(document, labels.componentTitle);
  const page = createReportRoot(document, labels.pageTitle);
  const refreshButton = createButton(document, labels.refresh);
  const styles = document.createElement("style");
  styles.textContent = DATA_FLOW_PANEL_STYLES;
  refreshButton.classList.add("spotpatch-data-flow-refresh");
  component.root.prepend(refreshButton);
  const root = createMarkedElement(document, "div");
  const tabs = createMarkedElement(document, "nav");
  tabs.className = "spotpatch-view-tabs";
  tabs.setAttribute("aria-label", "SpotPatch views");
  tabs.setAttribute("role", "tablist");
  const views = new Map([
    ["changes", changesRoot],
    ["component-data", component.root],
    ["page-data", page.root],
    ["diagnostics", diagnosticsRoot],
  ]);
  const tabButtons = new Map<string, HTMLButtonElement>();
  let activeView = "changes";
  for (const id of views.keys()) {
    const button = createButton(document, "");
    button.dataset.viewId = id;
    button.id = `spotpatch-view-${id}-tab`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(id === activeView));
    const view = views.get(id);
    view?.setAttribute("aria-labelledby", button.id);
    view?.setAttribute("role", "tabpanel");
    if (!enabled && (id === "component-data" || id === "page-data")) {
      button.hidden = true;
    }
    tabButtons.set(id, button);
    tabs.append(button);
  }
  root.append(tabs, ...views.values());

  function selectView(viewId: string): void {
    if (!views.has(viewId)) return;
    activeView = viewId;
    for (const [id, view] of views) {
      view.hidden = id !== viewId;
      const button = tabButtons.get(id);
      button?.setAttribute("aria-selected", String(id === viewId));
      if (button !== undefined) button.tabIndex = id === viewId ? 0 : -1;
    }
    onViewChange();
  }

  function handleTabClick(event: Event): void {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const viewId = event.target.dataset.viewId;
    if (viewId !== undefined) selectView(viewId);
  }

  tabs.addEventListener("click", handleTabClick);
  selectView(activeView);

  function renderSnapshot(
    target: ReturnType<typeof createReportRoot>,
    snapshot: DataFlowPanelSnapshot,
    empty: string,
  ): void {
    target.list.replaceChildren();
    target.status.dataset.state = snapshot.status;
    if (!enabled || snapshot.status === "disabled") {
      target.status.textContent = labels.disabled;
      return;
    }
    if (snapshot.status === "loading") {
      target.status.textContent = labels.loading;
      return;
    }
    if (snapshot.status === "error") {
      target.status.textContent = snapshot.message ?? labels.error;
      return;
    }
    const report = snapshot.report;
    const diagnosticCodes =
      report === undefined
        ? ""
        : [...new Set(report.diagnostics.map(({ code }) => code))].join(", ");
    const diagnosticSuffix =
      diagnosticCodes.length === 0
        ? ""
        : ` · ${labels.diagnostics}: ${diagnosticCodes}`;
    if (report === undefined || report.dependencies.length === 0) {
      target.status.textContent = `${empty}${diagnosticSuffix}`;
      return;
    }
    target.status.textContent = `${String(report.dependencies.length)} · ${report.completeness.complete ? "complete" : "partial"}${diagnosticSuffix}`;
    target.list.append(
      ...report.dependencies.map((dependency) =>
        renderDependency(document, dependency, labels),
      ),
    );
  }

  return Object.freeze({
    root,
    refreshButton,
    styles,
    dispose(): void {
      tabs.removeEventListener("click", handleTabClick);
    },
    render(state: DataFlowViewState): void {
      labels = LABELS[locale()];
      const tabLabels = [
        labels.changes,
        labels.componentTab,
        labels.pageTab,
        labels.diagnostics,
      ];
      [...tabButtons.values()].forEach((button, index) => {
        button.textContent = tabLabels[index] ?? "";
      });
      refreshButton.textContent = `${labels.refresh} · ${String(state.observationCount)}`;
      refreshButton.disabled = !enabled || state.component.status === "loading";
      renderSnapshot(component, state.component, labels.componentEmpty);
      renderSnapshot(page, state.page, labels.pageEmpty);
    },
    resetView(): void {
      selectView("changes");
    },
  });
}

const DATA_FLOW_PANEL_STYLES = `
  .spotpatch-view-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; margin-bottom: 14px; padding: 3px; border: 1px solid var(--spotpatch-border-subtle); border-radius: var(--spotpatch-radius-md); background: var(--spotpatch-bg-input); }
  .spotpatch-view-tabs button { min-width: 0; border: 0; border-radius: var(--spotpatch-radius-sm); padding: 7px 5px; color: var(--spotpatch-text-muted); background: transparent; cursor: pointer; font-size: 11.5px; font-weight: 550; transition: color var(--spotpatch-duration-fast) ease, background var(--spotpatch-duration-base) var(--spotpatch-ease-out); }
  .spotpatch-view-tabs button:hover { color: var(--spotpatch-text); }
  .spotpatch-view-tabs button[aria-selected="true"] { color: var(--spotpatch-text); background: var(--spotpatch-bg-active); box-shadow: var(--spotpatch-shadow-inset), 0 0 0 1px var(--spotpatch-border); }
  .spotpatch-data-flow-panel { position: relative; }
  .spotpatch-data-flow-panel > h3 { margin: 0 0 3px; font-size: 13px; font-weight: 620; }
  .spotpatch-data-flow-refresh { position: absolute; top: -4px; right: 0; border: 1px solid var(--spotpatch-accent-line); border-radius: var(--spotpatch-radius-sm); padding: 4px 9px; color: var(--spotpatch-accent-soft); background: var(--spotpatch-accent-tint); cursor: pointer; font-size: 11.5px; }
  .spotpatch-data-flow-refresh:disabled { cursor: not-allowed; opacity: .4; }
  .spotpatch-data-flow-status { margin: 0 0 10px; color: var(--spotpatch-text-muted); font-size: 11.5px; line-height: 1.5; }
  .spotpatch-data-flow-list { display: grid; gap: 8px; }
  .spotpatch-data-flow-card { overflow: hidden; border: 1px solid var(--spotpatch-border-subtle); border-radius: var(--spotpatch-radius-card); background: var(--spotpatch-bg-raised); animation: spotpatch-enter var(--spotpatch-duration-slow) var(--spotpatch-ease-out) both; }
  .spotpatch-data-flow-card-head { display: grid; gap: 7px; padding: 10px 12px; border-bottom: 1px solid var(--spotpatch-border-subtle); }
  .spotpatch-data-flow-endpoint { display: flex; min-width: 0; align-items: center; gap: 8px; }
  .spotpatch-data-flow-endpoint strong { color: var(--spotpatch-cyan-text); font: 700 11px/1 var(--spotpatch-font-mono); }
  .spotpatch-data-flow-endpoint code { min-width: 0; overflow: hidden; font: 12px/1.4 var(--spotpatch-font-mono); text-overflow: ellipsis; white-space: nowrap; }
  .spotpatch-data-flow-badges { display: flex; flex-wrap: wrap; gap: 4px; }
  .spotpatch-data-flow-badge { border-radius: var(--spotpatch-radius-pill); padding: 2px 7px; color: var(--spotpatch-text-secondary); background: var(--spotpatch-hover); font-size: 10.5px; }
  .spotpatch-data-flow-badge[data-tone="success"] { color: var(--spotpatch-success-text); background: var(--spotpatch-success-tint); }
  .spotpatch-data-flow-badge[data-tone="proof"] { color: var(--spotpatch-accent-soft); background: var(--spotpatch-accent-tint); }
  .spotpatch-data-flow-badge[data-tone="warning"] { color: var(--spotpatch-warning-text); background: var(--spotpatch-warning-tint); }
  .spotpatch-data-flow-card-body { display: grid; gap: 7px; padding: 10px 12px; }
  .spotpatch-data-flow-detail { display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 8px; align-items: start; }
  .spotpatch-data-flow-detail > span { color: var(--spotpatch-text-muted); font-size: 11px; }
  .spotpatch-data-flow-detail > code { overflow-wrap: anywhere; color: var(--spotpatch-text-secondary); font: 11px/1.5 var(--spotpatch-font-mono); white-space: pre-wrap; }
`;
