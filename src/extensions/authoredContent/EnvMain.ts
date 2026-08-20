import { SwfXmlSourceAdapter } from "./offlineAdapters/SwfXmlSourceAdapter";
import { XflBundleSourceAdapter } from "./offlineAdapters/XflBundleSourceAdapter";
import { readAuthenticatedResourcePayloads } from "./core/SourceAdapter";
import { NativeAnimationClip2DWriter } from "./emit/NativeAnimationClip2DWriter";
import { NativeAssetImporterTransaction } from "./emit/NativeAssetImporterTransaction";
import { captureEditorSubAssetState, restoreEditorSubAssetState } from "./emit/EditorSubAssetState";
import { NativeLayaEmitter } from "./emit/NativeLayaEmitter";
import {
    prepareNativeLayaAuthoredContentBundle,
    writeNativeLayaAuthoredContentTransaction
} from "./emit/NativeLayaHierarchyWriter";

const SOURCE_EXTENSIONS = ["swfxml", "xflbundle"] as const;
const path = IEditorEnv.require("path") as {
    join(...parts: string[]): string;
    parse(filePath: string): { name: string };
};
const crypto = IEditorEnv.require("crypto") as {
    createHash(algorithm: "sha256"): { update(bytes: Uint8Array): any; digest(encoding: "hex"): string };
};

@IEditorEnv.regAssetImporter(SOURCE_EXTENSIONS, {
    version: 1,
    numParallelTasks: 1,
    runAfterRenaming: true
})
export class AuthoredContentImporter extends IEditorEnv.AssetImporter {
    async handleImport(): Promise<void> {
        let adapter: SwfXmlSourceAdapter | XflBundleSourceAdapter;
        if (this.asset.ext === "swfxml")
            adapter = new SwfXmlSourceAdapter();
        else if (this.asset.ext === "xflbundle")
            adapter = new XflBundleSourceAdapter();
        else
            throw new Error(`AUTHORED_CONTENT_SOURCE_EXTENSION_UNSUPPORTED: ${this.asset.ext}`);
        const content = await adapter.parse(this.assetFullPath, this.settings);
        const resourcePayloads = await readAuthenticatedResourcePayloads(this.assetFullPath, content);
        const baseName = path.parse(this.asset.fileName).name;
        const prefabPath = `${baseName}.lh`;
        const timelinePath = `${baseName}.mc`;
        const priorEditorState = await captureEditorSubAssetState(this.subAssets);
        let libraryChanged = false;
        let nativeTimeline: Laya.AnimationClip2D | undefined;
        let root: Laya.Sprite | undefined;
        try {
            libraryChanged = true;
            this.clearLibrary();
            const prefab = this.createSubAsset(`${baseName}.lh`, "prefab");
            const timeline = this.createSubAsset(`${baseName}.mc`, "timeline");
            const resourceAssets = new Map(content.resources.map(resource => [
                resource.id,
                this.createSubAsset(resource.outputPath, `resource:${resource.id}`)
            ]));
            const resourceAssetIds = new Map(
                [...resourceAssets].map(([id, asset]) => [id, asset.id])
            );
            nativeTimeline = NativeLayaEmitter.createTimeline(content);
            root = NativeLayaEmitter.createPrefabRoot(content, timeline.id, nativeTimeline, resourceAssetIds);
            const timelineBytes = new Uint8Array(NativeAnimationClip2DWriter.write(nativeTimeline));
            const hierarchy = IEditorEnv.HierarchyWriter.write(root, { creatingPrefab: true });
            const bundle = await prepareNativeLayaAuthoredContentBundle({
                content,
                hierarchy,
                prefabPath,
                timelinePath,
                timelineAssetId: timeline.id,
                timelineBytes,
                resourceAssetIds,
                resourcePayloads,
                sha256: bytes => crypto.createHash("sha256").update(bytes).digest("hex")
            });
            const targets = new Map<string, string>([
                [prefabPath, prefab.fullPath],
                [timelinePath, timeline.fullPath],
                ...content.resources.map(resource => [resource.outputPath, resourceAssets.get(resource.id)!.fullPath] as [string, string])
            ]);
            await writeNativeLayaAuthoredContentTransaction(
                bundle,
                new NativeAssetImporterTransaction(this.tempPath, targets)
            );
        }
        catch (error) {
            if (libraryChanged) {
                try {
                    await restoreEditorSubAssetState(
                        this,
                        priorEditorState,
                        path.join(this.tempPath, "editor-state-recovery")
                    );
                }
                catch (recoveryError) {
                    throw aggregateFailure(
                        "AUTHORED_CONTENT_EDITOR_STATE_RECOVERY_FAILED",
                        [error, recoveryError]
                    );
                }
            }
            throw error;
        }
        finally {
            root?.destroy();
            nativeTimeline?.destroy();
        }
    }
}

function aggregateFailure(message: string, errors: ReadonlyArray<unknown>): Error & { readonly errors: ReadonlyArray<unknown> } {
    return Object.assign(new Error(message), { errors: Object.freeze([...errors]) });
}

@IEditorEnv.regClass()
export class AuthoredContentThumbnail extends IEditorEnv.AssetThumbnail {
    async generate(_asset: IEditorEnv.IAssetInfo) {
        return null;
    }
}

@IEditorEnv.regClass()
export class AuthoredContentPreviewScene extends IEditorEnv.AssetPreview {
    private instance?: Laya.Node;

    async setAssetById(assetId: string): Promise<void> {
        const asset = EditorEnv.assetMgr.getAsset(assetId);
        if (!asset)
            throw new Error(`AUTHORED_CONTENT_SOURCE_ASSET_MISSING: ${assetId}`);
        await this.setAsset(asset);
    }

    async setAsset(asset: IEditorEnv.IAssetInfo): Promise<void> {
        this.instance?.destroy();
        this.instance = undefined;
        const prefabChild = asset.children.find(child => child.ext === "lh");
        if (!prefabChild)
            throw new Error("AUTHORED_CONTENT_NATIVE_PREFAB_MISSING");
        const prefab = await Laya.loader.load(`res://${prefabChild.id}`, Laya.Loader.HIERARCHY) as Laya.Prefab;
        this.instance = prefab.create();
        this.sprite.addChild(this.instance);
        this.renderTarget = this.sprite;
    }

    onReset(): void {
        this.instance?.destroy();
        this.instance = undefined;
        this.renderTarget = null;
    }
}
