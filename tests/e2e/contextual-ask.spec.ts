import { expect, test, type Page, type Route } from "@playwright/test";

type ExecutorKind = "configured-key" | "managed-codex";

function createExecutor(kind: ExecutorKind) {
  return kind === "configured-key"
    ? {
        executorId: "configured-key-relay-coder",
        kind,
        label: "E2E Relay",
        modelLabel: "E2E Coding Model",
      }
    : {
        executorId: "ask_managed_codex_v1",
        kind,
        label: "Managed Codex",
        modelLabel: "E2E Managed Model",
      };
}

async function installAskRoutes(
  page: Page,
  options: Readonly<{
    executorKind?: ExecutorKind;
    includeAlternateExecutor?: boolean;
    onCreate?: (targetCount: number) => void;
  }> = {},
): Promise<void> {
  const executor = createExecutor(options.executorKind ?? "configured-key");
  const alternateExecutor = createExecutor(
    executor.kind === "configured-key" ? "managed-codex" : "configured-key",
  );
  let selectionId = "selection_pending";
  await page.route("**/__spotpatch/v1/ask/**", async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const timestamp = "2026-09-02T02:00:00.000Z";
    const snapshot = (status: "queued" | "answered") => ({
      schemaVersion: 1,
      jobId: "ask_job_e2e",
      selectionId,
      status,
      executor,
      createdAt: timestamp,
      updatedAt: status === "queued" ? timestamp : "2026-09-02T02:00:02.000Z",
      canCancel: status === "queued",
    });

    if (pathname.endsWith("/ask/capability")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            schemaVersion: 1,
            enabled: true,
            executors: [
              {
                executorId: executor.executorId,
                kind: executor.kind,
                label: executor.label,
                requestedModelLabel: executor.modelLabel,
                effectiveModelLabel: executor.modelLabel,
                state: "ready",
                providerDataConsentRequired: true,
                readOnlyProven: true,
              },
              ...(options.includeAlternateExecutor
                ? [
                    {
                      executorId: alternateExecutor.executorId,
                      kind: alternateExecutor.kind,
                      label: alternateExecutor.label,
                      requestedModelLabel: alternateExecutor.modelLabel,
                      effectiveModelLabel: alternateExecutor.modelLabel,
                      state: "ready",
                      providerDataConsentRequired: true,
                      readOnlyProven: true,
                    },
                  ]
                : []),
            ],
            safety: {
              selectionRequired: true,
              singleTurn: true,
              writesAllowed: false,
              historyStored: false,
            },
            checkedAt: timestamp,
          },
        }),
      });
      return;
    }

    if (pathname.endsWith("/ask/jobs")) {
      const body = request.postDataJSON() as {
        envelope: { selection: { selectionId: string; targets: unknown[] } };
      };
      selectionId = body.envelope.selection.selectionId;
      options.onCreate?.(body.envelope.selection.targets.length);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: snapshot("queued") }),
      });
      return;
    }

    if (pathname.endsWith("/events")) {
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: `${JSON.stringify({
          schemaVersion: 1,
          sequence: 1,
          jobId: "ask_job_e2e",
          status: "running",
          timestamp: "2026-09-02T02:00:01.000Z",
          type: "read-activity",
          activity: {
            kind: "source",
            sourceId: "source_e2e",
            relativePath: "src/App.tsx",
          },
          state: "started",
        })}\n${JSON.stringify({
          schemaVersion: 1,
          sequence: 2,
          jobId: "ask_job_e2e",
          status: "answered",
          timestamp: "2026-09-02T02:00:02.000Z",
          type: "answer-ready",
        })}\n`,
      });
      return;
    }

    if (pathname.endsWith("/result")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            snapshot: snapshot("answered"),
            result: {
              schemaVersion: 1,
              jobId: "ask_job_e2e",
              selectionId,
              contextHash: "a".repeat(64),
              executor,
              blocks: [
                {
                  kind: "paragraph",
                  text: "This heading introduces the SpotPatch playground and anchors the page hierarchy.",
                  sourceIds: ["source_e2e"],
                },
                {
                  kind: "code",
                  code: "<h1>SpotPatch Playground</h1>",
                  language: "tsx",
                  sourceIds: ["source_e2e"],
                },
              ],
              sources: [
                {
                  sourceId: "source_e2e",
                  label: "Playground heading",
                  relativePath: "src/App.tsx",
                  fileId: "file_app",
                  startLine: 25,
                  endLine: 29,
                  confidence: "exact",
                  targetIds: ["target-1"],
                  contentHash: "b".repeat(64),
                },
              ],
              warnings: [],
              createdAt: "2026-09-02T02:00:02.000Z",
              expiresAt: "2026-09-02T02:05:02.000Z",
            },
          },
        }),
      });
      return;
    }

    await route.fallback();
  });
}

