import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { ILaya } from "../../src/layaAir/ILaya";
import { AnimationClip2D } from "../../src/layaAir/laya/components/AnimationClip2D";
import { AnimatorClip2D } from "../../src/layaAir/laya/components/AnimatorClip2D";
import { HierarchyParser } from "../../src/layaAir/laya/loaders/HierarchyParser";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { Loader } from "../../src/layaAir/laya/net/Loader";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { Render2DProcessor } from "../../src/layaAir/laya/display/Render2DProcessor";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { PrefabImpl } from "../../src/layaAir/laya/resource/PrefabImpl";
import { ClassUtils } from "../../src/layaAir/laya/utils/ClassUtils";
import { Browser } from "../../src/layaAir/laya/utils/Browser";
import "../../src/layaAir/laya/ModuleDef";
import {
    AuthoredDynamicTextField,
    AuthoredMovieClip,
    registerAuthoredContentPrimitives,
} from "../../src/extensions/authoredContent/runtime/AuthoredRuntimePrimitives";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
(Render2DProcessor as unknown as { runner: unknown }).runner = { _textRender: { getFontHeight: (): number => 10 } };
Browser.context = {
    font: "10px Arial", fontKerning: "normal",
    measureText: (value: string) => ({ width: Array.from(value).length * 5 }),
} as unknown as CanvasRenderingContext2D;
ILaya.stage = {
    _graphicUpdateList: new Set(), _tranMatrixUpdateList: new Set(),
    _componentDriver: { _toDestroys: new Set() },
} as any;
ILaya.timer = { delta: 0 } as any;
ILaya.systemTimer = { callLater: (): void => undefined, runCallLater: (): void => undefined } as any;
(PAL as any).textInput = {
    target: null,
    begin(target: unknown): void { this.target = target; },
    end(): void { this.target = null; },
    setText: (): void => undefined, setSelection: (): void => undefined,
    syncSelection: (): void => undefined, syncText: (): void => undefined,
};
(PAL as any).browser ??= { on: (): void => undefined };

class FixtureSellRoot extends AuthoredMovieClip {
    declare MC_AllSale: AuthoredMovieClip;
}

