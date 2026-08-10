import { expect, test, type Locator, type Page } from "@playwright/test";

const activatePicker = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Select element" }).click();
  await expect(page.getByRole("button", { name: "Stop selecting" })).toBeVisible();
};

const selectFixture = async (
  page: Page,
  target: Locator,
  position?: Readonly<{ x: number; y: number }>,
): Promise<Locator> => {
  await activatePicker(page);
  await target.click(position === undefined ? undefined : { position });

  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".spotpatch-summary")).toContainText(
    "Browser context: ready",
  );
  return dialog;
};

const reselectFixture = async (
  page: Page,
  dialog: Locator,
  target: Locator,
  position?: Readonly<{ x: number; y: number }>,
): Promise<Locator> => {
  await dialog.getByRole("button", { name: "Start over" }).click();
  await target.click(position === undefined ? undefined : { position });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".spotpatch-summary")).toContainText(
    "Browser context: ready",
  );
  return dialog;
};

const previewPrompt = async (
  page: Page,
  dialog: Locator,
  instruction: string,
): Promise<string> => {
  await dialog.locator("textarea[data-target-instruction-id]").fill(instruction);
  const previewButton = dialog.getByRole("button", {
    name: "Preview prompt",
  });
  await expect(previewButton).toBeEnabled();
  await previewButton.click();

  const prompt = page
    .getByRole("dialog", { name: "Review the request" })
    .getByLabel("Generated prompt");
  await expect(prompt).toContainText(instruction);
  return (await prompt.textContent()) ?? "";
};

test("resolves custom, memo, and forwardRef fixtures with stable component names", async ({
  page,
}) => {
  await page.goto("/");

  const businessHost = page.getByTestId("business-card");
  await expect(businessHost).toHaveAttribute(
    "data-spotpatch-source",
    /^[A-Za-z0-9_-]+:\d+:\d+$/u,
  );
  let dialog = await selectFixture(page, page.getByTestId("business-card-content"));
  let summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText("Source: src/business-card.tsx:");
  await expect(summary).toContainText("Confidence: exact (exact element source)");
  await expect(summary).toContainText("Component: BusinessCard");

  dialog = await reselectFixture(page, dialog, page.getByTestId("memo-panel"));
  summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText("Source: src/fixtures.tsx:");
  await expect(summary).toContainText("Component: MemoPanel");

  dialog = await reselectFixture(page, dialog, page.getByTestId("forward-field"));
  summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText("Source: src/fixtures.tsx:");
  await expect(summary).toContainText("Component: ForwardField");
});

test("selects both Fragment roots and keeps mapped instances traceable", async ({
  page,
}) => {
  await page.goto("/");
  let dialog = await selectFixture(page, page.getByTestId("fragment-first"));
  const firstFragmentSource = await dialog.locator(".spotpatch-summary").textContent();
  expect(firstFragmentSource).toContain("Confidence: exact");

  dialog = await reselectFixture(page, dialog, page.getByTestId("fragment-second"));
  const secondFragmentSource = await dialog.locator(".spotpatch-summary").textContent();
  expect(secondFragmentSource).toContain("Confidence: exact");
  expect(secondFragmentSource).not.toBe(firstFragmentSource);

  const listItems = page.getByTestId("mapped-list").getByRole("listitem");
  const markers = await listItems.evaluateAll((elements) =>
    elements.map((element) => ({
      marker: element.getAttribute("data-spotpatch-source"),
      testId: element.getAttribute("data-testid"),
    })),
  );
  expect(new Set(markers.map(({ marker }) => marker)).size).toBe(1);
  expect(new Set(markers.map(({ testId }) => testId)).size).toBe(3);

  dialog = await reselectFixture(page, dialog, listItems.nth(0));
  await expect(dialog.locator(".spotpatch-summary")).toContainText(
    "Confidence: exact (exact element source)",
  );
});

test("loads a lazy module and resolves its source on first render", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("show-lazy").click();
  await expect(page.getByTestId("lazy-panel")).toBeVisible();

  const dialog = await selectFixture(page, page.getByTestId("lazy-panel"));
  const summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText("Source: src/lazy-panel.tsx:");
  await expect(summary).toContainText("Confidence: exact (exact element source)");
  await expect(summary).toContainText("Component: LazyPanel");
});

