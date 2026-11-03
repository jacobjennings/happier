import type { PersistedNpmRegistryProfile } from '@/plugins/store/npmRegistries/store';

import { createNpmRegistryHttpsClient, NpmRegistryHttpError } from '../httpsClient';

export function createNpmRegistryProfileProbe(): (input: Readonly<{
  profile: PersistedNpmRegistryProfile;
  authorizationHeader?: string;
}>) => Promise<Readonly<{ status: 'available' | 'authentication_failed' | 'offline' }>> {
  return async ({ profile, authorizationHeader }) => {
    const client = createNpmRegistryHttpsClient({
      registryOrigin: profile.origin,
      allowPrivateNetwork: profile.allowPrivateNetwork,
      ...(authorizationHeader ? { authorizationHeader } : {}),
    });
    try {
      await client.getJson({
        url: `${profile.origin}/-/ping`,
        maxBytes: 64 * 1024,
        headers: { accept: 'application/json' },
      });
      return { status: 'available' };
    } catch (error) {
      return error instanceof NpmRegistryHttpError && error.code === 'authentication_failed'
        ? { status: 'authentication_failed' }
        : { status: 'offline' };
    }
  };
}
