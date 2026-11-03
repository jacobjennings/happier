import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleNative = vi.fn(async () => undefined);
const handleBrowserLogin = vi.fn(async () => undefined);
vi.mock('./auth/nativeEmail', () => ({ handleAuthEmailNativeCommand: handleNative }));
vi.mock('./auth/login', () => ({ handleAuthLogin: handleBrowserLogin }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auth native entry dispatch', () => {
  it('routes the inline --email=<value> form through the native controller, not the browser flow', async () => {
    const { handleAuthCommand } = await import('./auth');
    await handleAuthCommand(['login', '--email=person@example.test', '--password', 'secret']);
    expect(handleNative).toHaveBeenCalledWith(
      ['login', '--email=person@example.test', '--password', 'secret'],
      undefined,
    );
    expect(handleBrowserLogin).not.toHaveBeenCalled();
  });

  it('keeps plain browser login off the native controller', async () => {
    const { handleAuthCommand } = await import('./auth');
    await handleAuthCommand(['login', '--no-open']);
    expect(handleBrowserLogin).toHaveBeenCalledWith(['--no-open'], undefined);
    expect(handleNative).not.toHaveBeenCalled();
  });
});
