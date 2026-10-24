type DataTransferItemLike = Readonly<{
    kind?: string;
    getAsFile?: () => File | null;
}>;

type DataTransferFileListLike = Iterable<File> | ArrayLike<File>;

type DataTransferLike = Readonly<{
    items?: Iterable<DataTransferItemLike> | ArrayLike<DataTransferItemLike> | null;
    files?: DataTransferFileListLike | null;
}> | null | undefined;

function arrayFromMaybeArrayLike<T>(value: Iterable<T> | ArrayLike<T> | null | undefined): T[] {
    if (!value) return [];
    return Array.from(value as Iterable<T> | ArrayLike<T>);
}

export function extractWebAttachmentFilesFromDataTransfer(dataTransfer: DataTransferLike): readonly File[] {
    if (!dataTransfer) return [];

    const files: File[] = [];
    const seen = new Set<File>();
    const pushFile = (file: File | null | undefined) => {
        if (!file) return;
        // Clipboard images may share name, size and timestamps while containing different pixels.
        if (seen.has(file)) return;
        seen.add(file);
        files.push(file);
    };

    for (const item of arrayFromMaybeArrayLike(dataTransfer.items)) {
        if (item?.kind !== 'file') continue;
        pushFile(typeof item.getAsFile === 'function' ? item.getAsFile() : null);
    }

    if (files.length === 0) {
        for (const file of arrayFromMaybeArrayLike(dataTransfer.files)) {
            pushFile(file);
        }
    }

    return files;
}
