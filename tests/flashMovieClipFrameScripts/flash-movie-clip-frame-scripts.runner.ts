import assert from "node:assert/strict";
import test from "node:test";

import { ILaya } from "../../src/layaAir/ILaya";
import type { FlashFrameScript } from "../../src/layaAir/flash";
import { MovieClip } from "../../src/layaAir/flash/display/MovieClip";
import type { NativeMovieClipTimeline } from "../../src/layaAir/flash/display/NativeMovieClipTimeline";
import { AnimationClip2D } from "../../src/layaAir/laya/components/AnimationClip2D";
import { AnimatorClip2D } from "../../src/layaAir/laya/components/AnimatorClip2D";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import "../../src/layaAir/laya/ModuleDef";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
ILaya.stage = {
    _graphicUpdateList: new Set(),
    _tranMatrixUpdateList: new Set(),
    _componentDriver: { _toDestroys: new Set() },
} as any;
ILaya.timer = { delta: 0 } as any;

class TestTimeline implements NativeMovieClipTimeline {
    currentFrame = 0;
    playing = false;
    constructor(readonly totalFrames: number) {}
    play(frame: number): void { this.currentFrame = frame; this.playing = true; }
    stop(): void { this.playing = false; }
    gotoAndStop(frame: number): void { this.currentFrame = frame; this.playing = false; }
}

test("addFrameScript uses zero-based Flash frames and validates pair updates atomically", () => {
    const movie = new MovieClip();
    const timeline = new TestTimeline(4);
    movie._bindNativeTimeline(timeline);
    const calls: string[] = [];
    const first: FlashFrameScript = () => calls.push("first");
    movie.addFrameScript(0, first, 3, () => calls.push("last"));

    movie.gotoAndStop(1);
    movie.gotoAndPlay(4);
    assert.deepEqual(calls, ["first", "last"]);
    assert.equal(movie.isPlaying, true);

    assert.throws(() => movie.addFrameScript(2, () => calls.push("new"), 3), /frame\/callback pairs/);
    assert.throws(() => movie.addFrameScript(2, "not a function" as any), /function or null/);
    assert.throws(() => movie.addFrameScript(4, () => undefined), /outside 0\.\.3/);
    movie.gotoAndStop(3);
    assert.deepEqual(calls, ["first", "last"], "rejected updates do not partially install scripts");

    movie.addFrameScript(3, null);
    movie.gotoAndStop(4);
    assert.deepEqual(calls, ["first", "last"], "null removes the exact frame callback");
});

test("timeline replacement rejects registered scripts outside the new frame range", () => {
    const movie = new MovieClip();
    const original = new TestTimeline(4);
    movie._bindNativeTimeline(original, { end: 4 });
    movie.addFrameScript(3, () => undefined);

    assert.throws(() => movie._bindNativeTimeline(new TestTimeline(3)), /frame script 3 is outside/);
    assert.equal(movie.totalFrames, 4);
    assert.deepEqual({ ...movie.flashFrameLabels }, { end: 4 });
});

test("authenticated AnimatorClip2D transitions run crossed scripts after the native pose", () => {
    const movie = new MovieClip();
    const animator = movie.addComponent(AnimatorClip2D);
    const clip = new AnimationClip2D();
    clip._duration = 4 / 30;
    clip._frameRate = 30;
    animator.autoPlay = false;
    animator.clip = clip;
    movie._onAnimatorClip2DReady(animator);

    const calls: number[] = [];
    movie.addFrameScript(1, () => calls.push(1), 2, () => calls.push(2), 3, () => {
        calls.push(3);
        movie.stop();
        movie.visible = false;
    });
    animator.gotoAndStopByFrame(3);
    movie._onAnimatorClip2DFrame(animator, 0, 3, true);
    assert.deepEqual(calls, [1, 2, 3]);
    assert.equal(movie.isPlaying, false);
    assert.equal(movie.visible, false);

    const foreign = new AnimatorClip2D();
    movie._onAnimatorClip2DFrame(foreign, 0, 3, true);
    assert.deepEqual(calls, [1, 2, 3], "an unauthenticated animator cannot publish frame callbacks");
});

test("AnimatorClip2D onUpdate publishes the natural last-frame transition", () => {
    const movie = new MovieClip();
    const animator = movie.addComponent(AnimatorClip2D);
    const clip = new AnimationClip2D();
    clip._duration = 4 / 20;
    clip._frameRate = 20;
    clip.islooping = false;
    animator.autoPlay = false;
    animator.clip = clip;
    movie._onAnimatorClip2DReady(animator);
    let callbacks = 0;
    movie.addFrameScript(movie.totalFrames - 1, () => {
        callbacks++;
        movie.stop();
    });

    movie.gotoAndPlay(1);
    (ILaya.timer as any).delta = 250;
    animator.onUpdate();
    assert.equal(callbacks, 1);
    assert.equal(movie.currentFrame, 4);
    assert.equal(movie.isPlaying, false);
});

test("forward and reverse wrap transitions execute only the crossed frame scripts", () => {
    const movie = new MovieClip();
    const animator = movie.addComponent(AnimatorClip2D);
    const clip = new AnimationClip2D();
    clip._duration = 4 / 24;
    clip._frameRate = 24;
    animator.autoPlay = false;
    animator.clip = clip;
    movie._onAnimatorClip2DReady(animator);
    const calls: number[] = [];
    movie.addFrameScript(0, () => calls.push(0), 1, () => calls.push(1),
        2, () => calls.push(2), 3, () => calls.push(3));

    animator.gotoAndStopByFrame(1);
    movie._onAnimatorClip2DFrame(animator, 3, 1, true);
    assert.deepEqual(calls, [0, 1]);
    calls.length = 0;
    animator.gotoAndStopByFrame(3);
    movie._onAnimatorClip2DFrame(animator, 1, 3, false);
    assert.deepEqual(calls, [0, 3]);
});

test("frame callback navigation cancels stale remaining transition publication", () => {
    const movie = new MovieClip();
    const animator = movie.addComponent(AnimatorClip2D);
    const clip = new AnimationClip2D();
    clip._duration = 4 / 30;
    clip._frameRate = 30;
    animator.autoPlay = false;
    animator.clip = clip;
    movie._onAnimatorClip2DReady(animator);
    const calls: number[] = [];
    movie.addFrameScript(0, () => calls.push(0), 1, () => {
        calls.push(1);
        movie.gotoAndStop(1);
    }, 2, () => calls.push(2), 3, () => calls.push(3));

    animator.gotoAndStopByFrame(3);
    movie._onAnimatorClip2DFrame(animator, 0, 3, true);
    assert.deepEqual(calls, [1, 0]);
    assert.equal(movie.currentFrame, 1);
});
