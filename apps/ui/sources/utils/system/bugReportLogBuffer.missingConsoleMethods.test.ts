import { afterEach, describe, expect, it } from 'vitest';

import { getBugReportLogEntries, installBugReportConsoleCapture } from './bugReportLogBuffer';

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
const consoleMethods = console as unknown as Record<(typeof LEVELS)[number], unknown>;

describe('bugReportLogBuffer (missing console methods)', () => {
    const originals = Object.fromEntries(LEVELS.map((level) => [level, consoleMethods[level]]));

    afterEach(() => {
        for (const level of LEVELS) consoleMethods[level] = originals[level];
    });

    it('keeps capturing the remaining levels when a console method is missing', () => {
        for (const level of LEVELS) consoleMethods[level] = () => {};
        // A host without console.info: a level ahead of warn/error/debug in the wrap order.
        consoleMethods.info = undefined;

        expect(() => installBugReportConsoleCapture({ maxEntries: 10 })).not.toThrow();
        console.warn('after-missing-warn');
        console.debug('after-missing-debug');

        expect(getBugReportLogEntries().map((entry) => [entry.level, entry.message])).toEqual([
            ['warn', 'after-missing-warn'],
            ['debug', 'after-missing-debug'],
        ]);
        expect(consoleMethods.info).toBeUndefined();
    });
});
