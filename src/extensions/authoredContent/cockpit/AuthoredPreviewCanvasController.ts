import { AuthoredNativePreviewTarget } from "./AuthoredContentCockpitTypes";

export type AuthoredPreviewPresentation = "presented" | "stale" | "cleared";

/** Serializes every mutation of the one shared IDE preview canvas. */
export class AuthoredPreviewCanvasController {
    private mutationTail: Promise<void> = Promise.resolve();
    private destroyed = false;
    private _assetId?: string;

    constructor(
        private readonly canvas: IEditor.IRender3DCanvas,
        private readonly previewSceneClass: string
    ) {}

    get assetId(): string | undefined {
        return this._assetId;
}
    async resolveAndPresent(
        resolveTarget: () => Promise<AuthoredNativePreviewTarget>,
        isDesired: () => boolean
    ): Promise<AuthoredPreviewPresentation> {
        const target = await resolveTarget();
        if (!target?.assetId)
            throw new Error("Scene bridge returned no native asset id");
        if (this.destroyed || !isDesired())
            return "stale";
        return this.enqueue(async () => {
            if (this.destroyed || !isDesired())
                return "stale";
            if (this.canvas.ready) {
                await this.canvas.releaseObject();
                this._assetId = undefined;
            }
            if (this.destroyed || !isDesired())
                return "stale";
            await this.canvas.createObject(this.previewSceneClass, "setAssetById", target.assetId);
            this._assetId = target.assetId;
            if (this.destroyed || !isDesired()) {
                // This controller still owns the mutation lock, so this can only
                // release the stale object created directly above, never a newer one.
                if (this.canvas.ready)
                    await this.canvas.releaseObject();
                this._assetId = undefined;
                return "stale";
            }
            return "presented";
        });
    }

    clear(isDesired: () => boolean): Promise<AuthoredPreviewPresentation> {
        return this.enqueue(async () => {
            if (this.destroyed || !isDesired())
                return "stale";
            if (this.canvas.ready)
                await this.canvas.releaseObject();
            this._assetId = undefined;
            return "cleared";
        });
    }

    destroy(): Promise<void> {
        this.destroyed = true;
        return this.enqueue(async () => {
            if (this.canvas.ready)
                await this.canvas.releaseObject();
            this._assetId = undefined;
        });
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.mutationTail.then(operation, operation);
        this.mutationTail = result.then(() => undefined, () => undefined);
        return result;
    }
}
