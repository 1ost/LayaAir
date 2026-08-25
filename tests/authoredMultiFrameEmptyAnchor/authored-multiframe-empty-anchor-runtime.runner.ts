import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ILaya } from "../../src/layaAir/ILaya";
import { AnimationClip2D } from "../../src/layaAir/laya/components/AnimationClip2D";
import { AnimatorClip2D } from "../../src/layaAir/laya/components/AnimatorClip2D";
import { HierarchyParser } from "../../src/layaAir/laya/loaders/HierarchyParser";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { Loader } from "../../src/layaAir/laya/net/Loader";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { PrefabImpl } from "../../src/layaAir/laya/resource/PrefabImpl";
import { ClassUtils } from "../../src/layaAir/laya/utils/ClassUtils";
import "../../src/layaAir/laya/ModuleDef";
import {
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
ILaya.systemTimer = { callLater: (): void => undefined, runCallLater: (): void => undefined } as any;

class FixtureRootClip extends AuthoredMovieClip {
    declare Girl_MountPointIcon: AuthoredMovieClip;
}

test("emitted multi-frame empty anchor deserializes with exact reflection and an independent native clock", () => {
    const hierarchyPath = requiredEnvironmentPath("AUTHORED_EMPTY_ANCHOR_HIERARCHY");
    const rootTimelinePath = requiredEnvironmentPath("AUTHORED_EMPTY_ANCHOR_ROOT_TIMELINE");
    const nestedTimelinePath = requiredEnvironmentPath("AUTHORED_EMPTY_ANCHOR_NESTED_TIMELINE");
    const hierarchy = JSON.parse(readFileSync(hierarchyPath, "utf8"));
    const childHierarchy = hierarchy._$child?.[0];
    assert.equal(childHierarchy?.name, "Girl_MountPointIcon", "emitted hierarchy lost the exact anchor name");
    assert.equal(childHierarchy?._$var, true, "emitted hierarchy did not request named-instance reflection");

    registerAuthoredContentPrimitives();
    ClassUtils.regClass("Fixture.Authored.RootClip", FixtureRootClip);
    const rootClip = cacheEmittedClip(componentClipUrl(hierarchy), rootTimelinePath);
    const nestedClip = cacheEmittedClip(componentClipUrl(childHierarchy), nestedTimelinePath);
    const priorLoader = ILaya.loader;
    ILaya.loader = new Loader();
    let instance: FixtureRootClip | undefined;
    try {
        const errors: unknown[] = [];
        const created = new PrefabImpl(HierarchyParser, hierarchy).create({}, errors);
        assert.deepEqual(errors, [], "emitted hierarchy did not deserialize cleanly");
        assert.equal(created instanceof FixtureRootClip, true, "root linkage did not resolve to its registered runtime class");
        if (!(created instanceof FixtureRootClip))
            throw new TypeError("Emitted hierarchy root did not use FixtureRootClip");
        instance = created;

        const byName = instance.getChildByName("Girl_MountPointIcon");
        assert.equal(byName instanceof AuthoredMovieClip, true, "anchor did not instantiate the registered authored MovieClip primitive");
        if (!(byName instanceof AuthoredMovieClip))
            throw new TypeError("Emitted anchor did not deserialize as AuthoredMovieClip");
        const anchor = byName;
        assert.equal(instance.Girl_MountPointIcon, anchor, "_$var did not inject the exact named instance on the linkage root");
        assert.equal(Reflect.get(instance, "Girl_MountPointIcon"), anchor, "reflection lookup did not resolve the exact named instance");
        assert.deepEqual(
            { name: anchor.name, width: anchor.width, height: anchor.height, numChildren: anchor.numChildren },
            { name: "Girl_MountPointIcon", width: 0, height: 0, numChildren: 0 },
            "runtime anchor gained geometry, children, or a different identity",
        );

        const rootAnimator = instance.getComponent(AnimatorClip2D);
        const anchorAnimator = anchor.getComponent(AnimatorClip2D);
        assert.ok(rootAnimator && anchorAnimator, "root and anchor must each own an animator");
        assert.notEqual(rootAnimator, anchorAnimator, "anchor reused the root animator instead of owning an independent clock");
        assert.notEqual(rootAnimator.clip, anchorAnimator.clip, "anchor reused the root clip asset");
        assert.equal(anchorAnimator.clip, nestedClip, "anchor animator did not resolve the emitted nested clip identity");
        assert.deepEqual(
            { totalFrames: anchor.totalFrames, currentFrame: anchor.currentFrame, playing: anchor.isPlaying },
            { totalFrames: 4, currentFrame: 1, playing: true },
            "deserialized anchor did not start on its authored four-frame looping clock",
        );

        instance.stop();
        assert.equal(anchor.isPlaying, true, "stopping the root clock stopped the anchor clock");
        anchor.gotoAndStop(3);
        assert.deepEqual([anchor.currentFrame, anchor.isPlaying], [3, false]);
        assert.equal(instance.currentFrame, 1, "anchor navigation moved the root clock");
        anchor.gotoAndPlay(4);
        assert.deepEqual([anchor.currentFrame, anchor.isPlaying], [4, true]);
        anchor.stop();
        assert.deepEqual([anchor.currentFrame, anchor.isPlaying], [4, false]);
        anchor.gotoAndStop(1);
        anchor.play();
        (ILaya.timer as any).delta = 40;
        anchorAnimator.onUpdate();
        assert.equal(anchor.currentFrame, 2, "anchor animator did not advance its own four-frame clock");
        assert.equal(instance.currentFrame, 1, "anchor animator advanced the root clock");

        instance.destroy(true);
        assert.equal(instance.destroyed, true, "root did not destroy cleanly");
        assert.equal(anchor.destroyed, true, "owned anchor survived root destruction");
        assert.equal(rootAnimator.destroyed, true, "root animator survived root destruction");
        assert.equal(anchorAnimator.destroyed, true, "anchor animator survived anchor destruction");
        instance = undefined;
    }
    finally {
        instance?.destroy(true);
        Loader.clearRes(componentClipUrl(hierarchy), rootClip);
        Loader.clearRes(componentClipUrl(childHierarchy), nestedClip);
        rootClip.destroy();
        nestedClip.destroy();
        ILaya.loader = priorLoader;
    }
});

function requiredEnvironmentPath(name: string): string {
    const value = process.env[name];
    if (!value)
        throw new Error(`${name} is required`);
    return value;
}

function componentClipUrl(hierarchy: any): string {
    const value = hierarchy?._$comp?.find((component: any) => component?._$type === "AnimatorClip2D")?.clip?._$uuid;
    if (typeof value !== "string" || !value.startsWith("res://"))
        throw new Error("Emitted hierarchy is missing a sealed AnimatorClip2D asset identity");
    return value;
}

function cacheEmittedClip(url: string, sourcePath: string): AnimationClip2D {
    const bytes = readFileSync(sourcePath);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const clip = AnimationClip2D._parse(buffer);
    clip._setCreateURL(url, url);
    const info = Loader.getURLInfo(url);
    Loader._cacheRes(url, clip, info.typeId, info.main);
    return clip;
}
