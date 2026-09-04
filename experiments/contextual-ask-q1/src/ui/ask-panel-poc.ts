export interface AskPanelPocCitation {
  readonly endLine: number;
  readonly path: string;
  readonly sourceId: string;
  readonly startLine: number;
}

export interface AskPanelPocBlock {
  readonly citations: readonly string[];
  readonly kind: "code" | "paragraph";
  readonly language?: string;
  readonly text: string;
}

export interface AskPanelPocOptions {
  readonly blocks: readonly AskPanelPocBlock[];
  readonly citations: readonly AskPanelPocCitation[];
  readonly host: HTMLElement;
  readonly question: string;
}

export interface AskPanelPoc {
  readonly answerPanel: HTMLElement;
  readonly askButton: HTMLButtonElement;
  readonly changeButton: HTMLButtonElement;
  readonly dispose: () => void;
  readonly questionInput: HTMLTextAreaElement;
  readonly root: ShadowRoot;
  readonly setMode: (mode: "ask" | "change") => void;
}

const MAXIMUM_BLOCKS = 40;
const MAXIMUM_CITATIONS = 64;
const MAXIMUM_ANSWER_CHARACTERS = 40_000;

const STYLES = `
  :host {
    all: initial;
    color: #f4f4f7;
    font-family: Inter, "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; }
  button, textarea { font: inherit; }
  .ask-shell {
    width: min(26rem, calc(100vw - 1.5rem));
    max-height: min(42rem, calc(100vh - 1.5rem));
    overflow: hidden;
    border: 1px solid rgb(139 124 247 / 32%);
    border-radius: 1rem;
    color: #f4f4f7;
    background: rgb(13 15 22 / 98%);
    box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 38%);
  }
  .mode-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: .25rem;
    padding: .5rem;
    background: #11141c;
  }
  .mode-tab {
    min-height: 2.75rem;
    border: 0;
    border-radius: .75rem;
    color: #9da6b5;
    background: transparent;
    cursor: pointer;
    font-size: .875rem;
    font-weight: 650;
  }
  .mode-tab[aria-selected="true"] {
    color: #fff;
    background: linear-gradient(135deg, rgb(109 93 246 / 34%), rgb(46 160 213 / 22%));
  }
  .mode-tab:focus-visible, textarea:focus-visible, .source-link:focus-visible {
    outline: 2px solid #9b8cff;
    outline-offset: 2px;
  }
  .composer { padding: .75rem; border-bottom: 1px solid rgb(148 163 184 / 12%); }
  .eyebrow { margin: 0 0 .35rem; color: #a7b0c0; font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; }
  textarea {
    display: block;
    width: 100%;
    min-height: 5.5rem;
    resize: vertical;
    border: 1px solid rgb(148 163 184 / 20%);
    border-radius: .75rem;
    padding: .75rem;
    color: #f8fafc;
    background: #090b10;
    font-size: .875rem;
    line-height: 1.55;
  }
  .answer {
    max-height: min(29rem, calc(100vh - 12rem));
    overflow: auto;
    overscroll-behavior: contain;
    padding: .875rem;
    scrollbar-gutter: stable;
  }
  .answer[hidden] { display: none; }
  .answer-header { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  .answer-header h2 { margin: 0; font-size: .95rem; }
  .answer-status { color: #86efac; font-size: .72rem; font-weight: 700; }
  .answer-blocks { display: grid; gap: .75rem; margin-top: .75rem; }
  .answer-block { margin: 0; color: #dfe4ec; font-size: .82rem; line-height: 1.65; overflow-wrap: anywhere; white-space: pre-wrap; }
  pre.answer-block { overflow: auto; border: 1px solid rgb(148 163 184 / 14%); border-radius: .7rem; padding: .7rem; background: #080a0f; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: normal; white-space: pre; }
  .block-citations { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .35rem; }
  .citation-chip, .source-link {
    min-height: 2rem;
    border: 1px solid rgb(96 165 250 / 22%);
    border-radius: 999px;
    padding: .35rem .55rem;
    color: #bfdbfe;
    background: rgb(30 64 175 / 14%);
    font-size: .7rem;
  }
  .sources { margin-top: .9rem; border-top: 1px solid rgb(148 163 184 / 12%); padding-top: .75rem; }
  .sources summary { min-height: 2.5rem; color: #cbd5e1; cursor: pointer; font-size: .8rem; }
  .source-list { display: grid; gap: .4rem; margin: .25rem 0 0; padding: 0; list-style: none; }
  .source-link { width: 100%; border-radius: .6rem; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
  .change-note { margin: 0; padding: .875rem; color: #cbd5e1; font-size: .82rem; line-height: 1.55; }
  @media (prefers-reduced-motion: no-preference) {
    .mode-tab { transition: color 140ms ease, background-color 140ms ease; }
  }
  @media (max-width: 20rem) {
    .ask-shell { width: calc(100vw - .75rem); border-radius: .75rem; }
    .mode-tabs { padding: .35rem; }
    .composer, .answer { padding: .65rem; }
  }
`;

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  name: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const value = document.createElement(name);
  if (className !== undefined) value.className = className;
  return value;
}

