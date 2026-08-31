import { AnimatorClip2D } from "../../laya/components/AnimatorClip2D";
import { AnimatorClip2DTimeline, NativeMovieClipTimeline } from "./NativeMovieClipTimeline";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { Sprite } from "./Sprite";

export type FlashFrameReference = number | string;
export type FlashFrameScript = (() => void) | null;
const MOVIE_CLIP_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash movie clips. */
export function isFlashMovieClip(value: unknown): value is MovieClip {
    return typeof value === "object" && value !== null && MOVIE_CLIP_VALUES.has(value);
}

function validateTimeline(timeline: NativeMovieClipTimeline): void {
    if (!timeline || !Number.isSafeInteger(timeline.totalFrames) || timeline.totalFrames < 1)
        throw new RangeError("MovieClip timeline totalFrames must be an integer >= 1");
    if (!Number.isSafeInteger(timeline.currentFrame) || timeline.currentFrame < 0 || timeline.currentFrame >= timeline.totalFrames)
        throw new RangeError("MovieClip timeline currentFrame is outside its frame bounds");
    if (typeof timeline.playing !== "boolean") throw new TypeError("MovieClip timeline playing must be boolean");
}

/** @internal Validates the authored frame-label publication before it reaches a native timeline. */
export function validateAuthoredMovieClipFrameLabels(value: Record<string, number>, totalFrames?: number): Readonly<Record<string, number>> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("MovieClip labels must be a plain object");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("MovieClip labels must be a plain object");
    const result: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || key.length === 0 || key.length > 128 || /[\u0000-\u001f\u007f]/.test(key))
            throw new TypeError("MovieClip label names must be nonempty, control-free, and at most 128 UTF-16 units");
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`MovieClip label '${key}' must be an enumerable data property`);
        const frame = descriptor.value;
        if (!Number.isSafeInteger(frame) || frame < 1 || (totalFrames !== undefined && frame > totalFrames))
            throw new RangeError(totalFrames === undefined
                ? `Frame label '${key}' must point to a positive safe integer frame`
                : `Frame label '${key}' points outside 1..${totalFrames}`);
        result[key] = frame;
    }
    return Object.freeze(result);
}

/** Flash timeline source API over an authenticated native AnimatorClip2D/.mc. */
export class MovieClip extends Sprite {
    private _nativeTimeline: NativeMovieClipTimeline | null = null;
    private _nativeAnimator: AnimatorClip2D | null = null;
    private _flashFrameLabels: Readonly<Record<string, number>> = Object.freeze(Object.create(null));
    private readonly _frameScripts = new Map<number, Exclude<FlashFrameScript, null>>();

    constructor() {
        super();
        MOVIE_CLIP_VALUES.add(this);
    }

    get flashFrameLabels(): Readonly<Record<string, number>> { return this._flashFrameLabels; }
    /** @internal Serialized authored-content seam; validated again against the native clip when bound. */
    set authoredFrameLabels(value: Record<string, number>) {
        this._flashFrameLabels = validateAuthoredMovieClipFrameLabels(value, this._nativeTimeline?.totalFrames);
    }
    get currentFrame(): number { return this._requireTimeline().currentFrame + 1; }
    get totalFrames(): number { return this._requireTimeline().totalFrames; }
    get framesLoaded(): number { return this.totalFrames; }
    get isPlaying(): boolean { return this._requireTimeline().playing; }
    get currentLabel(): string | null {
        const frame = this.currentFrame;
        let label: string | null = null;
        let labeledFrame = 0;
        for (const [candidate, candidateFrame] of Object.entries(this._flashFrameLabels)) {
            if (candidateFrame <= frame && candidateFrame > labeledFrame) {
                label = candidate;
                labeledFrame = candidateFrame;
            }
        }
        return label;
    }
    get currentFrameLabel(): string | null {
        const frame = this.currentFrame;
        return Object.keys(this._flashFrameLabels).find(label => this._flashFrameLabels[label] === frame) ?? null;
    }
    play(): void {
        const timeline = this._requireTimeline();
        timeline.play(timeline.currentFrame);
        if (this._nativeAnimator) this._nativeAnimator.autoPlay = true;
    }
    stop(): void {
        this._requireTimeline().stop();
        if (this._nativeAnimator) this._nativeAnimator.autoPlay = false;
    }
    gotoAndPlay(frame: FlashFrameReference, scene: string | null = null): void {
        this._rejectScene(scene); const timeline = this._requireTimeline();
        const resolved = this._resolveFrame(frame, timeline);
        timeline.play(resolved);
        if (this._nativeAnimator) this._nativeAnimator.autoPlay = true;
        this._runFrameScript(resolved);
    }
    gotoAndStop(frame: FlashFrameReference, scene: string | null = null): void {
        this._rejectScene(scene); const timeline = this._requireTimeline();
        const resolved = this._resolveFrame(frame, timeline);
        timeline.gotoAndStop(resolved);
        if (this._nativeAnimator) this._nativeAnimator.autoPlay = false;
        this._runFrameScript(resolved);
    }
    nextFrame(): void { this.gotoAndStop(Math.min(this.currentFrame + 1, this.totalFrames)); }
    prevFrame(): void { this.gotoAndStop(Math.max(this.currentFrame - 1, 1)); }

