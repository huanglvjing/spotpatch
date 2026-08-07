import { chromium } from "@playwright/test";

const targetUrl = process.argv[2];
const requestedSampleSize = Number(process.argv[3] ?? 75);

if (targetUrl === undefined) {
  throw new Error("Usage: sample-visible-elements.mjs <url> [sample-size]");
}

if (
  !Number.isSafeInteger(requestedSampleSize) ||
  requestedSampleSize < 50 ||
  requestedSampleSize > 100
) {
  throw new RangeError("The acceptance sample size must be between 50 and 100.");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (error) => {
  pageErrors.push(error.message);
});

try {
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation-delay:0s!important;animation-duration:0s!important;scroll-behavior:auto!important;transition:none!important}",
  });

  const pageResult = await page.evaluate(async (sampleSize) => {
    const candidateSelector = [
      "a",
      "article",
      "button",
      "code",
      "div",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "img",
      "input",
      "label",
      "li",
      "p",
      "path",
      "pre",
      "section",
      "span",
      "svg",
      "textarea",
    ].join(",");
    const sourceAttribute = "data-spotpatch-source";

    const isVisible = (element) => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
        return false;
      }

      if (element.closest("spotpatch-root") !== null) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width >= 2 &&
        rect.height >= 2 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.pointerEvents !== "none"
      );
    };

    const balanced = (elements, limit) => {
      const groups = new Map();

      for (const element of elements) {
        const tag = element.tagName.toLowerCase();
        const group = groups.get(tag) ?? [];
        group.push(element);
        groups.set(tag, group);
      }

      const selected = [];
      let offset = 0;

      while (selected.length < limit) {
        let added = false;

        for (const group of groups.values()) {
          const element = group[offset];

          if (element !== undefined) {
            selected.push(element);
            added = true;

            if (selected.length >= limit) {
              break;
            }
          }
        }

        if (!added) {
          break;
        }

        offset += 1;
      }

      return selected;
    };

    const allCandidates = Array.from(
      document.querySelectorAll(candidateSelector),
    ).filter(isVisible);
    const markedCandidates = allCandidates.filter((element) =>
      element.hasAttribute(sourceAttribute),
    );
    const unmarkedCandidates = allCandidates.filter(
      (element) => !element.hasAttribute(sourceAttribute),
    );
    const requestedMarked = Math.round((sampleSize * 2) / 3);
    const marked = balanced(markedCandidates, requestedMarked * 2);
    const unmarked = balanced(unmarkedCandidates, (sampleSize - requestedMarked) * 2);
    const candidates = [];

    while (marked.length > 0 || unmarked.length > 0) {
      const firstMarked = marked.shift();
      const secondMarked = marked.shift();
      const nextUnmarked = unmarked.shift();

      if (firstMarked !== undefined) candidates.push(firstMarked);
      if (secondMarked !== undefined) candidates.push(secondMarked);
      if (nextUnmarked !== undefined) candidates.push(nextUnmarked);
    }

    const host = document.querySelector("spotpatch-root");
    const root = host?.shadowRoot;

    if (root === null || root === undefined) {
      throw new Error("SpotPatch runtime was not mounted.");
    }

    const trigger = root.querySelector(".spotpatch-trigger");
    const dialog = root.querySelector(".spotpatch-dialog");
    const summary = root.querySelector(".spotpatch-summary");
    const reselect = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Start over",
    );

    if (
      !(trigger instanceof HTMLButtonElement) ||
      !(dialog instanceof HTMLElement) ||
      !(summary instanceof HTMLElement) ||
      !(reselect instanceof HTMLButtonElement)
    ) {
      throw new Error("SpotPatch acceptance controls were not available.");
    }

    const nextFrame = async () => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          resolve(undefined);
        });
      });
    };
    const waitUntil = async (predicate, timeoutMs = 2_000) => {
      const deadline = performance.now() + timeoutMs;

      while (!predicate() && performance.now() < deadline) {
        await nextFrame();
      }

      return predicate();
    };
    const lineValue = (text, prefix) =>
      text
        .split("\n")
        .find((line) => line.startsWith(prefix))
        ?.slice(prefix.length);

    trigger.click();
    const samples = [];
    const selectedElements = new Set();

    for (const candidate of candidates) {
      if (samples.length >= sampleSize || !candidate.isConnected) {
        continue;
      }

      candidate.scrollIntoView({ block: "center", inline: "center" });
      await nextFrame();
      await nextFrame();
      const rect = candidate.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const actual = document.elementFromPoint(x, y);

      if (
        actual === null ||
        actual.closest("spotpatch-root") !== null ||
        selectedElements.has(actual)
      ) {
        continue;
      }

      selectedElements.add(actual);
      const selectionStartedAt = performance.now();
      actual.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }),
      );
      const selected = await waitUntil(
        () => !dialog.hidden && summary.textContent.includes("Confidence:"),
      );

      if (!selected) {
        continue;
      }

      const summaryMs = performance.now() - selectionStartedAt;
      await waitUntil(
        () =>
          /Browser context: (?:failed|ready)/u.test(summary.textContent) &&
          !summary.textContent.includes("API: loading"),
      );
      const contextMs = performance.now() - selectionStartedAt;
      const text = summary.textContent;
      const confidence = lineValue(text, "Confidence: ")?.split(" ", 1)[0];
      const source = lineValue(text, "Source: ");
      const component = lineValue(text, "Component: ");
      const origin = lineValue(text, "Origin: ");

      samples.push({
        candidateMarked: candidate.hasAttribute(sourceAttribute),
        component,
        confidence,
        contextMs,
        origin,
        selectedMarked: actual.hasAttribute(sourceAttribute),
        source,
        sourceAvailable: source !== undefined && source !== "Unavailable",
        summaryMs,
        tag: actual.tagName.toLowerCase(),
      });

      reselect.click();
      await waitUntil(() => dialog.hidden);
    }

    if (trigger.getAttribute("aria-pressed") === "true") {
      trigger.click();
    }

    return {
      candidatePool: {
        marked: markedCandidates.length,
        total: allCandidates.length,
        unmarked: unmarkedCandidates.length,
      },
      pathname: location.pathname,
      runtimeCount: document.querySelectorAll("spotpatch-root").length,
      samples,
      title: document.title,
    };
  }, requestedSampleSize);

  const countBy = (key) =>
    Object.fromEntries(
      Array.from(
        pageResult.samples.reduce((counts, sample) => {
          const value = sample[key] ?? "missing";
          counts.set(value, (counts.get(value) ?? 0) + 1);
          return counts;
        }, new Map()),
      ).sort(([left], [right]) => left.localeCompare(right)),
    );
  const markedSamples = pageResult.samples.filter((sample) => sample.selectedMarked);
  const percentage = (value, total) =>
    total === 0 ? 0 : Number(((value / total) * 100).toFixed(1));
  const percentile = (values, fraction) => {
    const ordered = [...values].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
    return Number((ordered[index] ?? Number.POSITIVE_INFINITY).toFixed(2));
  };
  const contextTimings = pageResult.samples.map((sample) => sample.contextMs);
  const summaryTimings = pageResult.samples.map((sample) => sample.summaryMs);
  const result = {
    absolutePathLeaked: pageResult.samples.some((sample) =>
      sample.source?.includes("/Users/"),
    ),
    candidatePool: pageResult.candidatePool,
    component: countBy("component"),
    componentPresentRate: percentage(
      pageResult.samples.filter((sample) => sample.component !== undefined).length,
      pageResult.samples.length,
    ),
    confidence: countBy("confidence"),
    exactRateAmongMarked: percentage(
      markedSamples.filter((sample) => sample.confidence === "exact").length,
      markedSamples.length,
    ),
    origin: countBy("origin"),
    pageErrorCount: pageErrors.length,
    pathname: pageResult.pathname,
    requestedSampleSize,
    runtimeCount: pageResult.runtimeCount,
    sampleCount: pageResult.samples.length,
    selectedMarkedCount: markedSamples.length,
    sourceAvailableRate: percentage(
      pageResult.samples.filter((sample) => sample.sourceAvailable).length,
      pageResult.samples.length,
    ),
    sourceComponent: Object.fromEntries(
      Array.from(
        pageResult.samples.reduce((counts, sample) => {
          const pair = `${sample.source ?? "Unavailable"} → ${sample.component ?? "missing"}`;
          counts.set(pair, (counts.get(pair) ?? 0) + 1);
          return counts;
        }, new Map()),
      ).sort(([left], [right]) => left.localeCompare(right)),
    ),
    tag: countBy("tag"),
    tagComponent: Object.fromEntries(
      Array.from(
        pageResult.samples.reduce((counts, sample) => {
          const pair = `${sample.tag} → ${sample.component ?? "missing"}`;
          counts.set(pair, (counts.get(pair) ?? 0) + 1);
          return counts;
        }, new Map()),
      ).sort(([left], [right]) => left.localeCompare(right)),
    ),
    timingMs: {
      contextMedian: percentile(contextTimings, 0.5),
      contextP95: percentile(contextTimings, 0.95),
      summaryMedian: percentile(summaryTimings, 0.5),
      summaryP95: percentile(summaryTimings, 0.95),
    },
    title: pageResult.title,
  };

  console.log(JSON.stringify(result, null, 2));

  if (
    result.sampleCount < 50 ||
    result.absolutePathLeaked ||
    result.runtimeCount !== 1 ||
    result.pageErrorCount !== 0 ||
    result.timingMs.contextP95 >= 300 ||
    result.timingMs.summaryP95 >= 100
  ) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
