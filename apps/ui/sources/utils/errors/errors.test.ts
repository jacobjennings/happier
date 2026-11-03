import { describe, expect, it } from 'vitest';
import { HappyError } from './errors';

describe('HappyError', () => {
    it('stays a named HappyError instance carrying retry and classification metadata', () => {
        const error = new HappyError('network down', false, { status: 503, kind: 'network' });
        // getErrorMessage and callers branch on instanceof HappyError (the prototype is set explicitly).
        expect(error).toBeInstanceOf(HappyError);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('HappyError');
        expect(error.canTryAgain).toBe(false);
        expect(error.status).toBe(503);
        expect(error.kind).toBe('network');
    });
});
