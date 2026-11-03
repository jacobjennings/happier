

export async function isRetainedManagedProviderInvocationCurrent(
  input: Readonly<{
    readsRetainedAuthorityCurrent(): boolean;
    revalidatePolicy(): Promise<boolean>;
    fenceRetainedPolicy(): Promise<void>;
    readHardRevocationRevision(): Promise<number>;
    readGenerationIntegrityCurrentness(): Promise<boolean>;
    hardRevocationRevisionAtAdmission: number;
  }>,
): Promise<boolean> {
  try {
    if (!input.readsRetainedAuthorityCurrent()) return false;
    let policyCurrent = false;
    try {
      policyCurrent = (await input.revalidatePolicy()) === true;
    } catch {
      if (!input.readsRetainedAuthorityCurrent()) return false;
      await input.fenceRetainedPolicy();
      return false;
    }
    if (!policyCurrent) {
      if (!input.readsRetainedAuthorityCurrent()) return false;
      await input.fenceRetainedPolicy();
      return false;
    }
    if (!input.readsRetainedAuthorityCurrent()) return false;
    const hardRevocationRevision = await input.readHardRevocationRevision();
    if (
      hardRevocationRevision !== input.hardRevocationRevisionAtAdmission ||
      (await input.readGenerationIntegrityCurrentness()) !== true
    ) {
      return false;
    }
    if (
      (await input.readHardRevocationRevision()) !==
      input.hardRevocationRevisionAtAdmission
    ) {
      return false;
    }
    return input.readsRetainedAuthorityCurrent();
  } catch {
    return false;
  }
}

export async function isManagedProviderSessionInvocationCurrent(
  input: Readonly<{
    adoptionCommitted(): boolean;
    revalidateInitialPolicy(): Promise<boolean>;
    readsRetainedAuthorityCurrent(): boolean;
    revalidateRetainedPolicy(): Promise<boolean>;
    fenceRetainedPolicy(): Promise<void>;
    readHardRevocationRevision(): Promise<number>;
    readGenerationIntegrityCurrentness(): Promise<boolean>;
    hardRevocationRevisionAtAdmission: number;
  }>,
): Promise<boolean> {
  if (!input.adoptionCommitted()) {
    try {
      return (
        (await input.revalidateInitialPolicy()) === true &&
        !input.adoptionCommitted()
      );
    } catch {
      return false;
    }
  }
  return await isRetainedManagedProviderInvocationCurrent({
    readsRetainedAuthorityCurrent: input.readsRetainedAuthorityCurrent,
    revalidatePolicy: input.revalidateRetainedPolicy,
    fenceRetainedPolicy: input.fenceRetainedPolicy,
    readHardRevocationRevision: input.readHardRevocationRevision,
    readGenerationIntegrityCurrentness:
      input.readGenerationIntegrityCurrentness,
    hardRevocationRevisionAtAdmission: input.hardRevocationRevisionAtAdmission,
  });
}
