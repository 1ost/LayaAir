import {
    createNativeAssetTransactionHost,
    NativeAssetImporterTransaction,
    NativeAssetTransactionHost
} from "./NativeAssetImporterTransaction";

export interface EditorSubAssetIdentity {
    readonly id: string;
    readonly fileName: string;
    readonly fullPath: string;
}

export interface EditorSubAssetLibrary {
    clearLibrary(): void;
    createSubAsset(fileName: string, id?: string): EditorSubAssetIdentity;
}

interface EditorSubAssetSnapshot extends EditorSubAssetIdentity {
    readonly bytes: Uint8Array;
}

/** Captures every registered subasset before clearLibrary performs deletion. */
export async function captureEditorSubAssetState(
    subAssets: ReadonlyArray<EditorSubAssetIdentity>,
    host: NativeAssetTransactionHost = createNativeAssetTransactionHost()
): Promise<ReadonlyArray<EditorSubAssetSnapshot>> {
    const ids = new Set<string>();
    const names = new Set<string>();
    const snapshots: EditorSubAssetSnapshot[] = [];
    for (const subAsset of [...subAssets].sort((left, right) => compareText(left.fileName, right.fileName))) {
        if (!subAsset.id || !subAsset.fileName || !subAsset.fullPath)
            fail("IDENTITY_INVALID", "Prior subasset identity is incomplete.");
        if (ids.has(subAsset.id) || names.has(subAsset.fileName))
            fail("IDENTITY_COLLISION", subAsset.fileName);
        ids.add(subAsset.id);
        names.add(subAsset.fileName);
        const stat = await host.fs.promises.lstat(subAsset.fullPath);
        if (!stat.isFile())
            fail("FILE_NOT_REGULAR", subAsset.fullPath);
        snapshots.push(Object.freeze({
            id: subAsset.id,
            fileName: subAsset.fileName,
            fullPath: subAsset.fullPath,
            bytes: new Uint8Array(await host.fs.promises.readFile(subAsset.fullPath))
        }));
    }
    return Object.freeze(snapshots);
}

/**
 * Restores both editor identities and their exact prior bytes after a failed
 * import. File restoration uses the same authenticated real transaction and a
 * disjoint recovery root so the original failure journal is never erased.
 */
export async function restoreEditorSubAssetState(
    library: EditorSubAssetLibrary,
    snapshots: ReadonlyArray<EditorSubAssetSnapshot>,
    tempPath: string,
    host: NativeAssetTransactionHost = createNativeAssetTransactionHost()
): Promise<void> {
    library.clearLibrary();
    const targets = new Map<string, string>();
    for (const snapshot of snapshots) {
        const restored = library.createSubAsset(snapshot.fileName, snapshot.id);
        if (restored.id !== snapshot.id || restored.fileName !== snapshot.fileName)
            fail("IDENTITY_RESTORE_MISMATCH", snapshot.fileName);
        targets.set(snapshot.fileName, restored.fullPath);
    }
    if (snapshots.length === 0)
        return;

    const transaction = new NativeAssetImporterTransaction(tempPath, targets, undefined, host);
    try {
        for (const snapshot of snapshots)
            await transaction.stage(snapshot.fileName, new Uint8Array(snapshot.bytes));
        await transaction.commit();
    }
    catch (error) {
        try {
            await transaction.rollback();
        }
        catch (rollbackError) {
            throw aggregateFailure(
                "AUTHORED_CONTENT_EDITOR_STATE_RECOVERY_FAILED",
                [error, rollbackError]
            );
        }
        throw error;
    }
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function aggregateFailure(message: string, errors: ReadonlyArray<unknown>): Error & { readonly errors: ReadonlyArray<unknown> } {
    return Object.assign(new Error(message), { errors: Object.freeze([...errors]) });
}

function fail(code: string, detail: string): never {
    throw new Error(`AUTHORED_CONTENT_EDITOR_STATE_${code}: ${detail}`);
}
