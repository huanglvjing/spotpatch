import path from "node:path";

import type { RunningProcess } from "./process-control.js";

const NEXT_START_TIMEOUT_MS = 90_000;

export function getNextEntry(dependencyRoot: string): string {
  return path.join(dependencyRoot, "node_modules", "next", "dist", "bin", "next");
}

export async function waitForNextServer(
  url: string,
  running: RunningProcess,
): Promise<void> {
  const deadline = Date.now() + NEXT_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) {
      throw new Error(
        `Next dev exited before becoming ready with code ${String(running.child.exitCode)}.`,
      );
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      await response.body?.cancel();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(
    `Next dev did not become ready within ${String(NEXT_START_TIMEOUT_MS)}ms.`,
  );
}