    override onAfterDeserialize(): void {
        super.onAfterDeserialize();
        const animator = this.getComponent(AnimatorClip2D);
        if (animator?.clip) {
            this._bindNativeTimeline(new AnimatorClip2DTimeline(animator), this._flashFrameLabels as Record<string, number>);
            this._nativeAnimator = animator;
        }
    }

    /** @internal Completes native timeline binding after component properties deserialize. */
    _onAnimatorClip2DReady(animator: AnimatorClip2D): void {
        if (animator.owner === this && animator.clip) {
            this._bindNativeTimeline(new AnimatorClip2DTimeline(animator), this._flashFrameLabels as Record<string, number>);
            this._nativeAnimator = animator;
        }
    }

    /** @internal Receives authenticated native frame transitions after pose application. */
    _onAnimatorClip2DFrame(animator: AnimatorClip2D, previousFrame: number, currentFrame: number, forward: boolean): void {
        if (animator !== this._nativeAnimator || this._nativeTimeline === null)
            return;
        this._runFrameTransition(previousFrame, currentFrame, forward);
    }

    /** @internal Atomic native factory seam: validation completes before state replacement. */
    _bindNativeTimeline(timeline: NativeMovieClipTimeline, labels: Record<string, number> = {}): void {
        validateTimeline(timeline);
        const validatedLabels = validateAuthoredMovieClipFrameLabels(labels, timeline.totalFrames);
        for (const frame of this._frameScripts.keys()) {
            if (frame >= timeline.totalFrames)
                throw new RangeError(`MovieClip frame script ${frame} is outside 0..${timeline.totalFrames - 1}`);
        }
        this._nativeTimeline = timeline;
        this._nativeAnimator = null;
        this._flashFrameLabels = validatedLabels;
    }

    addFrameScript(frame: number, script: FlashFrameScript, ...additional: Array<number | FlashFrameScript>): void {
        const values: Array<number | FlashFrameScript> = [frame, script, ...additional];
        if (values.length % 2 !== 0)
            throw new TypeError("MovieClip.addFrameScript requires frame/callback pairs");
        const timeline = this._requireTimeline();
        const changes: Array<readonly [number, FlashFrameScript]> = [];
        for (let index = 0; index < values.length; index += 2) {
            const target = values[index];
            const callback = values[index + 1];
            if (!Number.isSafeInteger(target) || (target as number) < 0 || (target as number) >= timeline.totalFrames)
                throw new RangeError(`MovieClip frame script ${String(target)} is outside 0..${timeline.totalFrames - 1}`);
            if (callback !== null && typeof callback !== "function")
                throw new TypeError("MovieClip frame script must be a function or null");
            changes.push([target as number, callback as FlashFrameScript]);
        }
        for (const [target, callback] of changes) {
            if (callback === null) this._frameScripts.delete(target);
            else this._frameScripts.set(target, callback);
        }
    }

    private _resolveFrame(frame: FlashFrameReference, timeline: NativeMovieClipTimeline): number {
        if (typeof frame === "string") {
            const labeledFrame = this._flashFrameLabels[frame];
            if (labeledFrame === undefined)
                throw new RangeError(`Unknown MovieClip frame label '${frame}'`);
            return labeledFrame - 1;
        }
        if (!Number.isSafeInteger(frame))
            throw new RangeError(`MovieClip frame ${String(frame)} must be a finite safe integer`);
        return Math.min(Math.max(frame, 1), timeline.totalFrames) - 1;
    }

    private _requireTimeline(): NativeMovieClipTimeline {
        if (!this._nativeTimeline) throw new UnsupportedFlashFeatureError("flash.display.MovieClip.nativeTimeline", "MovieClip requires AnimatorClip2D backed by a native .mc asset");
        validateTimeline(this._nativeTimeline);
        return this._nativeTimeline;
    }
    private _runFrameScript(frame: number): void {
        const callback = this._frameScripts.get(frame);
        if (callback) callback();
    }
    private _runFrameTransition(previousFrame: number, currentFrame: number, forward: boolean): void {
        const timeline = this._requireTimeline();
        if (previousFrame === currentFrame) return;
        const frames: number[] = [];
        if (forward) {
            if (currentFrame > previousFrame) {
                for (let frame = previousFrame + 1; frame <= currentFrame; frame++) frames.push(frame);
            } else {
                for (let frame = previousFrame + 1; frame < timeline.totalFrames; frame++) frames.push(frame);
                for (let frame = 0; frame <= currentFrame; frame++) frames.push(frame);
            }
        } else {
            if (currentFrame < previousFrame) {
                for (let frame = previousFrame - 1; frame >= currentFrame; frame--) frames.push(frame);
            } else {
                for (let frame = previousFrame - 1; frame >= 0; frame--) frames.push(frame);
                for (let frame = timeline.totalFrames - 1; frame >= currentFrame; frame--) frames.push(frame);
            }
        }
        for (const frame of frames) {
            this._runFrameScript(frame);
            if (this._nativeTimeline !== timeline || timeline.currentFrame !== currentFrame)
                break;
        }
    }
    private _rejectScene(scene: string | null): void {
        if (scene !== null) throw new UnsupportedFlashFeatureError("flash.display.MovieClip.sceneNavigation", "Flash scenes are not admitted");
    }

    override destroy(destroyChild = true): void {
        this._frameScripts.clear();
        this._nativeTimeline = null;
        this._nativeAnimator = null;
        super.destroy(destroyChild);
    }
}
