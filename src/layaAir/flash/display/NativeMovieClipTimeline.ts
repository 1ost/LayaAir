import { AnimatorClip2D } from "../../laya/components/AnimatorClip2D";

/** Zero-based, native-only timeline boundary. */
export interface NativeMovieClipTimeline {
    readonly totalFrames: number;
    readonly currentFrame: number;
    readonly playing: boolean;
    play(frame: number): void;
    stop(): void;
    gotoAndStop(frame: number): void;
}

function frameCount(animator: AnimatorClip2D): number {
    const clip = animator.clip;
    if (!clip) throw new Error("AnimatorClip2DTimeline requires a native .mc AnimationClip2D");
    const duration = clip.duration();
    const frameRate = clip._frameRate;
    if (!Number.isFinite(duration) || duration <= 0) throw new RangeError("AnimationClip2D duration must be finite and > 0");
    if (!Number.isFinite(frameRate) || frameRate <= 0) throw new RangeError("AnimationClip2D frameRate must be finite and > 0");
    const frames = Math.round(duration * frameRate);
    if (!Number.isSafeInteger(frames) || frames < 1) throw new RangeError("Native MovieClip timeline must contain at least one frame");
    return frames;
}

/** Flash frame controls over Laya's canonical AnimatorClip2D/.mc component. */
export class AnimatorClip2DTimeline implements NativeMovieClipTimeline {
    private readonly _totalFrames: number;
    constructor(private readonly _animator: AnimatorClip2D) { this._totalFrames = frameCount(_animator); }
    get totalFrames(): number { return this._totalFrames; }
    get currentFrame(): number {
        const time = this._animator.normalizedTime;
        if (!Number.isFinite(time)) throw new RangeError("AnimatorClip2D normalizedTime must be finite");
        return Math.min(this.totalFrames - 1, Math.max(0, Math.floor(time * this.totalFrames + 1e-7)));
    }
    get playing(): boolean { return this._animator.isPlaying; }
    play(frame: number): void { this._animator.play(this._normalizedFrame(this._validateFrame(frame))); }
    stop(): void { this._animator.stop(); }
    gotoAndStop(frame: number): void { this._animator.gotoAndStopByFrame(this._validateFrame(frame)); }
    private _validateFrame(frame: number): number {
        if (!Number.isSafeInteger(frame) || frame < 0 || frame >= this.totalFrames)
            throw new RangeError(`Native timeline frame ${frame} is outside 0..${this.totalFrames - 1}`);
        return frame;
    }
    private _normalizedFrame(frame: number): number { return frame / this.totalFrames; }
}
