import { describe, expect, it } from 'vitest';

import {
    createTranscriptViewportOwnership,
    type TranscriptViewportTransactionOutcome,
    type TranscriptViewportTransactionOwner as TxOwner,
} from './transcriptViewportOwnership';
import type { TranscriptViewportOwner } from './transcriptViewportTypes';

describe('transcript viewport ownership', () => {
    describe('initial state', () => {
        it('starts with follow as the active owner, only follow may write, and idle never writes', () => {
            const ownership = createTranscriptViewportOwnership();

            expect(ownership.activeOwner()).toBe('follow');
            expect(ownership.canWrite('follow')).toBe(true);
            expect(ownership.canWrite('entry')).toBe(false);
            expect(ownership.canWrite('prepend')).toBe(false);
            expect(ownership.canWrite('explicit')).toBe(false);
            expect(ownership.canWrite('idle')).toBe(false);

            ownership.openTransaction('entry');
            expect(ownership.canWrite('idle')).toBe(false);

            ownership.closeTransaction('entry', 'preempted');
            expect(ownership.canWrite('idle')).toBe(false);
        });
    });

    describe('openTransaction', () => {
        it('grants exclusive write access to the opened owner', () => {
            const ownership = createTranscriptViewportOwnership();

            expect(ownership.openTransaction('entry')).toEqual({ opened: true });
            expect(ownership.activeOwner()).toBe('entry');
            expect(ownership.canWrite('entry')).toBe(true);
            expect(ownership.canWrite('follow')).toBe(false);
            expect(ownership.canWrite('prepend')).toBe(false);
            expect(ownership.canWrite('explicit')).toBe(false);
        });

        it.each([
            { active: 'entry', next: 'entry' },
            { active: 'entry', next: 'prepend' },
            { active: 'prepend', next: 'entry' },
            { active: 'explicit', next: 'entry' },
            { active: 'explicit', next: 'prepend' },
        ] satisfies ReadonlyArray<{ active: TxOwner; next: TxOwner }>)(
            'rejects opening $next while $active owns the viewport',
            ({ active, next }) => {
                const ownership = createTranscriptViewportOwnership();
                ownership.openTransaction(active);

                expect(ownership.openTransaction(next)).toEqual({ opened: false, activeOwner: active });
                expect(ownership.activeOwner()).toBe(active);
            },
        );
    });

    describe('closeTransaction', () => {
        it('returns ownership to follow when the active owner closes', () => {
            const ownership = createTranscriptViewportOwnership();
            ownership.openTransaction('entry');

            expect(ownership.closeTransaction('entry', 'confirmed')).toEqual({
                closed: true,
                owner: 'entry',
                outcome: 'confirmed',
            });
            expect(ownership.activeOwner()).toBe('follow');
            expect(ownership.canWrite('follow')).toBe(true);
            expect(ownership.canWrite('entry')).toBe(false);
        });

        it.each([
            { open: 'entry', close: 'prepend', outcome: 'abandoned-user-scroll', active: 'entry' },
            { open: null, close: 'entry', outcome: 'deadline', active: 'follow' },
        ] satisfies ReadonlyArray<{
            open: TxOwner | null;
            close: TxOwner;
            outcome: TranscriptViewportTransactionOutcome;
            active: TranscriptViewportOwner;
        }>)(
            'rejects a close by $close that does not own the viewport (open: $open) without state change',
            ({ open, close, outcome, active }) => {
                const ownership = createTranscriptViewportOwnership();
                if (open) ownership.openTransaction(open);

                expect(ownership.closeTransaction(close, outcome)).toEqual({
                    closed: false,
                    activeOwner: active,
                });
                expect(ownership.activeOwner()).toBe(active);
                expect(ownership.canWrite(active)).toBe(true);
            },
        );

        it('allows a new transaction after the previous one closed', () => {
            const ownership = createTranscriptViewportOwnership();
            ownership.openTransaction('entry');
            ownership.closeTransaction('entry', 'confirmed');

            expect(ownership.openTransaction('prepend')).toEqual({ opened: true });
            expect(ownership.activeOwner()).toBe('prepend');

            ownership.closeTransaction('prepend', 'mvcp-preserved');
            expect(ownership.activeOwner()).toBe('follow');
        });
    });

    describe('preempt', () => {
        it.each([
            { open: 'entry', preemptedOwner: 'entry' },
            { open: 'prepend', preemptedOwner: 'prepend' },
            { open: 'explicit', preemptedOwner: 'explicit' },
            { open: null, preemptedOwner: null },
        ] satisfies ReadonlyArray<{ open: TxOwner | null; preemptedOwner: TxOwner | null }>)(
            'lets explicit preempt-open with exclusive write access (open: $open)',
            ({ open, preemptedOwner }) => {
                const ownership = createTranscriptViewportOwnership();
                if (open) ownership.openTransaction(open);

                expect(ownership.preempt('explicit')).toEqual({ opened: true, preemptedOwner });
                expect(ownership.activeOwner()).toBe('explicit');
                expect(ownership.canWrite('explicit')).toBe(true);
                expect(ownership.canWrite('entry')).toBe(false);
                expect(ownership.canWrite('prepend')).toBe(false);
                expect(ownership.canWrite('follow')).toBe(false);
            },
        );

        it('gives entry and prepend no preemption power', () => {
            const ownership = createTranscriptViewportOwnership();
            ownership.openTransaction('prepend');

            expect(ownership.preempt('entry')).toEqual({ opened: false, preemptedOwner: null, activeOwner: 'prepend' });
            expect(ownership.activeOwner()).toBe('prepend');

            ownership.closeTransaction('prepend', 'fallback-restored');
            ownership.openTransaction('entry');
            expect(ownership.preempt('prepend')).toEqual({ opened: false, preemptedOwner: null, activeOwner: 'entry' });
            expect(ownership.activeOwner()).toBe('entry');
        });

        it('lets entry or prepend preempt-open when nothing is open', () => {
            const ownership = createTranscriptViewportOwnership();

            expect(ownership.preempt('entry')).toEqual({ opened: true, preemptedOwner: null });
            expect(ownership.activeOwner()).toBe('entry');
        });
    });

    describe('sequences', () => {
        it('handles entry → explicit preempt → close → prepend lifecycle', () => {
            const ownership = createTranscriptViewportOwnership();

            expect(ownership.openTransaction('entry')).toEqual({ opened: true });
            expect(ownership.preempt('explicit')).toEqual({ opened: true, preemptedOwner: 'entry' });
            expect(ownership.closeTransaction('entry', 'confirmed')).toEqual({
                closed: false,
                activeOwner: 'explicit',
            });
            expect(ownership.closeTransaction('explicit', 'confirmed')).toEqual({
                closed: true,
                owner: 'explicit',
                outcome: 'confirmed',
            });
            expect(ownership.openTransaction('prepend')).toEqual({ opened: true });
            expect(ownership.closeTransaction('prepend', 'abandoned-identity')).toEqual({
                closed: true,
                owner: 'prepend',
                outcome: 'abandoned-identity',
            });
            expect(ownership.activeOwner()).toBe('follow');
        });
    });
});