test("emitted repeated definitions deserialize as independently owned reflected placements", () => {
    const hierarchyPath = requiredEnvironmentPath("AUTHORED_REPEATED_PLACEMENT_HIERARCHY");
    const bundleRoot = dirname(hierarchyPath);
    const hierarchy = JSON.parse(readFileSync(hierarchyPath, "utf8"));
    assert.deepEqual(hierarchy._$authoredContent.inertPlacementRatios, [
        { timelineSymbolId: 32, frameIndex: 3, operationIndex: 3, depth: 2, characterId: 28, characterKind: "input-text", ratio: 2 },
        { timelineSymbolId: 32, frameIndex: 4, operationIndex: 3, depth: 2, characterId: 31, characterKind: "input-text", ratio: 3 },
    ]);

    registerAuthoredContentPrimitives();
    ClassUtils.regClass("Fixture.Authored.MC_Sell", FixtureSellRoot);
    const priorLoader = ILaya.loader;
    ILaya.loader = new Loader();
    const cachedClips = cacheHierarchyClips(hierarchy, bundleRoot);
    assert.ok(cachedClips.every(([url, clip]) => Loader.getRes(url) === clip), "a parsed timeline was not retained in the loader cache");
    assert.ok(cachedClips.every(([url, clip]) => ILaya.loader.getRes(url, Loader.assetTypeToLoadType.AnimationClip2D) === clip), "a parsed timeline was not retained under the AnimationClip2D loader type");
    let instance: FixtureSellRoot | undefined;
    try {
        const errors: unknown[] = [];
        const created = new PrefabImpl(HierarchyParser, hierarchy).create({}, errors);
        assert.deepEqual(errors, [], "emitted hierarchy did not deserialize cleanly");
        assert.ok(created instanceof FixtureSellRoot, "root linkage did not resolve to the registered runtime class");
        if (!(created instanceof FixtureSellRoot)) throw new TypeError("unexpected root class");
        instance = created;

        const rows: AuthoredMovieClip[] = [];
        for (let index = 0; index < 16; index += 1) {
            const name = `MC_ItemCaption_${index}`;
            const row = instance!.getChildByName(name);
            assert.ok(row instanceof AuthoredMovieClip, `${name} is not an authored MovieClip`);
            assert.ok(Reflect.get(instance!, name) === row, `${name} was not reflected on the root owner`);
            if (!(row instanceof AuthoredMovieClip)) throw new TypeError(`${name} has the wrong runtime type`);
            const caption = row.getChildByName("TF_ItemCaption");
            const quantity = row.getChildByName("TF_ItemQuantity");
            assert.ok(caption instanceof AuthoredDynamicTextField, `${name}.TF_ItemCaption has the wrong runtime type`);
            assert.ok(quantity instanceof AuthoredDynamicTextField, `${name}.TF_ItemQuantity has the wrong runtime type`);
            assert.ok(Reflect.get(row, "TF_ItemCaption") === caption, `${name} lost nested caption reflection ownership`);
            assert.ok(Reflect.get(row, "TF_ItemQuantity") === quantity, `${name} lost nested quantity reflection ownership`);
            rows.push(row);
        }
        assert.equal(new Set(rows).size, 16, "repeated definition placements collapsed to shared nodes");
        assert.ok(Reflect.get(instance, "TF_ItemCaption") === undefined, "nested caption reflection leaked to the root");
        assert.ok(Reflect.get(instance, "TF_ItemQuantity") === undefined, "nested quantity reflection leaked to the root");

        const animators = rows.map(row => row.getComponent(AnimatorClip2D));
        assert.ok(animators.every(Boolean), "a repeated row lost its independent animator");
        assert.equal(new Set(animators).size, 16, "repeated rows share animator state");
        assert.ok(animators.every(animator => animator?.clip instanceof AnimationClip2D), `repeated row clips missing at ${animators.map((animator, index) => animator?.clip ? "" : index).filter(Boolean).join(",")}`);
        assert.ok(rows.every(row => row.totalFrames === 2), "row timeline frame count drifted");
        rows[0].gotoAndStop(2);
        assert.equal(rows[0].currentFrame, 2);
        assert.ok(rows.slice(1).every(row => row.currentFrame === 1), "one row navigation changed another row clock");
        rows[1].stop();
        rows[1].play();
        assert.equal(rows[1].isPlaying, true);
        assert.equal(rows[0].isPlaying, false);

        const allSale = instance.MC_AllSale;
        assert.ok(allSale instanceof AuthoredMovieClip, "MC_AllSale reflection failed");
        assert.equal(allSale.totalFrames, 4);
        allSale.gotoAndStop("down");
        assert.deepEqual([allSale.currentFrame, allSale.currentFrameLabel, allSale.currentLabel], [3, "down", "down"]);
        allSale.gotoAndPlay("disabled");
        assert.deepEqual([allSale.currentFrame, allSale.currentFrameLabel, allSale.isPlaying], [4, "disabled", true]);

        const rowAnimators = animators as AnimatorClip2D[];
        instance.destroy(true);
        assert.ok(rows.every(row => row.destroyed), "owned repeated row survived root destruction");
        assert.ok(rowAnimators.every(animator => animator.destroyed), "owned repeated animator survived destruction");
        instance = undefined;
    }
    finally {
        instance?.destroy(true);
        for (const [url, clip] of cachedClips) {
            Loader.clearRes(url, clip);
            clip.destroy();
        }
        ILaya.loader = priorLoader;
    }
});

function requiredEnvironmentPath(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function cacheHierarchyClips(hierarchy: any, bundleRoot: string): ReadonlyArray<readonly [string, AnimationClip2D]> {
    const urls = new Set<string>();
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) return void value.forEach(visit);
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (record._$type === "AnimationClip2D" && typeof record._$uuid === "string" && record._$uuid.startsWith("res://"))
            urls.add(record._$uuid);
        Object.values(record).forEach(visit);
    };
    visit(hierarchy);
    return [...urls].sort().map(url => {
        const segments = url.slice(6).split("/");
        const namespacedPath = join(bundleRoot, ...segments);
        const sourcePath = existsSync(namespacedPath) ? namespacedPath : join(bundleRoot, ...segments.slice(1));
        const bytes = readFileSync(sourcePath);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const clip = AnimationClip2D._parse(buffer);
        clip._setCreateURL(url, url);
        const info = Loader.getURLInfo(url);
        Loader._cacheRes(url, clip, info.typeId, info.main);
        return [url, clip] as const;
    });
}
