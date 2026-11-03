import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => vi.resetModules());
// Module collection, not a timed test body, owns cold graph initialization.
import * as workflows from './index.js';
import * as admission from '../actions/executor/agentStartAdmission.js';

describe('Workflow entry-first module loading', () => {
  it('loads and parses the public Workflow entry before Action admission', () => {
    expect(workflows.WorkflowStepSelectionV1Schema.parse({ connectedServices: null }))
      .toEqual({ connectedServices: null });
    expect(admission.resolveAgentStartBaselineSelectionV1({
      profileId: undefined, connectedServices: null,
    }, undefined).connectedServices).toBeNull();
  });
});
