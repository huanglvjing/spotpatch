import { describe, expect, it } from "vitest";

import { parseNextDevArguments } from "./cli-args.js";

describe("Next CLI arguments", () => {
  it("adds deterministic loopback defaults without changing user order", () => {
    expect(parseNextDevArguments(["--webpack"], {}).nextArguments).toEqual([
      "--webpack",
      "--hostname",
      "localhost",
      "--port",
      "3000",
    ]);
  });

  it("accepts explicit loopback host/port and identifies Turbopack", () => {
    expect(
      parseNextDevArguments(
        ["--port=3100", "--hostname", "localhost", "--turbopack"],
        {},
      ),
    ).toMatchObject({
      bundler: "turbopack",
      hostname: "localhost",
      port: 3_100,
      publicOrigin: "http://localhost:3100",
    });
  });

  it("uses the inspected Next major's default bundler when no flag is present", () => {
    expect(parseNextDevArguments([], {}, "webpack").bundler).toBe("webpack");
    expect(parseNextDevArguments([], {}, "turbopack").bundler).toBe("turbopack");
  });

  it("rejects LAN hosts, invalid ports, duplicate values, and bundler conflicts", () => {
    expect(() => parseNextDevArguments(["--hostname", "0.0.0.0"], {})).toThrow(
      /loopback/u,
    );
    expect(() => parseNextDevArguments(["--port", "0"], {})).toThrow(RangeError);
    expect(() => parseNextDevArguments(["-p", "3000", "--port=3001"], {})).toThrow(
      /duplicate/u,
    );
    expect(() => parseNextDevArguments(["--webpack", "--turbopack"], {})).toThrow(
      /together/u,
    );
  });
});
