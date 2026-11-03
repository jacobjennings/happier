import { describe, expect, it } from 'vitest';

import { buildApprovalPreviewSummary } from '../actionExecutor.js';
import { getActionSpec } from '../actionSpecs.js';

describe('public profile approval presentation', () => {
  it('declares one compact consequence for Resume and Refresh while retaining danger confirmation', () => {
    expect(buildApprovalPreviewSummary(getActionSpec('account.public_profile.resume'), {}))
      .toBe('Recomputes your page from the same items and shows it again.');
    expect(buildApprovalPreviewSummary(getActionSpec('account.public_profile.refresh'), {}))
      .toBe('Recomputes your page from the same items and shows it again.');
    expect(getActionSpec('account.public_profile.resume').irreversible).toBe(true);
    expect(getActionSpec('account.public_profile.refresh').irreversible).toBe(true);
  });
});
