import assert from "node:assert/strict";
import test from "node:test";
import { AuthoredMovieClip } from "../../src/extensions/authoredContent/runtime/AuthoredRuntimePrimitives";
import { Rectangle } from "../../src/layaAir/flash";
import { Image } from "../../src/layaAir/laya/ui/Image";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { ILaya } from "../../src/layaAir/ILaya";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
ILaya.stage = {
    _graphicUpdateList: new Set(),
    _tranMatrixUpdateList: new Set(),
    _componentDriver: { _toDestroys: new Set() },
} as any;
ILaya.timer = {
    callLater: (): void => undefined,
    runCallLater: (): void => undefined,
    clear: (): void => undefined,
} as any;

test("AuthoredMovieClip projects an authenticated Flash scale9Grid through a native Image", () => {
    const clip = new AuthoredMovieClip();
    clip.name = "MC_HitTexture";
    clip.width = 40;
    clip.height = 36;
    const texture = new Image();
    texture.name = "character_42";
    texture.width = 40;
    texture.height = 36;
    clip.addChild(texture);
    clip.authoredScale9Grid = {
        x: 12,
        y: 12,
        width: 18,
        height: 12,
        sizeGrid: [12, 10, 12, 12, 0],
        target: "character_42",
    };

    clip.onAfterDeserialize();

    assert.deepEqual(clip.scale9Grid, new Rectangle(12, 12, 18, 12));
    assert.equal(texture.sizeGrid, "12,10,12,12,0");
    clip.width = 80;
    clip.height = 72;
    assert.deepEqual([texture.width, texture.height], [80, 72]);
    clip.destroy(true);
});

test("AuthoredMovieClip fails closed when the declared scale9 raster target is absent", () => {
    const clip = new AuthoredMovieClip();
    clip.width = 40;
    clip.height = 36;
    clip.addChild(new Image());
    clip.authoredScale9Grid = {
        x: 12,
        y: 12,
        width: 18,
        height: 12,
        sizeGrid: [12, 10, 12, 12, 0],
        target: "missing",
    };
    assert.throws(() => clip.onAfterDeserialize(), /scale9 target 'missing' is missing/);
    clip.destroy(true);
});
