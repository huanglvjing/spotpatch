import { expect, test, type Locator, type Page } from "@playwright/test";

const GEOMETRY_TOLERANCE_PX = 1;

interface ElementBox {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

const activatePicker = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Select element" }).click();
  await expect(page.getByRole("button", { name: "Stop selecting" })).toBeVisible();
};

const expectHighlightToMatch = async (
  page: Page,
  target: Locator,
  selector = ".spotpatch-highlight",
): Promise<void> => {
  const highlight = page.locator("spotpatch-root").locator(selector);

  await expect(highlight).toBeVisible();
  await expect
    .poll(async () => {
      const [targetBox, highlightBox] = await Promise.all([
        target.boundingBox(),
        highlight.boundingBox(),
      ]);
      if (targetBox === null || highlightBox === null) {
        return Number.POSITIVE_INFINITY;
      }

      return Math.max(
        Math.abs(highlightBox.x - targetBox.x),
        Math.abs(highlightBox.y - targetBox.y),
        Math.abs(highlightBox.width - targetBox.width),
        Math.abs(highlightBox.height - targetBox.height),
      );
    })
    .toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
};

const requireElementBox = async (
  locator: Locator,
  description: string,
): Promise<ElementBox> => {
  const box = await locator.boundingBox();

  if (box === null) {
    throw new Error(`Expected ${description} geometry.`);
  }

  return box;
};

const expectBoxWithinViewport = async (
  page: Page,
  locator: Locator,
): Promise<ElementBox> => {
  await expect(locator).not.toHaveAttribute("data-motion-morphing", "true");
  const box = await requireElementBox(locator, "floating surface");
  const viewport = page.viewportSize();

  if (viewport === null) {
    throw new Error("Expected a fixed browser viewport.");
  }

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  return box;
};

const expectEndAnchorToMatch = async (
  surface: Locator,
  expected: ElementBox,
): Promise<void> => {
  await expect(surface).not.toHaveAttribute("data-motion-morphing", "true");
  await expect
    .poll(async () => {
      const actual = await surface.boundingBox();

      if (actual === null) {
        return Number.POSITIVE_INFINITY;
      }

      return Math.max(
        Math.abs(actual.x + actual.width - (expected.x + expected.width)),
        Math.abs(actual.y + actual.height - (expected.y + expected.height)),
      );
    })
    .toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
};

test("keeps the highlight aligned with the hovered and selected element", async ({
  page,
}) => {
  await page.goto("/");
  const target = page.getByRole("heading", { name: "SpotPatch Playground" });
  await activatePicker(page);

  await target.hover();
  await expect(
    page.locator("spotpatch-root").locator(".spotpatch-highlight"),
  ).toBeVisible();
  await expectHighlightToMatch(page, target);

  await target.click();
  await expect(page.getByRole("dialog", { name: "Plan the change" })).toBeVisible();
  await expectHighlightToMatch(
    page,
    target,
    '.spotpatch-selection-highlight[data-active="true"]',
  );
});

test("keeps the floating workbench anchored while selections change", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const largeTarget = page.locator("main.page-shell");
  await activatePicker(page);
  await largeTarget.click({ position: { x: 4, y: 4 } });

  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  const surface = page.locator("spotpatch-root").locator(".spotpatch-floating-surface");
  await expect(surface).toHaveAttribute("data-floating-positioned", "true");
  await expect(dialog.locator("textarea[data-target-instruction-id]")).toBeFocused();
  const initialSurfaceBox = await expectBoxWithinViewport(page, surface);

  await dialog.getByRole("button", { name: "Start over" }).click();
  const compactTarget = page.getByRole("heading", {
    name: "SpotPatch Playground",
  });
  await compactTarget.click();
  await expectEndAnchorToMatch(surface, initialSurfaceBox);
  const selectedSurfaceBox = await expectBoxWithinViewport(page, surface);

  await dialog.getByRole("tab", { name: "Diagnostics" }).click();
  await dialog.locator(".spotpatch-diagnostics > summary").click();
  await expectEndAnchorToMatch(surface, selectedSurfaceBox);
  await expectBoxWithinViewport(page, surface);
});

