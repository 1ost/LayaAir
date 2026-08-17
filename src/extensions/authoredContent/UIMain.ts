const SOURCE_EXTENSIONS = ["swfxml", "xflbundle"] as const;

class AuthoredContentRegistration {
    @IEditor.onLoad
    onLoad(): void {
        Editor.extensionManager.setFileType(SOURCE_EXTENSIONS, "Authored Content Source");
        Editor.extensionManager.setFileIcon(SOURCE_EXTENSIONS, "editorResources/authored-content-source.svg");
        Editor.extensionManager.setFileThumbnail(SOURCE_EXTENSIONS, "AuthoredContentThumbnail");
    }
}
@IEditor.regClass()
export class AuthoredContentImportSettings {
    @IEditor.property(Number)
    scale = 1;
}

@IEditor.inspectorLayout("asset")
export class AuthoredContentInspector extends IEditor.MetaDataInspectorLayout {
    constructor() {
        super(AuthoredContentImportSettings);
    }

    accept(asset: IEditor.IAssetInfo): boolean {
        return SOURCE_EXTENSIONS.includes(asset.ext as any);
    }

    async onApply(): Promise<void> {
        await super.onApply();
        Editor.assetDb.reimport(this._assets);
    }
}

@IEditor.panel("AuthoredContentPreview", { usage: "preview", order: -10 })
export class AuthoredContentPreview extends IEditor.EditorPanel implements IEditor.IPreviewPanel {
    private canvas?: IEditor.IRender3DCanvas;

    async create(): Promise<void> {
        this._panel = new gui.Widget();
    }

    accept(asset: IEditor.IAssetInfo): boolean {
        return SOURCE_EXTENSIONS.includes(asset.ext as any);
    }

    async refresh(asset: IEditor.IAssetInfo, canvas: IEditor.IRender3DCanvas, _resData: any | null): Promise<void> {
        if (this.canvas)
            await this.canvas.releaseObject();
        this.canvas = canvas;
        await canvas.createObject("AuthoredContentPreviewScene", "setAssetById", asset.id);
    }

    clearPreview(): void {
        const canvas = this.canvas;
        this.canvas = undefined;
        if (canvas)
            void canvas.releaseObject();
    }

    onDestroy(): void {
        this.clearPreview();
    }
}
