import { describe, expect, it } from "vitest";

import {
  MAX_ANNOTATION_INSTRUCTION_CHARACTERS,
  MAX_ANNOTATION_TARGETS,
  MAX_TARGET_INSTRUCTION_CHARACTERS,
} from "../model/annotation.js";
import {
  agentCapabilityRequestSchema,
  agentJobCreateRequestSchema,
  openEditorRequestSchema,
  runtimeBootstrapRequestSchema,
  sourceContextRequestSchema,
} from "./requests.js";

const annotation = Object.freeze({
  schemaVersion: 3,
  id: "annotation-id",
  locale: "en-US",
  page: Object.freeze({
    url: "http://localhost:5173/",
    pathname: "/",
    title: "Fixture",
    viewportWidth: 1_440,
    viewportHeight: 900,
    devicePixelRatio: 2,
  }),
  targets: Object.freeze([
    Object.freeze({
      instruction: "Align the selected action.",
      source: Object.freeze({
        fileId: "file-id",
        relativePath: "src/App.tsx",
        line: 12,
        column: 5,
        origin: "jsx-host",
        confidence: "exact",
      }),
      react: Object.freeze({
        supported: true,
        version: "18.3.1",
        componentName: "App",
        componentStack: Object.freeze(["App"]),
      }),
      element: Object.freeze({
        tagName: "button",
        selector: "button.primary",
        sanitizedHtml: '<button class="primary">Save</button>',
        textPreview: "Save",
        rect: Object.freeze({ x: 10, y: 20, width: 100, height: 40 }),
      }),
      styles: Object.freeze({
        classNames: Object.freeze(["primary"]),
        matchedRules: Object.freeze([]),
        computed: Object.freeze({ display: "block" }),
        warnings: Object.freeze([]),
      }),
      warnings: Object.freeze([]),
    }),
  ]),
  createdAt: "2026-08-07T00:00:00.000Z",
});

describe("protocol request schemas", () => {
  it("accepts only an empty bootstrap request", () => {
    expect(runtimeBootstrapRequestSchema.safeParse({}).success).toBe(true);
    expect(
      runtimeBootstrapRequestSchema.safeParse({ root: "/private/project" }).success,
    ).toBe(false);
  });

  it("accepts source identifiers and positive coordinates", () => {
    expect(
      sourceContextRequestSchema.safeParse({
        fileId: "Q7k3pA9vL2s",
        line: 36,
        column: 5,
        maxLines: 80,
      }).success,
    ).toBe(true);
  });

  it("rejects path and command fields", () => {
    expect(
      openEditorRequestSchema.safeParse({
        fileId: "Q7k3pA9vL2s",
        line: 36,
        column: 5,
        absolutePath: "/tmp/private.tsx",
        command: "code",
      }).success,
    ).toBe(false);
  });

  it("accepts a bounded annotation and allowlisted profile identifiers", () => {
    expect(
      agentJobCreateRequestSchema.safeParse({
        annotation,
        providerProfileId: "relay",
        modelProfileId: "coding-model",
        providerDataConsent: true,
        workingTreeMode: "include-local-changes",
      }).success,
    ).toBe(true);
    expect(
      agentCapabilityRequestSchema.safeParse({
        providerProfileId: "relay",
        modelProfileId: "coding-model",
      }).success,
    ).toBe(true);
  });

  it("defaults to clean execution and rejects unknown working-tree modes", () => {
    const parsed = agentJobCreateRequestSchema.parse({
      annotation,
      providerProfileId: "relay",
      modelProfileId: "coding-model",
      providerDataConsent: true,
    });
    expect(parsed.workingTreeMode).toBe("require-clean");
    expect(
      agentJobCreateRequestSchema.safeParse({
        ...parsed,
        workingTreeMode: "overwrite-local-changes",
      }).success,
    ).toBe(false);
  });

  it("rejects injected execution configuration and oversized annotation fields", () => {
    expect(
      agentJobCreateRequestSchema.safeParse({
        annotation,
        providerProfileId: "relay",
        modelProfileId: "coding-model",
        providerDataConsent: true,
        baseURL: "https://attacker.example/v1",
        command: "rm",
        applyMode: "auto",
      }).success,
    ).toBe(false);
    expect(
      agentJobCreateRequestSchema.safeParse({
        annotation: {
          ...annotation,
          targets: [
            {
              ...annotation.targets[0],
              instruction: "x".repeat(MAX_TARGET_INSTRUCTION_CHARACTERS + 1),
            },
          ],
        },
        providerProfileId: "relay",
        modelProfileId: "coding-model",
        providerDataConsent: true,
      }).success,
    ).toBe(false);

    const target = annotation.targets[0];

    if (target === undefined) {
      throw new Error("Expected an annotation target fixture.");
    }

    expect(
      agentJobCreateRequestSchema.safeParse({
        annotation: {
          ...annotation,
          targets: [
            { ...target, instruction: "a".repeat(2_000) },
            { ...target, instruction: "b".repeat(2_000) },
            {
              ...target,
              instruction: "c".repeat(MAX_ANNOTATION_INSTRUCTION_CHARACTERS - 3_999),
            },
          ],
        },
        providerProfileId: "relay",
        modelProfileId: "coding-model",
        providerDataConsent: true,
      }).success,
    ).toBe(false);
  });

  it("requires explicit provider data consent for every job request", () => {
    expect(
      agentJobCreateRequestSchema.safeParse({
        annotation,
        providerProfileId: "relay",
        modelProfileId: "coding-model",
      }).success,
    ).toBe(false);
  });

  it("requires one target and enforces the protocol hard limit", () => {
    const target = annotation.targets[0];

    if (target === undefined) {
      throw new Error("Expected an annotation target fixture.");
    }

    expect(
      agentJobCreateRequestSchema.safeParse({
        annotation: { ...annotation, targets: [] },
        providerProfileId: "relay",
        modelProfileId: "coding-model",
        providerDataConsent: true,
      }).success,
    ).toBe(false);
    expect(
      agentJobCreateRequestSchema.safeParse({
        annotation: {
          ...annotation,
          targets: Array.from({ length: MAX_ANNOTATION_TARGETS + 1 }, () => target),
        },
        providerProfileId: "relay",
        modelProfileId: "coding-model",
        providerDataConsent: true,
      }).success,
    ).toBe(false);
  });
});
