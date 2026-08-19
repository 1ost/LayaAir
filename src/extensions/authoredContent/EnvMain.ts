import { SwfXmlSourceAdapter } from "./offlineAdapters/SwfXmlSourceAdapter";
import { XflBundleSourceAdapter } from "./offlineAdapters/XflBundleSourceAdapter";
import { readAuthenticatedResourcePayloads } from "./core/SourceAdapter";
import { NativeAnimationClip2DWriter } from "./emit/NativeAnimationClip2DWriter";
import { NativeLayaEmitter } from "./emit/NativeLayaEmitter";
import {
    NativeAuthoredContentTransaction,
    prepareNativeLayaAuthoredContentBundle,
    writeNativeLayaAuthoredContentTransaction
} from "./emit/NativeLayaHierarchyWriter";

const SOURCE_EXTENSIONS = ["swfxml", "xflbundle"] as const;
const fs = IEditorEnv.require("fs") as {
    readonly promises: {
        lstat(path: string): Promise<{ isFile(): boolean }>;
        mkdir(path: string, options: { recursive: boolean }): Promise<void>;
        rename(from: string, to: string): Promise<void>;
        rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
        writeFile(path: string, data: Uint8Array): Promise<void>;
    };
};
const path = IEditorEnv.require("path") as {
    dirname(filePath: string): string;
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
        const nativeTimeline = NativeLayaEmitter.createTimeline(content);
        let root: Laya.Sprite | undefined;
        try {
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
        finally {
            root?.destroy();
            nativeTimeline.destroy();
        }
    }
}

class NativeAssetImporterTransaction implements NativeAuthoredContentTransaction {
    private readonly root: string;
    private readonly staged = new Map<string, string>();
    private readonly backups = new Map<string, string>();
    private readonly committedTargets = new Set<string>();
    private initialized = false;

    constructor(tempPath: string, private readonly targets: ReadonlyMap<string, string>) {
        this.root = path.join(tempPath, "authored-content-native-transaction");
    }

    async stage(relativePath: string, bytes: Uint8Array): Promise<void> {
        const target = this.targets.get(relativePath);
        if (!target)
            throw new Error(`AUTHORED_CONTENT_NATIVE_TRANSACTION_TARGET_UNKNOWN: ${relativePath}`);
        if (this.staged.has(relativePath))
            throw new Error(`AUTHORED_CONTENT_NATIVE_TRANSACTION_STAGE_DUPLICATE: ${relativePath}`);
        await this.initialize();
        const stagePath = path.join(this.root, "staged", ...relativePath.split("/"));
        await fs.promises.mkdir(path.dirname(stagePath), { recursive: true });
        await fs.promises.writeFile(stagePath, new Uint8Array(bytes));
        this.staged.set(relativePath, stagePath);
    }

    async commit(): Promise<void> {
        if (this.staged.size !== this.targets.size)
            throw new Error("AUTHORED_CONTENT_NATIVE_TRANSACTION_CLOSURE_MISMATCH");
        let index = 0;
        for (const [relativePath, target] of [...this.targets].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
            const stagePath = this.staged.get(relativePath)!;
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            if (await fileExists(target)) {
                const backup = path.join(this.root, "backup", `${index++}`);
                await fs.promises.mkdir(path.dirname(backup), { recursive: true });
                await fs.promises.rename(target, backup);
                this.backups.set(target, backup);
            }
            await fs.promises.rename(stagePath, target);
            this.committedTargets.add(target);
        }
        await fs.promises.rm(this.root, { recursive: true, force: true });
        this.backups.clear();
        this.committedTargets.clear();
    }

    async rollback(): Promise<void> {
        for (const target of this.committedTargets)
            await fs.promises.rm(target, { recursive: false, force: true });
        for (const [target, backup] of this.backups)
            await fs.promises.rename(backup, target);
        await fs.promises.rm(this.root, { recursive: true, force: true });
        this.backups.clear();
        this.committedTargets.clear();
        this.staged.clear();
    }

    private async initialize(): Promise<void> {
        if (this.initialized)
            return;
        await fs.promises.rm(this.root, { recursive: true, force: true });
        await fs.promises.mkdir(this.root, { recursive: true });
        this.initialized = true;
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        return (await fs.promises.lstat(filePath)).isFile();
    }
    catch {
        return false;
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
