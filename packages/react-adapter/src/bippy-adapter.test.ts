// @vitest-environment jsdom

import type { ReactContext } from "@spotpatch/shared";
import { describe, expect, it, vi } from "vitest";

import { createReact18Adapter } from "./bippy-adapter.js";
import type { FiberBridge, FiberSourceLocation } from "./fiber/fiber-bridge.js";

interface FakeNode {
  readonly composite: boolean;
  readonly componentType?: object;
  readonly name?: string;
  readonly source?: FiberSourceLocation;
}

function createBridge(
  version: string | undefined,
  nodes: readonly FakeNode[],
): FiberBridge {
  return {
    find: () => ({
      node: nodes[0] ?? {},
      ...(version === undefined ? {} : { version }),
    }),
    getAncestors: () => nodes,
    getDisplayName: (node) => (node as FakeNode).name,
    getComponentType: (node) => (node as FakeNode).componentType,
    getSource: (node) => (node as FakeNode).source,
    isComposite: (node) => (node as FakeNode).composite,
  };
}

function inspect(
  version: string | undefined,
  nodes: readonly FakeNode[],
  maxComponentDepth = 8,
): ReactContext {
  return createReact18Adapter({
    bridge: createBridge(version, nodes),
    maxComponentDepth,
  }).inspect(document.createElement("button"));
}

describe("React 18 Bippy adapter", () => {
  it("selects the first business component after third-party composites", () => {
    const context = inspect("18.3.1", [
      { composite: false, name: "button" },
      {
        composite: true,
        name: "AntButton",
        source: {
          fileName: "/project/node_modules/antd/es/button.js",
          line: 80,
        },
      },
      {
        composite: true,
        name: "UserActions",
        source: {
          fileName: "/Users/person/project/src/UserActions.tsx",
          line: 36,
          column: 5,
        },
      },
      {
        composite: true,
        name: "App",
        source: { fileName: "/Users/person/project/src/App.tsx", line: 12 },
      },
    ]);

    expect(context).toEqual({
      supported: true,
      version: "18.3.1",
      componentName: "UserActions",
      componentStack: ["AntButton", "UserActions", "App"],
      source: {
        relativePath: "src/UserActions.tsx",
        line: 36,
        column: 5,
        origin: "react-fiber",
        confidence: "probable",
      },
    });
    expect(JSON.stringify(context)).not.toContain("/Users/person");
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("filters noise and obeys the component depth budget", () => {
    const context = inspect(
      "18.2.0",
      [
        { composite: true, name: "Fragment" },
        { composite: true, name: "StrictMode" },
        { composite: true, name: "Card" },
        { composite: true, name: "Page" },
        { composite: true, name: "App" },
      ],
      2,
    );

    expect(context.componentStack).toEqual(["Card", "Page"]);
    expect(context.componentName).toBe("Card");
  });

  it("continues past the retained stack budget to find a business source", () => {
    const context = inspect(
      "18.3.1",
      [
        {
          composite: true,
          name: "VendorPanel",
          source: { fileName: "node_modules/vendor/panel.js", line: 10 },
        },
        {
          composite: true,
          name: "VendorPortal",
          source: { fileName: "node_modules/vendor/portal.js", line: 20 },
        },
        {
          composite: true,
          name: "App",
          source: { fileName: "/project/src/main.tsx", line: 30, column: 5 },
        },
      ],
      2,
    );

    expect(context.componentStack).toEqual(["VendorPanel", "VendorPortal"]);
    expect(context.componentName).toBe("App");
    expect(context.source).toEqual({
      relativePath: "src/main.tsx",
      line: 30,
      column: 5,
      origin: "react-fiber",
      confidence: "probable",
    });
  });

  it("keeps component semantics but omits a source when only vendor files exist", () => {
    const context = inspect("18.3.1", [
      {
        composite: true,
        name: "VendorButton",
        source: { fileName: "node_modules/vendor/button.js", line: 1 },
      },
    ]);

    expect(context).toEqual({
      supported: true,
      version: "18.3.1",
      componentName: "VendorButton",
      componentStack: ["VendorButton"],
    });
  });

  it("uses the registered business component identity through vendor wrappers", () => {
    const businessType = function UserActions(): undefined {
      return undefined;
    };
    const bridge = createBridge("18.3.1", [
      {
        composite: true,
        name: "AntButton",
        componentType: {},
        source: { fileName: "/project/src/UserActions.tsx", line: 20 },
      },
      {
        composite: true,
        name: "UserActions",
        componentType: businessType,
      },
    ]);
    const context = createReact18Adapter({
      bridge,
      getComponentRegistration: (component) =>
        component === businessType
          ? {
              componentSourceId: "component_user_actions",
              sourceVersion: "source_current",
            }
          : undefined,
      maxComponentDepth: 8,
    }).inspect(document.createElement("button"));

    expect(context).toMatchObject({
      componentName: "UserActions",
      componentSourceId: "component_user_actions",
      sourceVersion: "source_current",
    });
  });

  it.each(["17.0.2", "18.1.0", "19.0.0", undefined])(
    "does not inspect private fields for unsupported version %s",
    (version) => {
      const bridge = createBridge(version, [{ composite: true, name: "App" }]);
      const getAncestors = vi.spyOn(bridge, "getAncestors");
      const adapter = createReact18Adapter({ bridge, maxComponentDepth: 8 });
      const element = document.createElement("div");

      expect(adapter.supports(element)).toBe(false);
      expect(adapter.inspect(element)).toEqual({
        supported: false,
        ...(version === undefined ? {} : { version }),
        componentStack: [],
      });
      expect(getAncestors).not.toHaveBeenCalled();
    },
  );

  it("stops inspecting after disposal", () => {
    const bridge = createBridge("18.3.1", [{ composite: true, name: "App" }]);
    const find = vi.spyOn(bridge, "find");
    const adapter = createReact18Adapter({ bridge, maxComponentDepth: 8 });
    const element = document.createElement("div");

    adapter.dispose();

    expect(adapter.supports(element)).toBe(false);
    expect(adapter.inspect(element)).toEqual({
      supported: false,
      componentStack: [],
    });
    expect(find).not.toHaveBeenCalled();
  });

  it("rejects an invalid component depth", () => {
    expect(() =>
      createReact18Adapter({
        bridge: createBridge("18.3.1", []),
        maxComponentDepth: 0,
      }),
    ).toThrow(RangeError);
  });
});
