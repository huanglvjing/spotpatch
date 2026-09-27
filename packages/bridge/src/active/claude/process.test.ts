import { describe, expect, it } from "vitest";

import { runBoundedProcess } from "./process.js";

function node(
  source: string,
  options: Partial<Parameters<typeof runBoundedProcess>[2]> = {},
) {
  return runBoundedProcess(process.execPath, ["-e", source], {
    cwd: process.cwd(),
    environment: process.env,
    outputLimitBytes: 1_024,
    timeoutMs: 5_000,
    ...options,
  });
}

describe("bounded process", () => {
  it("passes stdin through and returns stdout with the exit code", async () => {
    await expect(
      node("process.stdin.pipe(process.stdout)", { stdin: "fixture input" }),
    ).resolves.toEqual({ exitCode: 0, stdout: "fixture input", stopped: false });
  });

  it("stops early when a line handler rejects a line", async () => {
    const lines: string[] = [];
    const result = await node(
      "console.log('first'); console.log('second'); setTimeout(() => console.log('late'), 5000);",
      {
        onLine: (line) => {
          lines.push(line);
          return line !== "second";
        },
      },
    );
    expect(result.stopped).toBe(true);
    expect(lines).toEqual(["first", "second"]);
  });

  it.each([
    [
      "output-limit",
      "process.stdout.write('x'.repeat(4096)); setTimeout(() => {}, 5000);",
      {},
    ],
    ["timeout", "setTimeout(() => {}, 5000);", { timeoutMs: 50 }],
  ] as const)("fails with %s", async (reason, source, options) => {
    await expect(node(source, options)).rejects.toMatchObject({
      name: "BoundedProcessError",
      reason,
    });
  });

  it("fails with aborted when its signal aborts", async () => {
    const controller = new AbortController();
    const running = node("setTimeout(() => {}, 5000);", { signal: controller.signal });
    controller.abort();
    await expect(running).rejects.toMatchObject({ reason: "aborted" });
  });
});