test("loads Contextual Ask capability through a real same-origin browser GET", async ({
  page,
}) => {
  const capabilityResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/ask/capability") &&
      response.request().method() === "GET",
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Select element" }).click();
  await page.getByRole("heading", { name: "SpotPatch Playground" }).click();
  const dialog = page.locator("spotpatch-root").getByRole("dialog");
  await dialog.getByRole("tab", { name: "Ask" }).click();

  const response = await capabilityResponse;
  expect(response.status()).toBe(200);
  const capability = (await response.json()) as {
    data: {
      executors: {
        effectiveModelLabel: string;
        kind: string;
        label: string;
        readOnlyProven: boolean;
        state: string;
      }[];
    };
    ok: boolean;
  };
  expect(capability.ok).toBe(true);
  expect(
    capability.data.executors.some((candidate) => candidate.kind === "managed-codex"),
  ).toBe(true);
  const executor = dialog.getByRole("combobox", {
    name: "Read-only executor",
    exact: true,
  });
  const readyExecutors = capability.data.executors.filter(
    (candidate) => candidate.state === "ready" && candidate.readOnlyProven,
  );
  if (readyExecutors.length === 0) {
    await expect(executor).toContainText("No verified read-only executor");
    await expect(dialog.locator(".spotpatch-ask-executor-status")).toContainText(
      "Managed Codex",
    );
  } else {
    await expect(executor).toContainText(readyExecutors[0]?.label ?? "");
  }
  if (readyExecutors.length <= 1) await expect(executor).toBeDisabled();
});

