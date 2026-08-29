// @vitest-environment jsdom

import {
  EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  SPOTPATCH_ENDPOINTS,
  SPOTPATCH_TOKEN_HEADER,
  type ExternalAgentControlStatus,
  type SpotAnnotation,
} from "@spotpatch/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createExternalHandoffWorkflow } from "../controller/external-handoff-workflow.js";
import { registerExternalHandoffExtension } from "./external-handoff-contract.js";
import { createExternalHandoffPanel } from "./external-handoff-panel.js";
import { createRuntimeView } from "./runtime-view.js";

const EXTENSION_KEY = Symbol.for("spotpatch.external-handoff.v1");
const SESSION_ID = "runtime-session-id-0000";
const CURSOR = "0123456789abcdef012345";

function annotation(): SpotAnnotation {
  return Object.freeze({
    schemaVersion: 3,
    id: "external-panel-annotation",
    locale: "en-US",
    page: Object.freeze({
      url: "http://localhost/settings",
      pathname: "/settings",
      title: "Settings",
      viewportWidth: 1_280,
      viewportHeight: 720,
      devicePixelRatio: 1,
    }),
    targets: Object.freeze([
      Object.freeze({
        instruction: "Update the selected button.",
        source: Object.freeze({
          fileId: "button-source",
          relativePath: "src/Button.tsx",
          line: 10,
          column: 3,
          origin: "jsx-host",
          confidence: "exact",
        }),
        react: Object.freeze({
          supported: true,
          componentName: "Button",
          componentStack: Object.freeze(["Button"]),
        }),
        element: Object.freeze({
          tagName: "button",
          selector: "button",
          sanitizedHtml: "<button>Save</button>",
          rect: Object.freeze({ x: 0, y: 0, width: 100, height: 40 }),
        }),
        styles: Object.freeze({
          classNames: Object.freeze([]),
          matchedRules: Object.freeze([]),
          computed: Object.freeze({ display: "block" }),
          warnings: Object.freeze([]),
        }),
        code: Object.freeze({
          relativePath: "src/Button.tsx",
          language: "tsx",
          startLine: 8,
          endLine: 14,
          excerpt: "browser code must not be sent",
          boundary: "component",
        }),
        warnings: Object.freeze([]),
      }),
    ]),
    createdAt: "2026-08-23T00:00:00.000Z",
  });
}

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function capability() {
  return {
    enabled: true,
    brokerReady: true,
    activeWaitCount: 1,
    activeAdapter: null,
    dispatch: null,
    snapshotSchemaVersion: 1,
    brokerProtocolVersion: EXTERNAL_HANDOFF_BROKER_PROTOCOL_VERSION,
  } as const;
}

function summary(pickupCount = 0) {
  return {
    sessionId: SESSION_ID,
    framework: "vite",
    revision: 1,
    cursor: CURSOR,
    targetCount: 1,
    page: { origin: "http://localhost", pathname: "/settings" },
    publishedAt: "2026-08-23T00:00:00.000Z",
    expiresAt: "2026-08-23T00:15:00.000Z",
    state: "available",
    pickupCount,
    ...(pickupCount === 0 ? {} : { pickedUpAt: "2026-08-23T00:00:01.000Z" }),
  } as const;
}

function activeAdapter(state: "blocked" | "busy" | "ready") {
  return {
    kind: "claude-channel",
    state,
    canDispatch: state === "ready",
    connectedAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:01.000Z",
  } as const;
}

function dispatch(
  phase:
    | "completed"
    | "delivery-unknown"
    | "dispatching"
    | "dispatched"
    | "failed"
    | "queued"
    | "working",
) {
  return {
    adapterKind: "claude-channel",
    revision: 1,
    phase,
    updatedAt: "2026-08-23T00:00:02.000Z",
  } as const;
}

