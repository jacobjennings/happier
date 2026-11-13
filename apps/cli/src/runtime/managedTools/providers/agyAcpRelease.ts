// Official ACP registry 1.5.0 assets (reviewed 2026-11-12).
// SHA-256 values were calculated from each complete dl.google.com archive;
// each ZIP contains the flat server + companion localharness payload.
// Native execution still requires the matching platform and architecture.

import type { ArchiveExtractionLimits } from '@happier-dev/release-runtime/archiveExtraction';
import { AGY_ACP_SERVER_VERSION } from '@happier-dev/protocol/installables';

// Reviewed 1.5.0 maxima: 274,069,093 archive bytes, 721,489,411 bytes
// per file and 854,441,299 expanded bytes. Retain the existing release-owned
// extraction budget, including the deadline for large executable extraction.
const ARCHIVE_EXTRACTION_LIMITS = Object.freeze({
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024 * 1024,
  maxExpandedBytes: 2 * 1024 * 1024 * 1024,
  timeoutMs: 10 * 60_000,
});

export type AgyAcpReleaseAsset = Readonly<{
  name: string;
  url: string;
  sha256: string;
  tag: string | null;
  version: string | null;
  executableSubpath: string;
  args: readonly string[];
  archiveExtractionLimits: Pick<
    ArchiveExtractionLimits,
    'maxArchiveBytes' | 'maxFileBytes' | 'maxExpandedBytes' | 'timeoutMs'
  >;
}>;

type PinnedAsset = Readonly<{
  archiveUrl: string;
  sha256: string;
  executableSubpath: string;
  args?: readonly string[];
}>;

const PINNED_ASSETS: Readonly<Record<string, PinnedAsset>> = Object.freeze({
  'darwin-arm64': {
    archiveUrl: 'https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.5.0-darwin-arm64.zip',
    sha256: 'c82ecb4ef476bfc35cbe5b2745cdddef873b99c9f5bd7fd11e5ca1fc1667a3fc',
    executableSubpath: 'agy_acp_server.par',
  },
  'darwin-x64': {
    archiveUrl: 'https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.5.0-darwin-x86_64.zip',
    sha256: '86a94e33b25d4a38ff30526ad844546860aa9ed98698498d9e87d30eb794426e',
    executableSubpath: 'agy_acp_server.par',
  },
  'linux-x64': {
    archiveUrl: 'https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.5.0-linux-x86_64.zip',
    sha256: '36f373e8948edf1727b39c7d62b5722d6a4474bdfd72b04ad3d6def571808c9f',
    executableSubpath: 'agy_acp_server.par',
    args: ['--uid='],
  },
  'linux-arm64': {
    archiveUrl: 'https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.5.0-linux-arm64.zip',
    sha256: '1e184f439477b54138e94440056b26a78c0a8075a8fd2ffda637ec31267c6459',
    executableSubpath: 'agy_acp_server.par',
    args: ['--uid='],
  },
  'win32-x64': {
    archiveUrl: 'https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.5.0-windows-x86_64.zip',
    sha256: '6163f6b59b381bae419652dbae167bc8cda0ef29d665c0ba8af3d8c7fddd8867',
    executableSubpath: 'agy_acp_server.exe',
  },
  'win32-arm64': {
    archiveUrl: 'https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.5.0-windows-arm64.zip',
    sha256: '340092b8af6dafc71eb15f4a8ec54b4d1f0bce16d1fa4d163b562c50b905f8f4',
    executableSubpath: 'agy_acp_server.exe',
  },
});

function normalizePlatform(platform: string): string {
  return String(platform ?? '').trim();
}

function normalizeArch(arch: string): string {
  const value = String(arch ?? '').trim();
  if (value === 'x86_64') return 'x64';
  if (value === 'aarch64') return 'arm64';
  return value;
}

function resolvePlatformKey(platform: string, arch: string): string | null {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedArch = normalizeArch(arch);
  if (normalizedPlatform === 'darwin' && normalizedArch === 'arm64') return 'darwin-arm64';
  if (normalizedPlatform === 'darwin' && normalizedArch === 'x64') return 'darwin-x64';
  if (normalizedPlatform === 'linux' && normalizedArch === 'x64') return 'linux-x64';
  if (normalizedPlatform === 'linux' && normalizedArch === 'arm64') return 'linux-arm64';
  if (normalizedPlatform === 'win32' && normalizedArch === 'x64') return 'win32-x64';
  if (normalizedPlatform === 'win32' && normalizedArch === 'arm64') return 'win32-arm64';
  return null;
}

function basenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? 'agy-acp-server.zip';
  } catch {
    return 'agy-acp-server.zip';
  }
}

export function resolveAgyAcpReleaseAsset(
  opts: Readonly<{ platform?: string; arch?: string }> = {},
): AgyAcpReleaseAsset {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const key = resolvePlatformKey(platform, arch);
  const pinned = key ? PINNED_ASSETS[key] : undefined;
  if (!key || !pinned) {
    throw new Error(`Unsupported agy-acp-server platform: ${platform}/${arch}`);
  }
  return {
    name: basenameFromUrl(pinned.archiveUrl),
    url: pinned.archiveUrl,
    sha256: pinned.sha256,
    tag: AGY_ACP_SERVER_VERSION,
    version: AGY_ACP_SERVER_VERSION,
    executableSubpath: pinned.executableSubpath,
    args: pinned.args ?? [],
    archiveExtractionLimits: ARCHIVE_EXTRACTION_LIMITS,
  };
}
