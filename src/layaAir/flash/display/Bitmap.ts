import { DisplayObject } from "./DisplayObject";
import { runAdmittedNodeMutation } from "../../laya/display/NodeMutationTransaction";
import { RepaintFlag } from "../../laya/display/SpriteConst";
import { acquireBitmapDataTexture, BitmapData, isFlashBitmapData, observeBitmapData } from "./BitmapData";
import { PixelSnapping } from "./PixelSnapping";

const BITMAP_VALUES = new WeakSet<object>();
const destroyCanonicalBitmap = DisplayObject.prototype.destroy;

/** @internal Nominal guard for authenticated runtime `is` checks. */
export function isFlashBitmap(value: unknown): value is Bitmap {
    return typeof value === "object" && value !== null && BITMAP_VALUES.has(value);
}

/** Source-shaped `flash.display.Bitmap` backed by a native Laya texture. */
export class Bitmap extends DisplayObject {
    private bitmapDataValue: BitmapData | null = null;
    private pixelSnappingValue: string = PixelSnapping.AUTO;
    private smoothingValue: boolean = false;
    private stopObserving: (() => void) | null = null;
    private readonly refreshBitmapData = (): void => this.refreshTexture();

    constructor(bitmapData?: BitmapData | null, pixelSnapping?: string, smoothing?: boolean) {
        super();
        BITMAP_VALUES.add(this);
        this.pixelSnapping = arguments.length < 2 ? PixelSnapping.AUTO : pixelSnapping!;
        this.smoothingValue = arguments.length < 3 ? false : Boolean(smoothing);
        this.bitmapData = arguments.length < 1 || bitmapData === undefined ? null : bitmapData;
    }

    get bitmapData(): BitmapData | null { return this.bitmapDataValue; }
    set bitmapData(value: BitmapData | null) {
        if (value !== null && !isFlashBitmapData(value)) throw new TypeError("bitmapData must be a BitmapData or null");
        if (value === this.bitmapDataValue) return;
        this.stopObserving?.();
        this.stopObserving = null;
        this.bitmapDataValue = value;
        if (value !== null) this.stopObserving = observeBitmapData(value, this.refreshBitmapData);
        this.refreshTexture();
    }

    get pixelSnapping(): string { return this.pixelSnappingValue; }
    set pixelSnapping(value: string) {
        const snapping = String(value);
        if (snapping !== PixelSnapping.AUTO && snapping !== PixelSnapping.ALWAYS && snapping !== PixelSnapping.NEVER)
            throw new TypeError("pixelSnapping must be auto, always, or never");
        this.pixelSnappingValue = snapping;
    }

    get smoothing(): boolean { return this.smoothingValue; }
    set smoothing(value: boolean) {
        this.smoothingValue = Boolean(value);
        this.refreshTexture();
    }

    override destroy(destroyChild = true): void {
        runAdmittedNodeMutation(this, "destroyFlashDisplayObject", () => {
            this.stopObserving?.();
            this.stopObserving = null;
            this.bitmapDataValue = null;
            this.texture = null;
            destroyCanonicalBitmap.call(this, destroyChild);
        });
    }

    private refreshTexture(): void {
        this.texture = this.bitmapDataValue
            ? acquireBitmapDataTexture(this.bitmapDataValue, this.smoothingValue)
            : null;
        this.repaint(RepaintFlag.Graphics);
    }
}
