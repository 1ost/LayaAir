import assert from "node:assert/strict";
import test from "node:test";

import { ILaya } from "../../src/layaAir/ILaya";
import type { FlashFrameScript } from "../../src/layaAir/flash";
import { MovieClip } from "../../src/layaAir/flash/display/MovieClip";
import type { NativeMovieClipTimeline } from "../../src/layaAir/flash/display/NativeMovieClipTimeline";
import { AnimationClip2D } from "../../src/layaAir/laya/components/AnimationClip2D";
import { AnimatorClip2D } from "../../src/layaAir/laya/components/AnimatorClip2D";
import { HierarchyParser } from "../../src/layaAir/laya/loaders/HierarchyParser";
import { Loader } from "../../src/layaAir/laya/net/Loader";
import { PrefabImpl } from "../../src/layaAir/laya/resource/PrefabImpl";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import "../../src/layaAir/laya/ModuleDef";
import {
    AUTHORED_CONTENT_RUNTIME_IDS,
    AuthoredMovieClip,
    registerAuthoredContentPrimitives,
} from "../../src/extensions/authoredContent/runtime/AuthoredRuntimePrimitives";

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

function authoredClip(assetId: string, frameCount: number, frameRate: number): AnimationClip2D {
    const clip = new AnimationClip2D();
    clip._duration = frameCount / frameRate;
    clip._frameRate = frameRate;
    clip.islooping = true;
    clip._setCreateURL(`res://${assetId}`, assetId);
    return clip;
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

test("serialized authored frame labels bind exact native MovieClip navigation and fail closed", () => {
    const movie = new MovieClip();
    movie.authoredFrameLabels = { up: 1, over: 2, down: 3, disabled: 4 };
    const animator = movie.addComponent(AnimatorClip2D);
    const clip = new AnimationClip2D();
    clip._duration = 4 / 24;
    clip._frameRate = 24;
    animator.autoPlay = false;
    animator.clip = clip;
    movie._onAnimatorClip2DReady(animator);

    assert.deepEqual(
        { ...movie.flashFrameLabels },
        { up: 1, over: 2, down: 3, disabled: 4 },
    );
    movie.gotoAndStop("over");
    assert.equal(movie.currentFrame, 2);
    assert.equal(movie.currentLabel, "over");
    movie.gotoAndPlay("disabled");
    assert.equal(movie.currentFrame, 4);
    assert.equal(movie.currentFrameLabel, "disabled");
    assert.equal(movie.isPlaying, true);

    movie.authoredFrameLabels = { start: 1, end: 4 };
    movie.gotoAndStop(3);
    assert.equal(movie.currentLabel, "start", "currentLabel must retain the nearest prior frame label");
    assert.equal(movie.currentFrameLabel, null, "currentFrameLabel must be null on an unlabeled frame");
    movie.gotoAndStop(-10);
    assert.deepEqual([movie.currentFrame, movie.isPlaying], [1, false], "numeric gotoAndStop must clamp below frame 1");
    movie.gotoAndPlay(100);
    assert.deepEqual([movie.currentFrame, movie.isPlaying], [4, true], "numeric gotoAndPlay must clamp above totalFrames");

    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, "missing"] as const) {
        assert.throws(() => movie.gotoAndStop(invalid), /finite safe integer|Unknown MovieClip frame label/);
        assert.deepEqual([movie.currentFrame, movie.isPlaying], [4, true],
            "rejected frame navigation must not mutate the current frame or playback state");
    }

    assert.throws(() => {
        movie.authoredFrameLabels = { "not a label": 1 };
    }, /stable identifiers/);
    assert.throws(() => {
        movie.authoredFrameLabels = { outside: 5 };
    }, /outside 1\.\.4/);
    assert.deepEqual(
        { ...movie.flashFrameLabels },
        { start: 1, end: 4 },
        "rejected serialized labels corrupted the prior native label map",
    );
});

test("Flash playback commands persist across native animator enable", () => {
    const movie = new MovieClip();
    const animator = movie.addComponent(AnimatorClip2D);
    animator.clip = authoredClip("enable-timeline", 4, 24);
    movie._onAnimatorClip2DReady(animator);
    const poseApplications: number[] = [];
    const gotoAndStopByFrame = animator.gotoAndStopByFrame.bind(animator);
    animator.gotoAndStopByFrame = (frame: number): void => {
        poseApplications.push(frame);
        gotoAndStopByFrame(frame);
    };

    movie.stop();
    assert.deepEqual([animator.autoPlay, movie.isPlaying], [false, false]);
    assert.deepEqual(poseApplications, [0], "stop must apply the initial native pose before stage attachment");
    animator.onEnable();
    assert.equal(movie.isPlaying, false, "native enable restarted a stopped Flash timeline");

    movie.gotoAndPlay(3);
    assert.deepEqual([animator.autoPlay, movie.currentFrame, movie.isPlaying], [true, 3, true]);
    movie.gotoAndStop(2);
    assert.deepEqual([animator.autoPlay, movie.currentFrame, movie.isPlaying], [false, 2, false]);
    animator.onEnable();
    assert.deepEqual([movie.currentFrame, movie.isPlaying], [2, false]);

    movie.play();
    assert.deepEqual([animator.autoPlay, movie.currentFrame, movie.isPlaying], [true, 2, true]);
});

