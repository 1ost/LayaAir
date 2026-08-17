import { AnimatorClip2D } from "../../../../../layaAir/laya/components/AnimatorClip2D";
import { AnimatorClip2DTimeline, NativeMovieClipTimeline } from "../../native/NativeMovieClipTimeline";
import { UnsupportedFlashFeatureError } from "../../UnsupportedFlashFeatureError";
import { Sprite } from "./Sprite";

export type FlashFrameReference = number | string;
const LABEL = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/;

function validateTimeline(timeline: NativeMovieClipTimeline): void {
    if (!timeline || !Number.isSafeInteger(timeline.totalFrames) || timeline.totalFrames < 1)
        throw new RangeError("MovieClip timeline totalFrames must be an integer >= 1");
    if (!Number.isSafeInteger(timeline.currentFrame) || timeline.currentFrame < 0 || timeline.currentFrame >= timeline.totalFrames)
        throw new RangeError("MovieClip timeline currentFrame is outside its frame bounds");
    if (typeof timeline.playing !== "boolean") throw new TypeError("MovieClip timeline playing must be boolean");
}

function validateLabels(value: Record<string, number>, totalFrames: number): Readonly<Record<string, number>> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("MovieClip labels must be a plain object");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("MovieClip labels must be a plain object");
    const result: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || !LABEL.test(key)) throw new TypeError("MovieClip label names must be stable identifiers");
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`MovieClip label '${key}' must be an enumerable data property`);
        const frame = descriptor.value;
        if (!Number.isSafeInteger(frame) || frame < 1 || frame > totalFrames)
            throw new RangeError(`Frame label '${key}' points outside 1..${totalFrames}`);
        result[key] = frame;
    }
    return Object.freeze(result);
}

/** Flash timeline source API over an authenticated native AnimatorClip2D/.mc. */
export class MovieClip extends Sprite {
    private _nativeTimeline: NativeMovieClipTimeline | null = null;
    private _flashFrameLabels: Readonly<Record<string, number>> = Object.freeze(Object.create(null));

    get flashFrameLabels(): Readonly<Record<string, number>> { return this._flashFrameLabels; }
    get currentFrame(): number { return this._requireTimeline().currentFrame + 1; }
    get totalFrames(): number { return this._requireTimeline().totalFrames; }
    get framesLoaded(): number { return this.totalFrames; }
    get isPlaying(): boolean { return this._requireTimeline().playing; }
    get currentLabel(): string | null {
        const frame = this.currentFrame;
        return Object.keys(this._flashFrameLabels).find(label => this._flashFrameLabels[label] === frame) ?? null;
    }
    get currentFrameLabel(): string | null { return this.currentLabel; }
    play(): void { const timeline = this._requireTimeline(); timeline.play(timeline.currentFrame); }
    stop(): void { this._requireTimeline().stop(); }
    gotoAndPlay(frame: FlashFrameReference, scene: string | null = null): void {
        this._rejectScene(scene); const timeline = this._requireTimeline(); timeline.play(this._resolveFrame(frame, timeline));
    }
    gotoAndStop(frame: FlashFrameReference, scene: string | null = null): void {
        this._rejectScene(scene); const timeline = this._requireTimeline(); timeline.gotoAndStop(this._resolveFrame(frame, timeline));
    }
    nextFrame(): void { this.gotoAndStop(Math.min(this.currentFrame + 1, this.totalFrames)); }
    prevFrame(): void { this.gotoAndStop(Math.max(this.currentFrame - 1, 1)); }

    override onAfterDeserialize(): void {
        super.onAfterDeserialize();
        const animator = this.getComponent(AnimatorClip2D);
        if (animator?.clip) this._bindNativeTimeline(new AnimatorClip2DTimeline(animator), this._flashFrameLabels as Record<string, number>);
    }

    /** @internal Atomic native factory seam: validation completes before state replacement. */
    _bindNativeTimeline(timeline: NativeMovieClipTimeline, labels: Record<string, number> = {}): void {
        validateTimeline(timeline);
        const validatedLabels = validateLabels(labels, timeline.totalFrames);
        this._nativeTimeline = timeline;
        this._flashFrameLabels = validatedLabels;
    }

    private _resolveFrame(frame: FlashFrameReference, timeline: NativeMovieClipTimeline): number {
        const oneBased = typeof frame === "string" ? this._flashFrameLabels[frame] : frame;
        if (!Number.isSafeInteger(oneBased) || oneBased < 1 || oneBased > timeline.totalFrames)
            throw new RangeError(typeof frame === "string" && oneBased == null
                ? `Unknown MovieClip frame label '${frame}'`
                : `MovieClip frame ${String(frame)} is outside 1..${timeline.totalFrames}`);
        return oneBased - 1;
    }

    private _requireTimeline(): NativeMovieClipTimeline {
        if (!this._nativeTimeline) throw new UnsupportedFlashFeatureError("flash.display.MovieClip.nativeTimeline", "MovieClip requires AnimatorClip2D backed by a native .mc asset");
        validateTimeline(this._nativeTimeline);
        return this._nativeTimeline;
    }
    private _rejectScene(scene: string | null): void {
        if (scene !== null) throw new UnsupportedFlashFeatureError("flash.display.MovieClip.sceneNavigation", "Flash scenes are not admitted");
    }
}
