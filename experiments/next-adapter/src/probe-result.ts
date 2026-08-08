import type { ProbeAssertion } from "./contracts.js";

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function addAssertion(
  assertions: ProbeAssertion[],
  input: Omit<ProbeAssertion, "passed"> & { readonly passed: boolean },
): void {
  assertions.push(Object.freeze(input));

  if (!input.passed) {
    throw new Error(
      `${input.name}: expected ${input.expected}, received ${input.actual}.`,
    );
  }
}

export function appendError(
  error: string | null,
  additionalError: string | null,
): string | null {
  if (additionalError === null) {
    return error;
  }

  return error === null ? additionalError : `${error} ${additionalError}`;
}
