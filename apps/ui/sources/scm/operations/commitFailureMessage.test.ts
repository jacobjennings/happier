import { describe, expect, it } from 'vitest';

import { buildScmCommitFailureMessage } from './commitFailureMessage';

describe('buildScmCommitFailureMessage', () => {
    it('uses the backend error, or the commit failure copy when the backend gave none', () => {
        expect(buildScmCommitFailureMessage({ error: 'Commit hook rejected the change' })).toBe('Commit hook rejected the change');
        expect(buildScmCommitFailureMessage({})).toBe('Failed to create commit');
    });
});
