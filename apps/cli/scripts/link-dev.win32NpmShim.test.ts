import { describe, expect, it, vi } from 'vitest';

type LinkDevModule = {
  getGlobalBinDir: (opts?: { execFileSync?: (...args: any[]) => any; existsSync?: (path: string) => boolean }) => string;
};

// npm 9 removed `npm bin`; the global bin directory is derived from `npm prefix -g`
// (the prefix itself on Windows, `<prefix>/bin` elsewhere).
describe('link-dev global bin directory', () => {
  it.each([
    {
      platform: 'win32',
      output: 'C:\\Users\\me\\AppData\\Roaming\\npm\r\n',
      command: 'cmd',
      args: ['/d', '/s', '/c', '"npm prefix -g"'],
      binDir: 'C:\\Users\\me\\AppData\\Roaming\\npm',
    },
    { platform: 'linux', output: '/usr/local\n', command: 'npm', args: ['prefix', '-g'], binDir: '/usr/local/bin' },
  ])('resolves the npm global bin directory from the global prefix on $platform', ({ platform, output, command, args, binDir }) => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    if (!originalPlatformDescriptor) {
      throw new Error('Expected process.platform to be configurable for this test');
    }

    Object.defineProperty(process, 'platform', { ...originalPlatformDescriptor, value: platform });
    try {
      vi.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./link-dev.cjs') as LinkDevModule;
      const execFileSync = vi.fn(() => output);
      const checked: string[] = [];
      const dir = mod.getGlobalBinDir({ execFileSync, existsSync: (path) => { checked.push(path); return true; } });

      const [calledCommand, calledArgs] = execFileSync.mock.calls[0] ?? [];
      expect(String(calledCommand).toLowerCase()).toContain(command);
      expect(calledArgs).toEqual(args);
      expect(dir).toBe(binDir);
      expect(checked).toEqual([binDir]);
    } finally {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
      vi.resetModules();
    }
  });
});
