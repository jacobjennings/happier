import { describe, expect, it } from 'vitest';

import { resolveAgyAcpReleaseAsset } from './agyAcpRelease.js';

// Official registry URLs; archive-byte SHA-256 and ZIP directory sizes reviewed
// on 2026-11-12 against all six Google 1.5.0 downloads.
const officialAssets = [
  ['darwin', 'arm64', 'macos', 'darwin-arm64', 'c82ecb4ef476bfc35cbe5b2745cdddef873b99c9f5bd7fd11e5ca1fc1667a3fc', 100_401_185, 179_756_208, 309_328_592],
  ['darwin', 'x64', 'macos', 'darwin-x86_64', '86a94e33b25d4a38ff30526ad844546860aa9ed98698498d9e87d30eb794426e', 106_461_356, 184_151_792, 318_882_336],
  ['linux', 'x64', 'linux', 'linux-x86_64', '36f373e8948edf1727b39c7d62b5722d6a4474bdfd72b04ad3d6def571808c9f', 274_069_093, 714_224_576, 853_794_648],
  ['linux', 'arm64', 'linux', 'linux-arm64', '1e184f439477b54138e94440056b26a78c0a8075a8fd2ffda637ec31267c6459', 264_366_319, 721_489_411, 854_441_299],
  ['win32', 'x64', 'windows', 'windows-x86_64', '6163f6b59b381bae419652dbae167bc8cda0ef29d665c0ba8af3d8c7fddd8867', 105_513_364, 155_782_808, 214_097_184],
  ['win32', 'arm64', 'windows', 'windows-arm64', '340092b8af6dafc71eb15f4a8ec54b4d1f0bce16d1fa4d163b562c50b905f8f4', 108_145_235, 147_104_920, 212_181_960],
] as const;

describe('agy_acp_server pinned release', () => {
  it.each(officialAssets)('resolves the reviewed 1.5.0 %s/%s archive within its extraction budget', (platform, arch, directory, target, sha256, archiveBytes, maxFileBytes, expandedBytes) => {
    const asset = resolveAgyAcpReleaseAsset({ platform, arch });
    expect(asset).toMatchObject({
      version: '1.5.0',
      url: `https://dl.google.com/agy-extensions/releases/${directory}/agy-acp-server-1.5.0-${target}.zip`,
      sha256,
      executableSubpath: platform === 'win32' ? 'agy_acp_server.exe' : 'agy_acp_server.par',
      args: platform === 'linux' ? ['--uid='] : [],
    });
    expect(asset.archiveExtractionLimits.maxArchiveBytes).toBeGreaterThanOrEqual(archiveBytes);
    expect(asset.archiveExtractionLimits.maxFileBytes).toBeGreaterThanOrEqual(maxFileBytes);
    expect(asset.archiveExtractionLimits.maxExpandedBytes).toBeGreaterThanOrEqual(expandedBytes);
  });

  it('fails clearly on unsupported platforms instead of emulating', () => {
    expect(() => resolveAgyAcpReleaseAsset({ platform: 'freebsd', arch: 'x64' })).toThrow(/unsupported/i);
  });
});
