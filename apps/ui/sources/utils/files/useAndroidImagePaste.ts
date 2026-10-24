import * as React from 'react';
import { findNodeHandle, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

import type { PickedAttachment } from '@/components/sessions/attachments/AttachmentFilePicker.types';
import { Modal } from '@/modal';
import { t } from '@/text';
import { sanitizePickedName } from './pickedFileNormalization';

// The native receiver snapshots temporary keyboard URI grants into the same cache used by pickers.
type ImagePasteEvent = Readonly<{
    target: number;
    attachment?: Extract<PickedAttachment, { kind: 'native' }>;
    error?: string;
}>;

type ImagePasteModule = Readonly<{
    setImagePasteTarget?: (target: number, enabled: boolean) => Promise<void>;
    addListener: (event: 'imagePaste', listener: (event: ImagePasteEvent) => void) => { remove: () => void };
}>;

export function useAndroidImagePaste(
    inputRef: React.RefObject<Parameters<typeof findNodeHandle>[0]>,
    onImagesPasted: ((images: readonly PickedAttachment[]) => void) | undefined,
): void {
    React.useEffect(() => {
        if (Platform.OS !== 'android' || !onImagesPasted) return;
        const target = findNodeHandle(inputRef.current);
        if (target == null) return;
        const native = requireOptionalNativeModule<ImagePasteModule>('HappierFileActions');
        const showError = () => Modal.alert(t('attachments.alerts.noClipboardImageTitle'), t('attachments.alerts.noClipboardImageBody'));
        if (!native?.setImagePasteTarget) {
            console.warn('[imagePaste] Android image paste requires a native build with the image receiver');
            return;
        }
        const subscription = native.addListener('imagePaste', (event) => {
            if (event.target !== target) return;
            if (event.error) showError();
            else if (event.attachment) {
                onImagesPasted([{ ...event.attachment, name: sanitizePickedName(event.attachment.name, 'image') }]);
            }
        });
        void native.setImagePasteTarget(target, true).catch(showError);
        return () => {
            subscription.remove();
            void native.setImagePasteTarget?.(target, false).catch((error: unknown) => {
                console.warn('[imagePaste] Failed to detach Android image receiver', error);
            });
        };
    }, [inputRef, onImagesPasted]);
}