test("collects Tailwind and CSS Module runtime styles", async ({ page }) => {
  await page.goto("/");
  let dialog = await selectFixture(page, page.getByTestId("tailwind-button"));
  let prompt = await previewPrompt(page, dialog, "Verify Tailwind context.");
  expect(prompt).toContain("bg-sky-600");
  expect(prompt).toContain("background-color:");

  await page
    .getByRole("dialog", { name: "Review the request" })
    .getByRole("button", { name: "Close SpotPatch" })
    .click();
  await page.getByRole("button", { name: "Select element" }).click();
  await expect(dialog).toBeVisible();
  dialog = await reselectFixture(page, dialog, page.getByTestId("css-module-card"), {
    x: 6,
    y: 6,
  });
  prompt = await previewPrompt(page, dialog, "Verify CSS Module context.");
  expect(prompt).toMatch(/moduleCard[_-][A-Za-z0-9_-]+/u);
  expect(prompt).toContain("border:");
  expect(prompt).toContain("rgb(245, 243, 255)");
});

test("selects Framer Motion and SVG with explicit confidence semantics", async ({
  page,
}) => {
  await page.goto("/");
  let dialog = await selectFixture(page, page.getByTestId("motion-button"));
  let summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText(/Confidence: (probable|unknown)/u);
  await expect(summary).not.toContainText("Confidence: exact");

  dialog = await reselectFixture(page, dialog, page.getByTestId("svg-fixture"));
  summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText("Confidence: exact (exact element source)");
  await expect(summary).toContainText("Source: src/main.tsx:");
});

test("removes login secrets from the complete generated prompt", async ({ page }) => {
  await page.goto("/?token=never-leak-page-token");
  const dialog = await selectFixture(page, page.getByTestId("security-form"));
  const prompt = await previewPrompt(
    page,
    dialog,
    "Review the sign-in fixture safely.",
  );

  expect(prompt).not.toContain("never-leak-password");
  expect(prompt).not.toContain("never-leak-token");
  expect(prompt).not.toContain("never-leak-url-token");
  expect(prompt).not.toContain("never-leak-page-token");
  expect(prompt).not.toContain("credential");
  expect(prompt).toContain("[redacted]");
});

test("keeps one StrictMode runtime and meets interaction latency budgets", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("spotpatch-root")).toHaveCount(1);
  await activatePicker(page);

  const hoverVisible = await page.evaluate(async () => {
    const target = document.querySelector<HTMLElement>(
      '[data-testid="business-card-content"]',
    );
    const host = document.querySelector("spotpatch-root");

    if (
      target === null ||
      host?.shadowRoot === null ||
      host?.shadowRoot === undefined
    ) {
      throw new Error("Performance fixture was not mounted.");
    }

    const rect = target.getBoundingClientRect();
    target.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
    const highlight =
      host.shadowRoot.querySelector<HTMLElement>(".spotpatch-highlight");
    return highlight?.hidden === false;
  });
  expect(hoverVisible).toBe(true);

  const timings = await page.evaluate(async () => {
    const target = document.querySelector<HTMLElement>(
      '[data-testid="business-card-content"]',
    );
    const root = document.querySelector("spotpatch-root")?.shadowRoot;

    if (target === null || root === null || root === undefined) {
      throw new Error("Performance fixture was not mounted.");
    }

    const rect = target.getBoundingClientRect();
    const startedAt = performance.now();
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );

    const waitFor = async (predicate: () => boolean): Promise<number> => {
      while (!predicate()) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            resolve();
          }),
        );
      }

      return performance.now() - startedAt;
    };

    const summaryTime = await waitFor(() => {
      const dialog = root.querySelector<HTMLElement>(".spotpatch-dialog");
      return dialog?.hidden === false;
    });
    const contextTime = await waitFor(
      () =>
        root
          .querySelector(".spotpatch-summary")
          ?.textContent.includes("Browser context: ready") === true,
    );

    return { contextTime, summaryTime };
  });

  expect(timings.summaryTime).toBeLessThan(100);
  expect(timings.contextTime).toBeLessThan(300);
  await expect(page.locator("spotpatch-root")).toHaveCount(1);
});