test("selects a native element and sends an authorized editor request", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  let editorRequestBody: unknown;
  let editorToken = "";

  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });
  await page.route("**/__spotpatch/v1/open-editor", async (route) => {
    editorRequestBody = route.request().postDataJSON() as unknown;
    editorToken = route.request().headers()["x-spotpatch-token"] ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { editor: "auto" } }),
    });
  });

  await page.goto("/");
  await activatePicker(page);

  await page.getByRole("heading", { name: "SpotPatch Playground" }).click();

  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  await expect(dialog).toBeVisible();
  const summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText(/src\/main\.tsx:\d+:\d+/);
  await expect(summary).toContainText("Confidence: exact (exact element source)");
  await expect(summary).toContainText("Component: App");

  const repositoryLink = dialog.getByRole("link", { name: "Star SpotPatch on GitHub" });
  await expect(repositoryLink).toHaveAttribute(
    "href",
    "https://github.com/huanglvjing/spotpatch",
  );
  await expect(repositoryLink).toHaveAttribute("target", "_blank");
  await expect(repositoryLink).toHaveAttribute("rel", /noopener/);

  await expect(
    dialog.getByRole("button", { name: "Open source", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Open source for target 1" }).click();
  await expect.poll(() => editorRequestBody).toBeDefined();

  expect(editorRequestBody).toEqual({
    fileId: expect.any(String),
    line: expect.any(Number),
    column: expect.any(Number),
  });
  expect(editorToken.length).toBeGreaterThan(0);
  expect(browserErrors).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Select element" })).toBeVisible();
});

test("collects context and copies a bounded prompt", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4173",
  });
  await page.goto("/");
  await activatePicker(page);
  await page.getByTestId("business-card-content").click();

  const selectedDialog = page.getByRole("dialog", { name: "Plan the change" });
  await expect(selectedDialog).toBeVisible();
  await expect(selectedDialog.locator(".spotpatch-summary")).toContainText(
    "Boundary: component",
  );
  await selectedDialog
    .locator("textarea[data-target-instruction-id]")
    .fill("Align the business fixture content with its heading.");
  const previewButton = selectedDialog.getByRole("button", {
    name: "Preview prompt",
  });
  await expect(previewButton).toBeEnabled();
  await previewButton.click();

  const previewDialog = page.getByRole("dialog", { name: "Review the request" });
  const promptOutput = previewDialog.getByLabel("Generated prompt");
  await expect(promptOutput).toContainText("## Change requirements");
  await expect(promptOutput).toContainText(
    "Align the business fixture content with its heading.",
  );
  await expect(promptOutput).toContainText("#### Relevant styles");
  await expect(promptOutput).toContainText(".fixture-card p");
  await expect(promptOutput).toContainText("#### Nearby code");
  await expect(promptOutput).toContainText("- Boundary: component");

  const expectedPrompt = await promptOutput.textContent();
  await previewDialog.getByRole("button", { name: "Copy prompt" }).click();
  await expect(selectedDialog).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(expectedPrompt);
});

