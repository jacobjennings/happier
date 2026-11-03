/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';

import { createMarkdownEditorExtensions } from '../createMarkdownEditorExtensions';

/**
 * Ported from upstream's `rich-markdown-list-continuation.test.ts` (and the
 * list-specific cases of `rich-markdown-key-handler.test.ts`). The behavior is
 * verified against a REAL headless `@tiptap/core` editor (no mocks) using JSON
 * doc seeds so the input shape is independent of any markdown parser quirks.
 * Each case presses Backspace through the editor's keymap, the shipped entry point.
 */

function createEditor(content: object, options: { withListContinuation?: boolean } = {}): Editor {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const extensions = createMarkdownEditorExtensions();
    return new Editor({
        element,
        extensions: options.withListContinuation === false
            ? extensions.filter((extension) => extension.name !== 'listContinuation')
            : extensions,
        content,
    });
}

function pressBackspace(editor: Editor): boolean {
    const handled = editor.view.someProp('handleKeyDown', (handler) =>
        handler(editor.view, new KeyboardEvent('keydown', { key: 'Backspace' })),
    );
    return handled === true;
}

describe('listContinuation', () => {
    it('converts an empty nested ordered item into a parent-list continuation paragraph', () => {
        const editor = createEditor({
            type: 'doc',
            content: [
                {
                    type: 'orderedList',
                    attrs: { start: 1, type: null },
                    content: [
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Leverage an existing CLI/project' }],
                                },
                                {
                                    type: 'orderedList',
                                    attrs: { start: 1, type: null },
                                    content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
                                },
                            ],
                        },
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Implement CLI' }],
                                },
                            ],
                        },
                    ],
                },
            ],
        });

        try {
            editor.commands.setTextSelection(39);

            expect(pressBackspace(editor)).toBe(true);
            expect(editor.state.doc.toJSON()).toEqual({
                type: 'doc',
                content: [
                    {
                        type: 'orderedList',
                        attrs: { start: 1, type: null },
                        content: [
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [{ type: 'text', text: 'Leverage an existing CLI/project' }],
                                    },
                                    { type: 'paragraph' },
                                ],
                            },
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [{ type: 'text', text: 'Implement CLI' }],
                                    },
                                ],
                            },
                        ],
                    },
                    // Trailing cursor-target our schema appends after a top-level
                    // orderedList. Behaviorally inert; absent in upstream's schema.
                    { type: 'paragraph' },
                ],
            });
        } finally {
            editor.destroy();
        }
    });

    it('collapses an empty continuation paragraph back to the parent list item text', () => {
        const editor = createEditor({
            type: 'doc',
            content: [
                {
                    type: 'orderedList',
                    attrs: { start: 1, type: null },
                    content: [
                        {
                            type: 'listItem',
                            content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'fsdfsf' }] },
                                { type: 'paragraph' },
                            ],
                        },
                    ],
                },
            ],
        });

        try {
            editor.commands.setTextSelection(11);

            expect(pressBackspace(editor)).toBe(true);
            expect(editor.state.doc.toJSON()).toEqual({
                type: 'doc',
                content: [
                    {
                        type: 'orderedList',
                        attrs: { start: 1, type: null },
                        content: [
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [{ type: 'text', text: 'fsdfsf' }],
                                    },
                                ],
                            },
                        ],
                    },
                    // Trailing cursor-target our schema appends after a top-level
                    // orderedList. Behaviorally inert; absent in upstream's schema.
                    { type: 'paragraph' },
                ],
            });
            expect(editor.state.selection.from).toBe(9);
        } finally {
            editor.destroy();
        }
    });

    it('leaves non-empty nested ordered items to the default Backspace behavior', () => {
        const nonEmptyNestedItemDoc = {
            type: 'doc',
            content: [
                {
                    type: 'orderedList',
                    attrs: { start: 1, type: null },
                    content: [
                        {
                            type: 'listItem',
                            content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
                                {
                                    type: 'orderedList',
                                    attrs: { start: 1, type: null },
                                    content: [
                                        {
                                            type: 'listItem',
                                            content: [
                                                {
                                                    type: 'paragraph',
                                                    content: [{ type: 'text', text: 'Child' }],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const editor = createEditor(nonEmptyNestedItemDoc);
        const defaultEditor = createEditor(nonEmptyNestedItemDoc, { withListContinuation: false });

        try {
            editor.commands.setTextSelection(13);
            defaultEditor.commands.setTextSelection(13);

            pressBackspace(editor);
            pressBackspace(defaultEditor);

            expect(editor.state.doc.toJSON()).toEqual(defaultEditor.state.doc.toJSON());
            expect(editor.state.selection.from).toBe(defaultEditor.state.selection.from);
        } finally {
            editor.destroy();
            defaultEditor.destroy();
        }
    });
});
