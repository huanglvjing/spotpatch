import { expect, test, type Page } from "@playwright/test";

const activatePicker = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Select element" }).click();
  await expect(page.getByRole("button", { name: "Stop selecting" })).toBeVisible();
};

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
      body: JSON.stringify({ ok: true, data: {} }),
    });
  });

  await page.goto("/");
  await activatePicker(page);

  await page.getByRole("heading", { name: "SpotPatch Playground" }).click();

  const dialog = page.getByRole("dialog", { name: "Selected element" });
  await expect(dialog).toBeVisible();
  const summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText(/src\/main\.tsx:\d+:\d+/);
  await expect(summary).toContainText("Confidence: exact (精确元素源码)");
  await expect(summary).toContainText("Component: App");

  await dialog.getByRole("button", { name: "Open in VS Code" }).click();
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
  await page.getByRole("heading", { name: "SpotPatch Playground" }).click();

  const selectedDialog = page.getByRole("dialog", { name: "Selected element" });
  await expect(selectedDialog).toBeVisible();
  await expect(selectedDialog.locator(".spotpatch-summary")).toContainText(
    "Boundary: component",
  );
  await selectedDialog.getByRole("button", { name: "Add note" }).click();

  const annotationDialog = page.getByRole("dialog", {
    name: "Describe the issue",
  });
  await annotationDialog
    .getByRole("textbox", { name: "What should change?" })
    .fill("Align the playground heading with its description.");
  await annotationDialog.getByRole("button", { name: "Save note" }).click();

  await expect(selectedDialog).toBeVisible();
  const previewButton = selectedDialog.getByRole("button", {
    name: "Preview prompt",
  });
  await expect(previewButton).toBeEnabled();
  await previewButton.click();

  const previewDialog = page.getByRole("dialog", { name: "Prompt preview" });
  const promptOutput = previewDialog.getByLabel("Generated prompt");
  await expect(promptOutput).toContainText("## 问题");
  await expect(promptOutput).toContainText(
    "Align the playground heading with its description.",
  );
  await expect(promptOutput).toContainText("## 相关样式");
  await expect(promptOutput).toContainText(".user-info h1");
  await expect(promptOutput).toContainText("## 附近代码");
  await expect(promptOutput).toContainText("- Boundary: component");

  const expectedPrompt = await promptOutput.textContent();
  await previewDialog.getByRole("button", { name: "Copy prompt" }).click();
  await expect(selectedDialog).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(expectedPrompt);
});

test("resolves an Ant Design Button to its probable business call site", async ({
  page,
}) => {
  const browserErrors: string[] = [];

  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });

  await page.goto("/");
  await activatePicker(page);
  await page.getByRole("button", { name: "Open AntD modal" }).click();

  const dialog = page.getByRole("dialog", { name: "Selected element" });
  await expect(dialog).toBeVisible();
  const summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText("Source: src/main.tsx:");
  await expect(summary).toContainText("Confidence: probable (可能的所属组件)");
  await expect(summary).toContainText("Origin: react-fiber");
  await expect(summary).toContainText("Component: Button");
  await expect(summary).toContainText(/Stack: .*App/);
  await expect(dialog.getByRole("button", { name: "Open in VS Code" })).toBeDisabled();
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

  const dialog = page.getByRole("dialog", { name: "Selected element" });
  await expect(dialog).toBeVisible();
  const summary = dialog.locator(".spotpatch-summary");
  await expect(summary).toContainText("Source: src/main.tsx:");
  await expect(summary).toContainText("Confidence: probable (可能的所属组件)");
  await expect(summary).toContainText("Origin: react-fiber");
  expect(browserErrors).toEqual([]);
});
