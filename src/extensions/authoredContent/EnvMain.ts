import { SwfXmlSourceAdapter } from "./offlineAdapters/SwfXmlSourceAdapter";
import { XflBundleSourceAdapter } from "./offlineAdapters/XflBundleSourceAdapter";
import { NativeAnimationClip2DWriter } from "./emit/NativeAnimationClip2DWriter";
import { NativeLayaEmitter } from "./emit/NativeLayaEmitter";

const SOURCE_EXTENSIONS = ["swfxml", "xflbundle"] as const;
const fs = IEditorEnv.require("fs") as {
    readonly promises: {
        writeFile(path: string, data: Uint8Array): Promise<void>;
    };
};
const path = IEditorEnv.require("path") as {
    parse(filePath: string): { name: string };
};

@IEditorEnv.regAssetImporter(SOURCE_EXTENSIONS, {
    version: 1,
    numParallelTasks: 1,
    runAfterRenaming: true
})
export class AuthoredContentImporter extends IEditorEnv.AssetImporter {
    async handleImport(): Promise<void> {
        this.clearLibrary();
        let adapter: SwfXmlSourceAdapter | XflBundleSourceAdapter;
        if (this.asset.ext === "swfxml")
            adapter = new SwfXmlSourceAdapter();
        else if (this.asset.ext === "xflbundle")
            adapter = new XflBundleSourceAdapter();
        else
            throw new Error(`AUTHORED_CONTENT_SOURCE_EXTENSION_UNSUPPORTED: ${this.asset.ext}`);
        const content = await adapter.parse(this.assetFullPath, this.settings);
        const baseName = path.parse(this.asset.fileName).name;
        const prefab = this.createSubAsset(`${baseName}.lh`, "prefab");
        const timeline = this.createSubAsset(`${baseName}.mc`, "timeline");
        const nativeTimeline = NativeLayaEmitter.createTimeline(content);
        let root: Laya.Sprite | undefined;
        try {
            root = NativeLayaEmitter.createPrefabRoot(content, timeline.id, nativeTimeline);
            await fs.promises.writeFile(
                timeline.fullPath,
                new Uint8Array(NativeAnimationClip2DWriter.write(nativeTimeline))
            );
            const hierarchy = IEditorEnv.HierarchyWriter.write(root, { creatingPrefab: true });
            hierarchy._$authoredContent = NativeLayaEmitter.createMetadata(content, timeline.id);
            await IEditorEnv.utils.writeJsonAsync(prefab.fullPath, hierarchy);
        }
        finally {
            root?.destroy();
            nativeTimeline.destroy();
        }
    }
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
