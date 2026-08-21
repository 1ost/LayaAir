import assert from "node:assert/strict";
import test from "node:test";

import { ILaya } from "../../src/layaAir/ILaya";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject";
import { Shape } from "../../src/layaAir/flash/display/Shape";
import { Rectangle } from "../../src/layaAir/flash/geom/Rectangle";
import "../../src/layaAir/laya/ModuleDef";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
ILaya.stage = {
    _graphicUpdateList: new Set(),
    _tranMatrixUpdateList: new Set(),
    _componentDriver: { _toDestroys: new Set() },
} as any;

test("DisplayObject exposes retained Flash cache, geometry and collision behavior", () => {
    const root = new DisplayObject();
    const left = new Shape();
    const right = new Shape();
    left.graphics.beginFill(0x112233);
    left.graphics.drawRect(0, 0, 20, 10);
    left.graphics.endFill();
    right.graphics.beginFill(0x445566);
    right.graphics.drawRect(0, 0, 10, 10);
    right.graphics.endFill();
    left.pos(10, 20);
    right.pos(25, 25);
    root.addChild(left);
    root.addChild(right);

    assert.equal(left.cacheAsBitmap, false);
    left.cacheAsBitmap = true;
    assert.deepEqual([left.cacheAsBitmap, left.cacheAs], [true, "bitmap"]);
    left.cacheAsBitmap = false;
    assert.deepEqual([left.cacheAsBitmap, left.cacheAs], [false, "none"]);

    assert.equal(left.opaqueBackground, null);
    left.opaqueBackground = 0xabcdef;
    assert.equal(left.opaqueBackground, 0xabcdef);

    const grid = new Rectangle(2, 3, 8, 4);
    left.scale9Grid = grid;
    grid.x = 99;
    const readGrid = left.scale9Grid!;
    assert.deepEqual([readGrid.x, readGrid.y, readGrid.width, readGrid.height], [2, 3, 8, 4]);
    readGrid.y = 99;
    assert.equal(left.scale9Grid!.y, 3, "scale9Grid reads and writes detached values");
    assert.throws(() => left.scale9Grid = {} as Rectangle, /requires a Rectangle/);

    const bounds = left.getBounds(root);
    const rect = left.getRect(root);
    assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [10, 20, 20, 10]);
    assert.deepEqual([rect.x, rect.y, rect.width, rect.height], [10, 20, 20, 10]);
    assert.equal(left.hitTestObject(right), true);
    right.x = 31;
    assert.equal(left.hitTestObject(right), false);
    assert.equal(left.hitTestPoint(11, 21), true);
    assert.equal(left.hitTestPoint(9, 21), false);
    assert.equal(left.hitTestPoint(11, 21, true), true);
    assert.throws(() => left.hitTestObject({} as DisplayObject), /requires a DisplayObject/);
});