test("preserves distinct instructions while collecting and removing multiple components", async ({
  page,
}) => {
  await page.goto("/");
  await activatePicker(page);
  const first = page.getByTestId("business-card-content");
  const second = page.getByTestId("tailwind-button");
  await first.click();

  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  await dialog
    .locator("textarea[data-target-instruction-id]")
    .fill("Make the business card heading more prominent.");
  await dialog.getByRole("button", { name: "Add element" }).click();
  await expect(dialog).toBeHidden();
  await second.click();

  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".spotpatch-target-item")).toHaveCount(2);
  await expect(dialog.getByRole("button", { name: "Preview prompt" })).toBeDisabled();
  await dialog
    .locator("textarea[data-target-instruction-id]")
    .fill("Increase the Tailwind button horizontal padding.");
  await expect(
    page.locator("spotpatch-root").locator(".spotpatch-selection-highlight"),
  ).toHaveCount(2);
  await expect(dialog.getByRole("button", { name: "Preview prompt" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Preview prompt" }).click();

  const preview = page.getByRole("dialog", { name: "Review the request" });
  const output = preview.getByLabel("Generated prompt");
  await expect(output).toContainText("## Selected targets (2)");
  await expect(output).toContainText("src/business-card.tsx");
  await expect(output).toContainText("src/main.tsx");
  await expect(output).toContainText("### Target 1");
  await expect(output).toContainText("### Target 2");
  await expect(output).toContainText("Make the business card heading more prominent.");
  await expect(output).toContainText(
    "Increase the Tailwind button horizontal padding.",
  );

  await preview.getByRole("button", { name: "Back to edit" }).click();
  await dialog.getByRole("button", { name: "Add element" }).click();
  await first.click();
  await expect(dialog.locator(".spotpatch-target-item")).toHaveCount(2);

  await dialog.getByRole("button", { name: "Remove target 1" }).click();
  await expect(dialog.locator(".spotpatch-target-item")).toHaveCount(1);
  await expect(dialog.locator("textarea[data-target-instruction-id]")).toHaveValue(
    "Increase the Tailwind button horizontal padding.",
  );
});

test("restores a selection after closing and continues it on another page", async ({
  page,
}) => {
  await page.goto("/?page=a");
  await activatePicker(page);
  await page.getByTestId("business-card-content").click();
  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  const firstInstruction = dialog.locator(
    "textarea[data-target-instruction-id='target-1']",
  );
  const surface = page.locator("spotpatch-root").locator(".spotpatch-floating-surface");
  await firstInstruction.fill("Update the component selected on page A.");
  await expect(dialog.getByRole("button", { name: "Preview prompt" })).toBeEnabled();
  const initialSurfaceBox = await expectBoxWithinViewport(page, surface);

  await dialog.getByRole("button", { name: "Close SpotPatch" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Select element" }).click();
  await expect(firstInstruction).toHaveValue(
    "Update the component selected on page A.",
  );

  await page.goto("/?page=b");
  await expect(dialog).toBeVisible();
  await expect(firstInstruction).toHaveValue(
    "Update the component selected on page A.",
  );
  await expect(surface).toHaveAttribute("data-floating-positioned", "true");
  await expectEndAnchorToMatch(surface, initialSurfaceBox);
  const restoredSurfaceBox = await expectBoxWithinViewport(page, surface);

  await dialog.getByRole("button", { name: "Add element" }).click();
  await page.getByTestId("tailwind-button").click();
  await expectEndAnchorToMatch(surface, restoredSurfaceBox);
  const secondInstruction = dialog.locator(
    "textarea[data-target-instruction-id='target-2']",
  );
  await secondInstruction.fill("Update the component selected on page B.");
  await expect(dialog.locator(".spotpatch-target-item")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Preview prompt" }).click();

  const prompt = page
    .getByRole("dialog", { name: "Review the request" })
    .getByLabel("Generated prompt");
  await expect(prompt).toContainText("Update the component selected on page A.");
  await expect(prompt).toContainText("Update the component selected on page B.");
  await expect(prompt).toContainText("?page=a");
  await expect(prompt).toContainText("?page=b");
});

test("resolves an Ant Design Button to its stable business owner", async ({ page }) => {
  const browserErrors: string[] = [];

  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });

  await page.goto("/");
  await activatePicker(page);
  await page.getByRole("button", { name: "Open AntD modal" }).click();

  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  await expect(dialog).toBeVisible();
  const summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText("Source: src/main.tsx:");
  await expect(summary).toContainText(
    "Confidence: probable (probable owning component)",
  );
  await expect(summary).toContainText("Origin: react-fiber");
  await expect(summary).toContainText("Component: App");
  await expect(summary).toContainText(/Stack: .*App/);
  await expect(
    dialog.getByRole("button", { name: "Open source", exact: true }),
  ).toBeDisabled();
  expect(browserErrors).toEqual([]);
});

test("selects Ant Design portal content and traces it to the business component", async ({
  page,
}) => {
  const browserErrors: string[] = [];

  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open AntD modal" }).click();
  await expect(page.getByRole("dialog", { name: "AntD portal fixture" })).toBeVisible();

  await activatePicker(page);
  await page.getByText("AntD portal fixture").click();

  const dialog = page.getByRole("dialog", { name: "Plan the change" });
  await expect(dialog).toBeVisible();
  const summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText("Source: src/main.tsx:");
  await expect(summary).toContainText(
    "Confidence: probable (probable owning component)",
  );
  await expect(summary).toContainText("Origin: react-fiber");
  expect(browserErrors).toEqual([]);
});
