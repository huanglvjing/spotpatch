import { ERROR_CODES, SpotPatchError } from "@spotpatch/shared";

export interface ProviderCredential {
  readonly kind: "provider-credential";
}

const credentialValues = new WeakMap<ProviderCredential, string>();

export function createProviderCredential(value: string): ProviderCredential {
  if (value.trim().length === 0) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  }

  const credential = Object.freeze({
    kind: "provider-credential",
  } as const);
  credentialValues.set(credential, value);
  return credential;
}

export function resolveProviderCredential(
  environmentName: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ProviderCredential {
  const value = environment[environmentName];

  if (value === undefined) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  }

  return createProviderCredential(value);
}

export function readProviderCredential(credential: ProviderCredential): string {
  const value = credentialValues.get(credential);

  if (value === undefined) {
    throw new SpotPatchError(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  }

  return value;
}
