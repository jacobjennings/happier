import { describe, expect, it } from 'vitest';

import {
    ADD_HOME_RESTORE_PATH,
    HOME_QR_ENTRY_INTENT_ROUTE_PARAM,
    parseHomeQrEntryIntentRouteParam,
} from './homeQrEntryIntent';

describe('HomeQrEntryIntent route param', () => {
    it('parses only the two explicit members of the closed intent type', () => {
        expect(parseHomeQrEntryIntentRouteParam('enter_home')).toBe('enter_home');
        expect(parseHomeQrEntryIntentRouteParam('add_home')).toBe('add_home');
        expect(parseHomeQrEntryIntentRouteParam(['add_home', 'enter_home'])).toBe('add_home');
    });

    it('refuses an absent or malformed intent instead of silently selecting enter_home', () => {
        expect(parseHomeQrEntryIntentRouteParam(undefined)).toBeNull();
        expect(parseHomeQrEntryIntentRouteParam('')).toBeNull();
        expect(parseHomeQrEntryIntentRouteParam('focus_home')).toBeNull();
        expect(parseHomeQrEntryIntentRouteParam(['enter_home '])).toBeNull();
        expect(parseHomeQrEntryIntentRouteParam([])).toBeNull();
    });

    it('keeps the add-home settings entry point on the shared route param', () => {
        const entryPoint = new URL(`https://app.test${ADD_HOME_RESTORE_PATH}`);
        expect(entryPoint.pathname).toBe('/restore');
        expect(parseHomeQrEntryIntentRouteParam(
            entryPoint.searchParams.get(HOME_QR_ENTRY_INTENT_ROUTE_PARAM) ?? undefined,
        )).toBe('add_home');
    });
});