function managedControlStatus(
  sequence = 1,
  connectionState: ExternalAgentControlStatus["connectionState"] = "ready",
): ExternalAgentControlStatus {
  return Object.freeze({
    schemaVersion: 1,
    sequence,
    mode: "managed",
    adapter: Object.freeze({
      kind: "codex",
      maturity: "experimental",
      availability: "available",
    }),
    connectionState,
    authReadiness: "authenticated",
    grantState: "valid",
    effectiveModel: "gpt-5.6-codex",
    updatedAt: "2026-08-23T00:00:02.000Z",
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, EXTENSION_KEY);
  document.querySelectorAll("spotpatch-root").forEach((host) => {
    host.remove();
  });
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("external handoff Runtime extension", () => {
  it("renders only when registered and shows a keyboard-safe first-send disclosure", async () => {
    registerExternalHandoffExtension(
      Object.freeze({
        createPanel: createExternalHandoffPanel,
        createWorkflow: createExternalHandoffWorkflow,
      }),
    );
    const view = createRuntimeView(
      document,
      "Mod+Shift+S",
      Object.freeze({ enabled: false }),
      "en-US",
      false,
      true,
      "vite",
      SESSION_ID,
    );
    expect(view.externalHandoffPanel).toBeDefined();
    expect(view.externalHandoffPanel?.sendButton.hidden).toBe(true);
    expect(view.host.shadowRoot?.textContent).toContain("External Agent connection");
    expect(
      Array.from(
        view.host.shadowRoot?.querySelectorAll<HTMLElement>(
          ".spotpatch-external-command",
        ) ?? [],
        (command) => command.textContent,
      ),
    ).toEqual([]);
    expect(view.host.shadowRoot?.textContent).toContain("Connect Codex");
    view.renderStatus("selected");
    view.showSelection("Summary", true, true);
    expect(view.externalHandoffPanel?.sendButton.hidden).toBe(false);
    view.externalHandoffPanel?.renderCapability(capability());
    expect(view.externalHandoffPanel?.sendButton.disabled).toBe(false);

    const confirmation = view.externalHandoffPanel?.confirmDisclosure(annotation());
    const dialog = view.host.shadowRoot?.querySelector<HTMLElement>(
      ".spotpatch-external-disclosure-card",
    );
    const disclosureButtons = view.host.shadowRoot?.querySelectorAll<HTMLButtonElement>(
      ".spotpatch-external-disclosure-actions button",
    );
    const cancelButton = disclosureButtons?.item(0);
    const confirmButton = disclosureButtons?.item(1);
    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    expect(dialog?.textContent).toContain("src/Button.tsx");
    expect(dialog?.textContent).toContain("15-minute lifetime");
    confirmButton?.focus();
    confirmButton?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
    );
    expect(view.host.shadowRoot?.activeElement).toBe(cancelButton);
    cancelButton?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab", shiftKey: true }),
    );
    expect(view.host.shadowRoot?.activeElement).toBe(confirmButton);
    confirmButton?.click();
    await expect(confirmation).resolves.toBe(true);
    await expect(
      view.externalHandoffPanel?.confirmDisclosure(annotation()),
    ).resolves.toBe(true);
    expect(
      view.host.shadowRoot?.querySelector<HTMLElement>(".spotpatch-external-disclosure")
        ?.hidden,
    ).toBe(true);
    view.renderStatus("previewing");
    expect(view.externalHandoffPanel?.sendButton.hidden).toBe(true);
    view.dispose();
  });

  it("settles an open disclosure when the selection closes", async () => {
    const panel = createExternalHandoffPanel(
      document,
      "next",
      () => "en-US",
      `${SESSION_ID}-cancelled`,
      () => () => undefined,
      () => undefined,
    );
    document.body.append(panel.root, panel.sendButton);
    panel.setSelectionVisible(true);
    const confirmation = panel.confirmDisclosure(annotation());

    panel.setSelectionVisible(false);

    await expect(confirmation).resolves.toBe(false);
    expect(panel.sendButton.hidden).toBe(true);
    expect(
      panel.root.querySelector<HTMLElement>(".spotpatch-external-disclosure")?.hidden,
    ).toBe(true);
    panel.dispose();
    panel.root.remove();
    panel.sendButton.remove();
  });

  it("renders only evidenced active phases and requires explicit unknown recovery", () => {
    const panel = createExternalHandoffPanel(
      document,
      "next",
      () => "en-US",
      `${SESSION_ID}-active`,
      () => () => undefined,
      () => undefined,
    );
    document.body.append(panel.root, panel.sendButton);
    panel.setSelectionVisible(true);
    panel.setContextReady(true);
    panel.renderCapability({
      ...capability(),
      activeAdapter: activeAdapter("ready"),
    });
    expect(panel.root.textContent).toContain("connected and idle");
    expect(panel.sendButton.textContent).toBe("Send to Agent");
    expect(panel.sendButton.disabled).toBe(false);

    panel.renderPublishResult({
      handoff: summary(),
      delivery: {
        mode: "active",
        adapter: activeAdapter("busy"),
        dispatch: dispatch("queued"),
      },
      replayed: false,
    });
    expect(panel.root.textContent).toContain("reserved for Claude Code");
    expect(panel.sendButton.disabled).toBe(true);

    panel.renderStatus({
      handoff: summary(1),
      activeAdapter: activeAdapter("busy"),
      dispatch: dispatch("working"),
    });
    expect(panel.root.textContent).toContain("is working on revision 1");

    panel.renderStatus({
      handoff: summary(1),
      activeAdapter: activeAdapter("ready"),
      dispatch: dispatch("completed"),
    });
    expect(panel.root.textContent).toContain("does not prove");
    expect(panel.sendButton.disabled).toBe(false);

    panel.renderStatus({
      handoff: summary(1),
      activeAdapter: activeAdapter("blocked"),
      dispatch: dispatch("delivery-unknown"),
    });
    expect(panel.resolveButton.hidden).toBe(false);
    expect(panel.sendButton.disabled).toBe(true);

    panel.renderStatus({
      handoff: summary(1),
      activeAdapter: null,
      dispatch: dispatch("delivery-unknown"),
    });
    expect(panel.resolveButton.hidden).toBe(true);
    expect(panel.sendButton.textContent).toBe("Publish to Agent inbox");
    expect(panel.sendButton.disabled).toBe(false);
    expect(panel.root.textContent).toContain("workspace review was confirmed");
    panel.dispose();
    panel.root.remove();
    panel.sendButton.remove();
  });

  it("renders managed connection evidence and an audited result", () => {
    const panel = createExternalHandoffPanel(
      document,
      "next",
      () => "en-US",
      `${SESSION_ID}-managed`,
      () => () => undefined,
      () => undefined,
    );
    document.body.append(panel.root, panel.sendButton);
    panel.setSelectionVisible(true);
    panel.renderControlStatus(managedControlStatus());

    expect(panel.root.textContent).toContain("Connection: ready");
    expect(panel.root.textContent).toContain("Model: gpt-5.6-codex");
    expect(panel.connectButton.disabled).toBe(true);
    expect(panel.disconnectButton.disabled).toBe(false);
    expect(panel.revokeButton.disabled).toBe(false);

    panel.renderControlStatus({
      ...managedControlStatus(2, "degraded"),
      authReadiness: "signed-out",
      error: {
        code: "AGENT_AUTH_REQUIRED",
        stage: "auth",
        recoverability: "user-action",
        action: "sign-in",
      },
    });
    expect(panel.root.textContent).toContain("Codex requires an authenticated account");
    expect(panel.root.textContent).toContain("Sign in with Codex, then retry");

    panel.renderManagedResult({
      revision: 4,
      diff: "diff --git a/src/Button.tsx b/src/Button.tsx",
      files: [{ path: "src/Button.tsx", additions: 2, deletions: 1 }],
      checks: [{ id: "typecheck", outcome: "passed", durationMs: 42, exitCode: 0 }],
      timings: { total: 900 },
      validationOutcome: "passed",
      expiresAt: "2026-08-23T00:15:00.000Z",
    });

    expect(panel.root.textContent).toContain("Revision 4 · Validation passed");
    expect(panel.root.textContent).toContain("Applied to the project");
    expect(panel.root.textContent).toContain("src/Button.tsx +2 -1");
    expect(panel.root.textContent).toContain("Timing total: 900 ms");
    expect(panel.root.textContent).toContain("diff --git");

    panel.renderManagedResult({
      revision: 5,
      diff: "diff --git a/src/Button.tsx b/src/Button.tsx",
      files: [{ path: "src/Button.tsx", additions: 1, deletions: 1 }],
      checks: [],
      timings: { total: 500 },
      validationOutcome: "not-configured",
      expiresAt: "2026-08-23T00:15:00.000Z",
    });
    expect(panel.root.textContent).toContain(
      "Candidate only; it was not applied because validation is not-configured.",
    );
    panel.dispose();
    panel.root.remove();
    panel.sendButton.remove();
  });

  it("explains the out-of-browser consent step in both supported locales", () => {
    const awaitingConsent: ExternalAgentControlStatus = Object.freeze({
      schemaVersion: 1,
      sequence: 1,
      mode: "inbox",
      adapter: Object.freeze({
        kind: "codex",
        maturity: "experimental",
        availability: "unavailable",
      }),
      connectionState: "awaiting-consent",
      authReadiness: "unknown",
      grantState: "missing",
      updatedAt: "2026-08-23T00:00:02.000Z",
    });

    for (const [locale, expected] of [
      ["en-US", 'type "yes" in the terminal that started `pnpm dev`'],
      ["zh-CN", "请在启动 `pnpm dev` 的终端输入“yes”"],
    ] as const) {
      const panel = createExternalHandoffPanel(
        document,
        "vite",
        () => locale,
        `${SESSION_ID}-${locale}`,
        () => () => undefined,
        () => undefined,
      );
      document.body.append(panel.root, panel.sendButton);
      panel.renderControlStatus(awaitingConsent);

      expect(panel.root.textContent).toContain(expected);
      panel.dispose();
      panel.root.remove();
      panel.sendButton.remove();
    }
  });

  it("recovers capability probing when selection cleanup cancels the first request", async () => {
    let capabilityRequests = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const endpoint =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (endpoint !== SPOTPATCH_ENDPOINTS.externalHandoffCapability) {
        return new Response(null, { status: 404 });
      }
      capabilityRequests += 1;

      if (capabilityRequests === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
      }

      return envelope(capability());
    });
    const panel = createExternalHandoffPanel(
      document,
      "vite",
      () => "en-US",
      `${SESSION_ID}-retry`,
      () => () => undefined,
      () => undefined,
    );
    document.body.append(panel.root, panel.sendButton);
    panel.setSelectionVisible(true);
    panel.setContextReady(true);
    const workflow = createExternalHandoffWorkflow(
      fetchMock,
      panel,
      annotation,
      "runtime-session-token",
      window,
    );

    workflow.mount();
    workflow.cancelPending();

    await vi.waitFor(() => {
      expect(capabilityRequests).toBe(2);
    });
    await vi.waitFor(() => {
      expect(panel.sendButton.disabled).toBe(false);
    });
    workflow.dispose();
    panel.dispose();
    panel.root.remove();
    panel.sendButton.remove();
  });

  it("uses fixed managed profiles for page connect, disconnect, and revoke actions", async () => {
    const controlBodies: unknown[] = [];
    let control: ExternalAgentControlStatus = {
      ...managedControlStatus(1, "disconnected"),
      mode: "inbox" as const,
    };
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const endpoint =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (endpoint === SPOTPATCH_ENDPOINTS.externalHandoffCapability) {
        return Promise.resolve(envelope(capability()));
      }
      if (endpoint === SPOTPATCH_ENDPOINTS.externalAgentControlStatus) {
        return Promise.resolve(envelope(control));
      }
      if (endpoint === SPOTPATCH_ENDPOINTS.externalAgentEvents) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
      }
      if (
        endpoint === SPOTPATCH_ENDPOINTS.externalAgentControlConnect ||
        endpoint === SPOTPATCH_ENDPOINTS.externalAgentControlDisconnect
      ) {
        if (typeof init?.body !== "string") {
          return Promise.reject(new Error("Expected a JSON body."));
        }
        const body = JSON.parse(init.body) as Record<string, unknown>;
        controlBodies.push(body);
        control =
          endpoint === SPOTPATCH_ENDPOINTS.externalAgentControlConnect
            ? { ...managedControlStatus(control.sequence + 1, "ready") }
            : {
                ...managedControlStatus(control.sequence + 1, "disconnected"),
                mode: "inbox" as const,
                grantState: body.revokeGrant === true ? ("missing" as const) : "valid",
              };
        return Promise.resolve(envelope(control));
      }
      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });
    const panel = createExternalHandoffPanel(
      document,
      "vite",
      () => "en-US",
      `${SESSION_ID}-managed-actions`,
      () => () => undefined,
      () => undefined,
    );
    const workflow = createExternalHandoffWorkflow(
      fetchMock,
      panel,
      annotation,
      "runtime-session-token",
      window,
    );
    document.body.append(panel.root, panel.sendButton);
    panel.setSelectionVisible(true);
    workflow.mount();

    await vi.waitFor(() => {
      expect(panel.connectButton.disabled).toBe(false);
    });
    panel.connectButton.click();
    await vi.waitFor(() => {
      expect(panel.disconnectButton.disabled).toBe(false);
    });
    panel.disconnectButton.click();
    await vi.waitFor(() => {
      expect(panel.connectButton.disabled).toBe(false);
    });
    panel.connectButton.click();
    await vi.waitFor(() => {
      expect(panel.revokeButton.disabled).toBe(false);
    });
    panel.revokeButton.click();
    await vi.waitFor(() => {
      expect(panel.connectButton.disabled).toBe(false);
    });

    expect(controlBodies).toHaveLength(4);
    expect(controlBodies[0]).toMatchObject({
      adapterKind: "codex",
      profile: "managed-apply-v1",
    });
    expect(controlBodies[1]).toMatchObject({
      adapterKind: "codex",
      revokeGrant: false,
    });
    expect(controlBodies[3]).toMatchObject({
      adapterKind: "codex",
      revokeGrant: true,
    });
    expect(JSON.stringify(controlBodies)).toMatch(/"requestId":"[a-f0-9]{48}"/u);
    workflow.dispose();
    panel.dispose();
    panel.root.remove();
    panel.sendButton.remove();
  });

  it("publishes without browser code and reports only evidenced pickup state", async () => {
    let publishBody: unknown;
    let statusRequests = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.headers).toMatchObject({
        [SPOTPATCH_TOKEN_HEADER]: "runtime-session-token",
      });
      const endpoint =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (endpoint === SPOTPATCH_ENDPOINTS.externalHandoffCapability) {
        return envelope(capability());
      }

      if (endpoint === SPOTPATCH_ENDPOINTS.externalHandoffPublish) {
        if (typeof init?.body !== "string") throw new Error("Expected JSON body.");
        publishBody = JSON.parse(init.body) as unknown;
        return envelope(
          {
            handoff: summary(),
            delivery: { mode: "inbox" },
            replayed: false,
          },
          201,
        );
      }

      if (endpoint === SPOTPATCH_ENDPOINTS.externalHandoffStatus) {
        statusRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return envelope({
          handoff: summary(1),
          activeAdapter: null,
          dispatch: null,
        });
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });
    const panel = createExternalHandoffPanel(
      document,
      "vite",
      () => "en-US",
      SESSION_ID,
      () => () => undefined,
      () => undefined,
    );
    document.body.append(panel.root, panel.sendButton);
    panel.setSelectionVisible(true);
    panel.setContextReady(true);
    const workflow = createExternalHandoffWorkflow(
      fetchMock,
      panel,
      annotation,
      "runtime-session-token",
      window,
    );
    workflow.mount();
    await vi.waitFor(() => {
      expect(panel.sendButton.disabled).toBe(false);
    });
    expect(panel.root.textContent).toContain("1 active connector wait request");

    panel.sendButton.click();
    panel.root
      .querySelector<HTMLButtonElement>(
        ".spotpatch-external-disclosure-actions .spotpatch-primary",
      )
      ?.click();
    await vi.waitFor(() => {
      expect(panel.root.textContent).toContain("Revision 1");
    });
    const serializedPublishBody = JSON.stringify(publishBody);
    expect(serializedPublishBody).not.toContain("browser code must not be sent");
    expect(serializedPublishBody).not.toContain('"code"');
    expect(serializedPublishBody).toMatch(/"requestId":"[a-f0-9]{48}"/u);
    expect(panel.root.textContent).toContain("not been claimed as edited");

    panel.refreshButton.click();
    panel.refreshButton.click();
    expect(panel.refreshButton.disabled).toBe(true);
    await vi.waitFor(() => {
      expect(panel.root.textContent).toContain("picked up by 1");
    });
    expect(statusRequests).toBe(1);
    expect(panel.root.textContent).toContain("does not prove a code change");
    workflow.dispose();
    panel.dispose();
    panel.root.remove();
    panel.sendButton.remove();
  });

  it("retries an ambiguous publish with the exact same request id and payload", async () => {
    const publishBodies: string[] = [];
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const endpoint =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (endpoint === SPOTPATCH_ENDPOINTS.externalHandoffCapability) {
        return Promise.resolve(envelope(capability()));
      }
      if (endpoint === SPOTPATCH_ENDPOINTS.externalHandoffPublish) {
        if (typeof init?.body !== "string") {
          return Promise.reject(new Error("Expected JSON body."));
        }
        publishBodies.push(init.body);
        if (publishBodies.length === 1) {
          return Promise.reject(new TypeError("Connection reset"));
        }
        return Promise.resolve(
          envelope({
            handoff: summary(),
            delivery: { mode: "inbox" },
            replayed: true,
          }),
        );
      }
      if (endpoint === SPOTPATCH_ENDPOINTS.externalHandoffStatus) {
        return Promise.resolve(
          envelope({
            handoff: summary(),
            activeAdapter: null,
            dispatch: null,
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });
    const panel = createExternalHandoffPanel(
      document,
      "vite",
      () => "en-US",
      `${SESSION_ID}-idempotent`,
      () => () => undefined,
      () => undefined,
    );
    document.body.append(panel.root, panel.sendButton);
    panel.setSelectionVisible(true);
    panel.setContextReady(true);
    const workflow = createExternalHandoffWorkflow(
      fetchMock,
      panel,
      annotation,
      "runtime-session-token",
      window,
    );
    workflow.mount();
    await vi.waitFor(() => {
      expect(panel.sendButton.disabled).toBe(false);
    });

    panel.sendButton.click();
    panel.root
      .querySelector<HTMLButtonElement>(
        ".spotpatch-external-disclosure-actions .spotpatch-primary",
      )
      ?.click();
    await vi.waitFor(() => {
      expect(panel.sendButton.textContent).toBe("Retry same send");
    });
    panel.sendButton.click();
    await vi.waitFor(() => {
      expect(panel.root.textContent).toContain("Revision 1");
    });
    expect(publishBodies).toHaveLength(2);
    expect(publishBodies[1]).toBe(publishBodies[0]);
    workflow.dispose();
    panel.dispose();
    panel.root.remove();
    panel.sendButton.remove();
  });
});