for (const executorKind of ["configured-key", "managed-codex"] as const) {
  test(`${executorKind} answers in the persistent Planner, opens sources, and converts without writing`, async ({
    page,
  }) => {
    await installAskRoutes(page, { executorKind });
    let editorRequests = 0;
    await page.route("**/__spotpatch/v1/open-editor", async (route) => {
      editorRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { editor: "auto" } }),
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Select element" }).click();
    await page.getByRole("heading", { name: "SpotPatch Playground" }).click();

    const dialog = page.locator("spotpatch-root").getByRole("dialog");
    const instruction = dialog.locator("textarea[data-target-instruction-id]");
    await instruction.fill("Keep this independent Change draft.");
    const mode = dialog.getByRole("tablist", { name: "Task mode" });
    await mode.getByRole("tab", { name: "Ask" }).click();
    const question = dialog.getByRole("textbox", { name: "Question", exact: true });
    await expect(question).toBeFocused();
    await expect(mode).toBeInViewport();
    await expect(
      dialog.getByRole("heading", {
        name: "Ask about this selection",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      dialog
        .locator(".spotpatch-ask-actions")
        .getByRole("button", { name: "Start over" }),
    ).toBeHidden();
    await question.fill("What does this heading do?");
    await dialog
      .getByText("Allow the selected source snapshot", { exact: false })
      .click();
    const submit = dialog.getByRole("button", { name: "Ask", exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(dialog.getByRole("heading", { name: "Answer" })).toBeVisible();
    await expect(dialog).toContainText("anchors the page hierarchy");
    await expect(dialog.locator("code")).toHaveText("<h1>SpotPatch Playground</h1>");
    await expect(dialog.locator("script")).toHaveCount(0);
    const answer = dialog.locator(".spotpatch-ask-answer");
    await answer.scrollIntoViewIfNeeded();
    if (executorKind === "configured-key" && process.platform === "darwin") {
      await expect(answer).toHaveScreenshot("contextual-ask-answer.png", {
        animations: "disabled",
      });
    }

    await dialog.getByRole("button", { name: "src/App.tsx:25–29" }).first().click();
    await expect.poll(() => editorRequests).toBe(1);
    await dialog.getByRole("button", { name: "Turn into change request" }).click();
    await expect(mode.getByRole("tab", { name: "Change" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(instruction).toHaveValue("Keep this independent Change draft.");
    await expect(dialog).toContainText("From contextual answer");
  });
}

for (const executorKind of ["configured-key", "managed-codex"] as const) {
  test(`${executorKind} submits an immutable multi-target relationship question`, async ({
    page,
  }) => {
    let submittedTargetCount = 0;
    await installAskRoutes(page, {
      executorKind,
      onCreate: (targetCount) => {
        submittedTargetCount = targetCount;
      },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Select element" }).click();
    await page.getByRole("heading", { name: "SpotPatch Playground" }).click();
    let dialog = page.locator("spotpatch-root").getByRole("dialog");
    await dialog.getByRole("button", { name: "Add element" }).click();
    await page.getByTestId("business-card").click();
    dialog = page.locator("spotpatch-root").getByRole("dialog");
    await dialog.getByRole("tab", { name: "Ask" }).click();
    await dialog
      .getByRole("textbox", { name: "Question", exact: true })
      .fill("How do these two components relate?");
    await dialog
      .getByText("Allow the selected source snapshot", { exact: false })
      .click();
    await dialog.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Answer" })).toBeVisible();
    expect(submittedTargetCount).toBe(2);
  });
}

test("keeps the custom executor menu in flow below its field", async ({ page }) => {
  await installAskRoutes(page, { includeAlternateExecutor: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Select element" }).click();
  await page.getByRole("heading", { name: "SpotPatch Playground" }).click();
  const dialog = page.locator("spotpatch-root").getByRole("dialog");
  await dialog.getByRole("tab", { name: "Ask" }).click();

  const trigger = dialog.getByRole("combobox", {
    name: "Read-only executor",
    exact: true,
  });
  const menu = dialog.locator(".spotpatch-ask-executor-menu");
  const safety = dialog.locator(".spotpatch-ask-safety");
  await trigger.click();
  await expect(menu).toBeVisible();

  const [triggerBox, menuBox, safetyBox] = await Promise.all([
    trigger.boundingBox(),
    menu.boundingBox(),
    safety.boundingBox(),
  ]);
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(safetyBox).not.toBeNull();
  if (triggerBox !== null && menuBox !== null && safetyBox !== null) {
    expect(menuBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
    expect(menuBox.x).toBeGreaterThanOrEqual(triggerBox.x);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(
      triggerBox.x + triggerBox.width,
    );
    expect(safetyBox.y).toBeGreaterThanOrEqual(menuBox.y + menuBox.height);
  }
});

test("retains accessible controls without horizontal overflow at 320px", async ({
  page,
}) => {
  await installAskRoutes(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "Select element" }).click();
  await page.getByRole("heading", { name: "SpotPatch Playground" }).click();
  const dialog = page.locator("spotpatch-root").getByRole("dialog");
  await dialog.getByRole("tab", { name: "Ask" }).click();

  await expect(
    dialog.getByRole("textbox", { name: "Question", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Read-only executor", exact: true }),
  ).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
  const hasOverflow = await dialog.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  );
  expect(hasOverflow).toBe(false);

  const browserSession = await page.context().newCDPSession(page);
  await browserSession.send("Emulation.setPageScaleFactor", {
    pageScaleFactor: 2,
  });
  await expect
    .poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1))
    .toBe(2);
  await expect(
    dialog.getByRole("textbox", { name: "Question", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Read-only executor", exact: true }),
  ).toBeVisible();
});