function validate(options: AskPanelPocOptions): void {
  const answerCharacters = options.blocks.reduce(
    (total, block) => total + block.text.length,
    0,
  );
  if (
    options.question.trim().length === 0 ||
    options.blocks.length === 0 ||
    options.blocks.length > MAXIMUM_BLOCKS ||
    options.citations.length > MAXIMUM_CITATIONS ||
    answerCharacters > MAXIMUM_ANSWER_CHARACTERS
  ) {
    throw new Error("ASK_UI_POC_LIMIT_EXCEEDED");
  }
}

export function mountAskPanelPoc(options: AskPanelPocOptions): AskPanelPoc {
  validate(options);
  const document = options.host.ownerDocument;
  const root = options.host.attachShadow({ mode: "open" });
  const style = element(document, "style");
  style.textContent = STYLES;
  const shell = element(document, "section", "ask-shell");
  shell.setAttribute("aria-label", "SpotPatch contextual task");
  const tabs = element(document, "div", "mode-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Task mode");
  const askButton = element(document, "button", "mode-tab");
  askButton.type = "button";
  askButton.textContent = "Ask";
  askButton.setAttribute("role", "tab");
  const changeButton = element(document, "button", "mode-tab");
  changeButton.type = "button";
  changeButton.textContent = "Change";
  changeButton.setAttribute("role", "tab");
  tabs.append(askButton, changeButton);

  const composer = element(document, "section", "composer");
  const eyebrow = element(document, "p", "eyebrow");
  eyebrow.textContent = "1 selected element · read-only";
  const questionInput = element(document, "textarea");
  questionInput.value = options.question;
  questionInput.setAttribute("aria-label", "Question about selected elements");
  questionInput.maxLength = 4_000;
  composer.append(eyebrow, questionInput);

  const answerPanel = element(document, "section", "answer");
  answerPanel.setAttribute("aria-label", "Answer");
  const answerHeader = element(document, "div", "answer-header");
  const title = element(document, "h2");
  title.textContent = "Answer";
  const status = element(document, "span", "answer-status");
  status.textContent = "ANSWER READY";
  answerHeader.append(title, status);
  const blockList = element(document, "div", "answer-blocks");
  const citationMap = new Map(
    options.citations.map((citation) => [citation.sourceId, citation]),
  );
  for (const block of options.blocks) {
    const blockElement = element(
      document,
      block.kind === "code" ? "pre" : "p",
      "answer-block",
    );
    blockElement.textContent = block.text;
    blockList.append(blockElement);
    if (block.citations.length === 0) continue;
    const blockCitations = element(document, "div", "block-citations");
    for (const sourceId of block.citations) {
      const citation = citationMap.get(sourceId);
      if (citation === undefined) throw new Error("ASK_UI_POC_UNKNOWN_CITATION");
      const chip = element(document, "span", "citation-chip");
      chip.textContent = `${citation.path}:${String(citation.startLine)}`;
      blockCitations.append(chip);
    }
    blockList.append(blockCitations);
  }
  const sources = element(document, "details", "sources");
  const summary = element(document, "summary");
  summary.textContent = `${String(options.citations.length)} source references`;
  const sourceList = element(document, "ul", "source-list");
  for (const citation of options.citations) {
    const item = element(document, "li");
    const sourceButton = element(document, "button", "source-link");
    sourceButton.type = "button";
    sourceButton.dataset.sourceId = citation.sourceId;
    sourceButton.textContent = `${citation.path}:${String(citation.startLine)}–${String(citation.endLine)}`;
    item.append(sourceButton);
    sourceList.append(item);
  }
  sources.append(summary, sourceList);
  answerPanel.append(answerHeader, blockList, sources);

  const changePanel = element(document, "p", "change-note");
  changePanel.textContent =
    "Change mode keeps its own draft. Converting an answer creates a draft only.";

  shell.append(tabs, composer, answerPanel, changePanel);
  root.append(style, shell);

  const setMode = (mode: "ask" | "change"): void => {
    const ask = mode === "ask";
    askButton.setAttribute("aria-selected", String(ask));
    changeButton.setAttribute("aria-selected", String(!ask));
    answerPanel.hidden = !ask;
    changePanel.hidden = ask;
  };
  const onAsk = (): void => setMode("ask");
  const onChange = (): void => setMode("change");
  askButton.addEventListener("click", onAsk);
  changeButton.addEventListener("click", onChange);
  setMode("ask");

  return Object.freeze({
    root,
    askButton,
    changeButton,
    questionInput,
    answerPanel,
    setMode,
    dispose() {
      askButton.removeEventListener("click", onAsk);
      changeButton.removeEventListener("click", onChange);
      options.host.remove();
    },
  });
}