test("real authored hierarchy deserialization preserves root and nested labels with independent clocks", () => {
    registerAuthoredContentPrimitives();
    const rootClip = authoredClip("root-timeline", 3, 24);
    const nestedClip = authoredClip("nested-timeline", 4, 24);
    const rootInfo = Loader.getURLInfo("root-timeline.mc");
    const nestedInfo = Loader.getURLInfo("nested-timeline.mc");
    Loader._cacheRes("root-timeline", rootClip, rootInfo.typeId, rootInfo.main);
    Loader._cacheRes("nested-timeline", nestedClip, nestedInfo.typeId, nestedInfo.main);
    const priorLoader = ILaya.loader;
    ILaya.loader = new Loader();
    try {
        const errors: unknown[] = [];
        const instance = new PrefabImpl(HierarchyParser, {
            "_$ver": 1,
            "_$id": "root",
            "_$type": "Sprite",
            "_$runtime": AUTHORED_CONTENT_RUNTIME_IDS.movieClip,
            name: "Root",
            authoredFrameLabels: { "_$type": "any", value: { start: 1, middle: 2, finish: 3 } },
            "_$child": [{
                "_$id": "nested",
                "_$type": "Sprite",
                "_$runtime": AUTHORED_CONTENT_RUNTIME_IDS.movieClip,
                name: "Nested",
                authoredFrameLabels: { "_$type": "any", value: { up: 1, over: 2, down: 3, disabled: 4 } },
                "_$comp": [{
                    "_$type": "AnimatorClip2D",
                    clip: { "_$uuid": "nested-timeline", "_$type": "AnimationClip2D" },
                    autoPlay: true,
                }],
            }],
            "_$comp": [{
                "_$type": "AnimatorClip2D",
                clip: { "_$uuid": "root-timeline", "_$type": "AnimationClip2D" },
                autoPlay: true,
            }],
        }).create({}, errors);
        assert.deepEqual(errors, []);
        assert.equal(instance instanceof AuthoredMovieClip, true);
        if (!(instance instanceof AuthoredMovieClip))
            throw new TypeError("Authored root hierarchy did not deserialize as MovieClip");
        const nested = instance.getChildByName("Nested");
        assert.equal(nested instanceof AuthoredMovieClip, true);
        if (!(nested instanceof AuthoredMovieClip))
            throw new TypeError("Authored nested hierarchy did not deserialize as MovieClip");
        assert.deepEqual({ ...instance.flashFrameLabels }, { start: 1, middle: 2, finish: 3 });
        assert.deepEqual({ ...nested.flashFrameLabels }, { up: 1, over: 2, down: 3, disabled: 4 });
        assert.equal(instance.isPlaying, true);
        assert.equal(nested.isPlaying, true);

        instance.gotoAndStop("middle");
        assert.deepEqual([instance.currentFrame, instance.currentLabel, instance.isPlaying], [2, "middle", false]);
        assert.equal(nested.isPlaying, true, "stopping the root clock must not stop the nested clock");
        nested.gotoAndStop(3);
        assert.deepEqual([nested.currentFrame, nested.currentLabel, nested.isPlaying], [3, "down", false]);
        assert.equal(instance.currentFrame, 2, "nested numeric navigation must not move the root timeline");
        nested.play();
        assert.deepEqual([nested.currentFrame, nested.currentLabel, nested.isPlaying], [3, "down", true]);
        nested.stop();
        assert.deepEqual([nested.currentFrame, nested.currentLabel, nested.isPlaying], [3, "down", false]);
        instance.gotoAndPlay(3);
        assert.deepEqual([instance.currentFrame, instance.currentLabel, instance.isPlaying], [3, "finish", true]);
        assert.equal(nested.isPlaying, false, "playing the root clock must not resume the stopped nested clock");
        nested.gotoAndPlay("disabled");
        assert.deepEqual([nested.currentFrame, nested.currentLabel, nested.isPlaying], [4, "disabled", true]);
        instance.stop();
        nested.stop();
        instance.destroy(true);
    } finally {
        Loader.clearRes("root-timeline", rootClip);
        Loader.clearRes("nested-timeline", nestedClip);
        ILaya.loader = priorLoader;
    }
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
