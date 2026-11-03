/**
 * Per-test resets for process-global module state. A module registers its reset
 * under `Symbol.for('happier.vitest.testResets')` when it loads, and the global
 * setup runs every registered reset before each test. A suite that never loads
 * the module therefore never imports it just to reset it.
 */
export const testResetsForTests = new Map<string, () => void>();

(globalThis as unknown as { [key: symbol]: Map<string, () => void> | undefined })[Symbol.for('happier.vitest.testResets')] = testResetsForTests;
