import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('cached Intl date/time formatters', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
    });

    it('reuses DateTimeFormat instances for equivalent locale and option sets', async () => {
        const formatSpy = vi.fn(() => 'formatted');
        const constructorSpy = vi
            .spyOn(Intl, 'DateTimeFormat')
            .mockImplementation((() => ({ format: formatSpy })) as unknown as typeof Intl.DateTimeFormat);
        const { formatWithCachedDateTimeFormatter } = await import('./cachedIntlFormatters');

        expect(formatWithCachedDateTimeFormatter(new Date(1), undefined, { timeStyle: 'short', dateStyle: 'medium' }))
            .toBe('formatted');
        expect(formatWithCachedDateTimeFormatter(new Date(2), undefined, { dateStyle: 'medium', timeStyle: 'short' }))
            .toBe('formatted');
        expect(formatWithCachedDateTimeFormatter(new Date(3), undefined, { hour: 'numeric' }))
            .toBe('formatted');

        expect(constructorSpy).toHaveBeenCalledTimes(2);
        expect(formatSpy).toHaveBeenCalledTimes(3);
    });

    it('names a calendar day without the year only while it is the current year', async () => {
        const { formatCalendarDate } = await import('./cachedIntlFormatters');
        // Local noon: the owner reads the local calendar year, so UTC-built dates shift days on far-east runners.
        const now = new Date(2026, 9, 12, 12).getTime();
        expect(formatCalendarDate(new Date(2026, 9, 18, 12).getTime(), 'en', now)).toBe('Oct 18');
        expect(formatCalendarDate(new Date(2027, 0, 3, 12).getTime(), 'en', now)).toBe('Jan 3, 2027');
        expect(formatCalendarDate(new Date(2025, 11, 30, 12).getTime(), 'en', now)).toBe('Dec 30, 2025');
    });
});
