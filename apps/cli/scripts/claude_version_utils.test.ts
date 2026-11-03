import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findGlobalClaudeCliPath,
  detectSourceFromPath,
  compareVersions,
  getClaudeCliPath
} from '../scripts/claude_version_utils.cjs';

describe('Claude Version Utils - Cross-Platform Detection', () => {

  describe('detectSourceFromPath', () => {
    // One row per distinct classification branch (and precedence between branches).
    it.each([
      // npm
      ['npm global on macOS/Linux', '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', 'npm'],
      ['npm through Homebrew npm (npm wins over the Homebrew prefix)', '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js', 'npm'],
      ['npm global on Windows with backslashes', 'C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js', 'npm'],
      ['npm on Windows, case-insensitive', 'C:/USERS/TEST/APPDATA/ROAMING/NPM/NODE_MODULES/@ANTHROPIC-AI/CLAUDE-CODE/CLI.JS', 'npm'],
      ['unrelated scoped npm package is not npm', 'C:/Users/test/AppData/Roaming/npm/node_modules/@babel/core/cli.js', 'PATH'],
      // Homebrew cask (hashed dir, checked before npm)
      ['Homebrew cask hashed directory', '/opt/homebrew/lib/node_modules/@anthropic-ai/.claude-code-2DTsDk1V/cli.js', 'Homebrew'],
      // Bun
      ['Bun bin', '/Users/test/.bun/bin/claude', 'Bun'],
      ['Bun global node_modules (Bun wins over npm)', '/Users/test/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js', 'Bun'],
      // Homebrew
      ['Homebrew on Apple Silicon', '/opt/homebrew/bin/claude', 'Homebrew'],
      ['Linuxbrew system prefix', '/home/linuxbrew/.linuxbrew/bin/claude', 'Homebrew'],
      ['Linuxbrew user prefix', '/Users/test/.linuxbrew/bin/claude', 'Homebrew'],
      ['Homebrew Cellar', '/opt/homebrew/Cellar/claude-code/1.0.0/bin/claude', 'Homebrew'],
      ['path.normalize before matching', '/opt/homebrew/bin/../lib/claude', 'Homebrew'],
      // Native installer
      ['native installer ~/.local/bin', '/Users/test/.local/bin/claude', 'native installer'],
      ['native installer versioned ~/.local/share/claude', '/Users/test/.local/share/claude/versions/2.0.69/claude', 'native installer'],
      ['Windows claude.exe at any location', 'E:/Tools/Claude/claude.exe', 'native installer'],
      ['Windows claude.exe in AppData with backslashes', 'C:\\Users\\test\\AppData\\Local\\Claude\\claude.exe', 'native installer'],
      ['Windows AppData Claude without .exe', 'C:/Users/test/AppData/Local/Claude/claude', 'native installer'],
      ['Windows Program Files Claude without .exe', 'C:/Program Files/Claude/claude.cmd', 'native installer'],
      // PATH fallback
      ['unrecognized path', '/some/random/path/claude', 'PATH'],
      ['custom /opt location is not Homebrew', '/opt/custom/claude/bin/claude', 'PATH'],
      ['custom /usr/local location is not Homebrew/native', '/usr/local/custom/bin/claude', 'PATH'],
      ['empty path', '', 'PATH'],
      ['relative path', './local/bin/claude', 'PATH'],
    ])('%s', (_name, input, expected) => {
      expect(detectSourceFromPath(input)).toBe(expected);
    });

    it.each([
      ['darwin', 'Homebrew'],
      ['linux', 'native installer'],
      ['win32', 'PATH'],
    ])('classifies /usr/local/bin/claude on %s as %s', (platform, expected) => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      try {
        expect(detectSourceFromPath('/usr/local/bin/claude')).toBe(expected);
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });
  });

  describe('Version comparison', () => {
    it('should compare versions correctly', () => {
      expect(compareVersions('2.0.69', '2.0.68')).toBe(1);
      expect(compareVersions('2.0.68', '2.0.69')).toBe(-1);
      expect(compareVersions('2.0.69', '2.0.69')).toBe(0);
      expect(compareVersions('2.1.0', '2.0.69')).toBe(1);
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    });
  });
});

describe('Claude Version Utils - getClaudeCliPath logging', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  it('does not print "Using Claude Code ..." unless debug is enabled', () => {
    process.env.HAPPIER_CLAUDE_PATH = 'claude';
    delete process.env.DEBUG;
    delete process.env.HAPPIER_DEBUG_CLAUDE_LAUNCHER;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolved = getClaudeCliPath();

    expect(resolved).toBe('claude');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('prints "Using Claude Code ..." when debug is enabled', () => {
    process.env.HAPPIER_CLAUDE_PATH = 'claude';
    process.env.DEBUG = '1';

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolved = getClaudeCliPath();

    expect(resolved).toBe('claude');
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('HAPPIER_CLAUDE_PATH env var', () => {
  let testDir: string;
  let testClaudePath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(join(tmpdir(), 'happier-claude-path-'));
    testClaudePath = join(testDir, 'claude');
    // Create mock executable
    fs.writeFileSync(testClaudePath, '#!/bin/bash\necho "mock"');
    fs.chmodSync(testClaudePath, 0o755);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    delete process.env.HAPPIER_CLAUDE_PATH;
  });

  it('should use HAPPIER_CLAUDE_PATH when set', () => {
    process.env.HAPPIER_CLAUDE_PATH = testClaudePath;
    const result = findGlobalClaudeCliPath();
    expect(result?.source).toBe('HAPPIER_CLAUDE_PATH');
    // Use realpathSync to handle macOS symlink (/var -> /private/var)
    expect(fs.realpathSync(result?.path ?? '')).toBe(fs.realpathSync(testClaudePath));
  });

  it('should ignore env var if path does not exist', () => {
    process.env.HAPPIER_CLAUDE_PATH = join(testDir, 'nonexistent', 'claude');
    const result = findGlobalClaudeCliPath();
    expect(result?.source).not.toBe('HAPPIER_CLAUDE_PATH');
  });
});
