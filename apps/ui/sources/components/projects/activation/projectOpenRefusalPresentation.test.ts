import { describe, expect, it } from 'vitest';
import { t } from '@/text';
import { projectOpenRefusalPresentation } from './projectOpenRefusalPresentation';

describe('Project Open refusal presentation', () => {
    it('distinguishes missing clone support from an unavailable Source hosting provider', () => {
        expect(projectOpenRefusalPresentation('FEATURE_UNSUPPORTED', null)).not.toEqual(projectOpenRefusalPresentation('BACKEND_UNAVAILABLE', null));
        expect(projectOpenRefusalPresentation('FEATURE_UNSUPPORTED', null)).toEqual({ title: t('projects.open.cloneUnsupported') });
        expect(projectOpenRefusalPresentation('BACKEND_UNAVAILABLE', null)).toEqual({ title: t('projects.open.hostingProviderUnavailable') });
    });
    it('offers target recovery without claiming the machine is offline or incapable', () => {
        expect(projectOpenRefusalPresentation('target_mismatch', null)).toEqual({
            title: t('projects.open.targetMismatch'), description: t('projects.open.targetMismatchHint'),
        });
    });
    it('retains distinct Source and transport refusals', () => {
        expect(projectOpenRefusalPresentation('source_changed', null)).toEqual({ title: t('projects.open.sourceChanged') });
        expect(projectOpenRefusalPresentation('machine_unreachable', null)).toEqual({ title: t('workspaceSync.start.blocked.targetMachineOffline') });
        expect(projectOpenRefusalPresentation('machine_offline', null)).toEqual({ title: t('workspaceSync.start.blocked.targetMachineOffline') });
    });
});
