import assert from "node:assert/strict";
import test from "node:test";

import { ILaya } from "../../src/layaAir/ILaya";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NodeFlags } from "../../src/layaAir/laya/Const";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { SpriteConst } from "../../src/layaAir/laya/display/SpriteConst";
import { Event as LayaEvent } from "../../src/layaAir/laya/events/Event";
import { Sprite as LayaSprite } from "../../src/layaAir/laya/display/Sprite";
import {
    DisplayObject,
    flashDisplayObjectNativeHost,
} from "../../src/layaAir/flash/display/DisplayObject";
import { Bitmap } from "../../src/layaAir/flash/display/Bitmap";
import { BitmapData } from "../../src/layaAir/flash/display/BitmapData";
import { Shape } from "../../src/layaAir/flash/display/Shape";
import { Sprite } from "../../src/layaAir/flash/display/Sprite";
import { TextEvent } from "../../src/layaAir/flash/events/TextEvent";
import { Rectangle } from "../../src/layaAir/flash/geom/Rectangle";
import { TextField } from "../../src/layaAir/flash/text/TextField";
import "../../src/layaAir/laya/ModuleDef";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
ILaya.stage = {
    _graphicUpdateList: new Set(),
    _tranMatrixUpdateList: new Set(),
    _subpassUpdateList: new Set(),
    _componentDriver: { _toDestroys: new Set() },
} as any;
ILaya.timer = { callLater: (): void => undefined } as any;
ILaya.systemTimer = {
    callLater: (): void => undefined,
    runCallLater: (): void => undefined,
} as any;

test("BitmapData.setVector installs clipped ARGB pixels atomically", () => {
    const bitmapData = new BitmapData(3, 2, true, 0);
    bitmapData.setVector(new Rectangle(-1, 0, 3, 2), new Uint32Array([
        0xff112233, 0xff445566,
        0xff778899, 0xffaabbcc,
    ]));

    assert.deepEqual([
        bitmapData.getPixel32(0, 0), bitmapData.getPixel32(1, 0), bitmapData.getPixel32(2, 0),
        bitmapData.getPixel32(0, 1), bitmapData.getPixel32(1, 1), bitmapData.getPixel32(2, 1),
    ], [
        0xff112233, 0xff445566, 0,
        0xff778899, 0xffaabbcc, 0,
    ]);

    assert.throws(
        () => bitmapData.setVector(new Rectangle(0, 0, 2, 2), [0xff000001, 0xff000002, 0xff000003]),
        RangeError,
    );
    assert.deepEqual(
        [bitmapData.getPixel32(0, 0), bitmapData.getPixel32(1, 0)],
        [0xff112233, 0xff445566],
        "a short vector must not partially mutate the bitmap",
    );
});

test("BitmapData.setVector preserves transparency and validates Flash-shaped inputs", () => {
    const transparent = new BitmapData(1, 1, true, 0);
    transparent.setVector(transparent.rect, [0x80112233]);
    assert.equal(transparent.getPixel32(0, 0), 0x80122234);

    const opaque = new BitmapData(1, 1, false, 0);
    opaque.setVector(opaque.rect, [0x00112233]);
    assert.equal(opaque.getPixel32(0, 0), 0xff112233);

    assert.throws(() => transparent.setVector({} as Rectangle, [0]), /rect must be a Rectangle/);
    assert.throws(() => transparent.setVector(transparent.rect, null as unknown as number[]), /inputVector/);
    transparent.dispose();
    assert.throws(() => transparent.setVector(new Rectangle(), []), /disposed/);
});

test("Bitmap preserves BitmapData bounds before a render texture is available", () => {
    const bitmap = new Bitmap(new BitmapData(67, 32, true, 0));
    assert.equal(bitmap.texture == null, true);
    assert.deepEqual([bitmap.width, bitmap.height], [67, 32]);

    const root = new Sprite();
    root.addChild(bitmap);
    assert.deepEqual([root.width, root.height], [67, 32]);

    bitmap.bitmapData?.dispose();
    assert.deepEqual([bitmap.width, bitmap.height], [0, 0]);
});

test("Flash display parent normalizes unattached nodes to null without changing native hierarchy semantics", () => {
    const native = new LayaSprite();
    assert.equal(native.parent, undefined, "the Flash facade does not rewrite native Laya parent semantics");

    const root = new Sprite();
    const display = new DisplayObject();
    const bitmap = new Bitmap();
    const shape = new Shape();

    assert.deepEqual(
        [display.parent, bitmap.parent, shape.parent, root.parent],
        [null, null, null, null],
        "the canonical base and inherited Flash display surfaces normalize fresh nodes",
    );

    assert.equal(root.addChild(display), display);
    assert.equal(root.addChild(bitmap), bitmap);
    assert.equal(root.addChildAt(shape, 1), shape);
    assert.deepEqual([display.parent, shape.parent, bitmap.parent], [root, root, root]);
    assert.deepEqual([root.getChildAt(0), root.getChildAt(1), root.getChildAt(2)], [display, shape, bitmap]);

    assert.equal(root.removeChild(shape), shape);
    assert.equal(shape.parent, null);
    assert.equal(root.removeChildAt(1), bitmap);
    assert.equal(bitmap.parent, null);
    display.removeSelf();
    assert.equal(display.parent, null);
    assert.equal(root.numChildren, 0);
});

test("authenticated Flash display objects expose their exact native Laya host identity", () => {
    const canonical = new Sprite();
    const nativeHost = flashDisplayObjectNativeHost(canonical);

    assert.equal(nativeHost, canonical, "the bridge must not wrap or clone the canonical display object");
    assert.ok(nativeHost instanceof LayaSprite);
    assert.throws(
        () => flashDisplayObjectNativeHost(Object.create(Sprite.prototype)),
        /requires a canonical flash\.display\.DisplayObject/,
        "a structurally similar object is not an authenticated Flash display object",
    );
    assert.throws(
        () => flashDisplayObjectNativeHost(new LayaSprite()),
        /requires a canonical flash\.display\.DisplayObject/,
        "an unrelated native Laya sprite cannot enter through the Flash bridge",
    );
    assert.throws(
        () => flashDisplayObjectNativeHost(null),
        /requires a canonical flash\.display\.DisplayObject/,
    );
});

test("DisplayObject.mask preserves canonical Flash identity over native clipping ownership", () => {
    const clipped = new Sprite();
    const firstMask = new Shape();
    const secondMask = new Shape();
    firstMask.graphics.drawRect(0, 0, 20, 10);
    secondMask.graphics.drawCircle(5, 5, 5, "#ffffff");

    const sourceMask: DisplayObject | null = clipped.mask;
    assert.equal(sourceMask, null);
    if (false) {
        // @ts-expect-error A native Laya Sprite is not a source flash.display.DisplayObject.
        clipped.mask = new LayaSprite();
    }

    const subpassQueue = (ILaya.stage as unknown as { _subpassUpdateList: Set<LayaSprite> })._subpassUpdateList;
    clipped._setBit(NodeFlags.DISPLAYED_INSTAGE, true);
    subpassQueue.clear();
    clipped.mask = firstMask;

    const clippedHost = flashDisplayObjectNativeHost(clipped);
    const firstHost = flashDisplayObjectNativeHost(firstMask);
    assert.equal(clipped.mask, firstMask, "the source getter preserves exact canonical object identity");
    assert.equal(clippedHost.mask, firstHost, "the source facade installs the authenticated native host");
    assert.equal(firstHost._maskParent, clippedHost, "detached mask ownership remains native Laya ownership");
    assert.equal(firstMask.parent, null, "a mask does not need display-list attachment");
    assert.equal(firstHost.cacheAs, "bitmap");
    assert.notEqual(clippedHost._renderType & SpriteConst.MASK, 0,
        "the native clipping render path is enabled rather than simulated by the Flash facade");
    assert.equal(subpassQueue.size, 2);
    assert.equal(subpassQueue.has(firstHost), true, "native mask caching remains queued");
    assert.equal(subpassQueue.has(clippedHost), true, "the native masked owner remains queued");

    subpassQueue.clear();
    clipped.mask = secondMask;
    assert.deepEqual([clipped.mask, firstHost._maskParent, firstHost.cacheAs], [secondMask, null, "none"]);
    assert.deepEqual([secondMask.parent, flashDisplayObjectNativeHost(secondMask)._maskParent], [null, clippedHost]);
    assert.equal(subpassQueue.size, 3);
    assert.equal(subpassQueue.has(firstHost), true, "replacement queues prior-mask cache clearing");
    assert.equal(subpassQueue.has(flashDisplayObjectNativeHost(secondMask)), true,
        "replacement queues successor-mask caching");
    assert.equal(subpassQueue.has(clippedHost), true, "replacement queues the masked owner");

    subpassQueue.clear();
    clipped.mask = null;
    assert.equal(clipped.mask, null);
    assert.equal(flashDisplayObjectNativeHost(secondMask)._maskParent, null);
    assert.equal(flashDisplayObjectNativeHost(secondMask).cacheAs, "none");
    assert.equal(clippedHost._renderType & SpriteConst.MASK, 0);
    assert.equal(subpassQueue.size, 2);
    assert.equal(subpassQueue.has(flashDisplayObjectNativeHost(secondMask)), true,
        "clearing queues prior-mask cache clearing");
    assert.equal(subpassQueue.has(clippedHost), true, "clearing keeps native owner invalidation");
});

test("DisplayObject.mask accepts the canonical Flash display family and transfers one owner atomically", () => {
    const firstOwner = new Sprite();
    const secondOwner = new Sprite();
    const candidates: DisplayObject[] = [new DisplayObject(), new Shape(), new Bitmap(), new TextField()];
    for (const candidate of candidates) {
        firstOwner.mask = candidate;
        assert.equal(firstOwner.mask, candidate);
        secondOwner.mask = candidate;
        assert.equal(firstOwner.mask, null, "transfer clears the prior source owner");
        assert.equal(secondOwner.mask, candidate, "transfer preserves exact source identity");
        assert.equal(flashDisplayObjectNativeHost(candidate)._maskParent, flashDisplayObjectNativeHost(secondOwner));
        secondOwner.mask = null;
    }

    const retainedAncestor = new Sprite();
    retainedAncestor.addChild(secondOwner);
    firstOwner.mask = retainedAncestor;
    assert.throws(() => { secondOwner.mask = retainedAncestor; }, /Mask cannot be ancestor/);
    assert.equal(firstOwner.mask, retainedAncestor, "failed transfer preserves the prior source owner");
    assert.equal(flashDisplayObjectNativeHost(retainedAncestor)._maskParent,
        flashDisplayObjectNativeHost(firstOwner), "failed transfer preserves native ownership atomically");
    assert.equal(secondOwner.mask, null, "failed validation cannot publish partial ownership");
});

test("DisplayObject destruction releases both sides of native mask ownership", () => {
    const owner = new Sprite();
    const mask = new Shape();
    owner.mask = mask;
    owner.destroy(false);
    assert.deepEqual([flashDisplayObjectNativeHost(mask)._maskParent, flashDisplayObjectNativeHost(mask).cacheAs],
        [null, "none"], "destroying an owner releases its retained mask");

    const survivingOwner = new Sprite();
    const destroyedMask = new Shape();
    survivingOwner.mask = destroyedMask;
    destroyedMask.destroy(false);
    assert.equal(survivingOwner.mask, null, "destroying a mask clears the surviving source owner");
    assert.equal(flashDisplayObjectNativeHost(survivingOwner)._renderType & SpriteConst.MASK, 0);

    const stableOwner = new Sprite();
    const stableMask = new Shape();
    const unavailableMask = new Shape();
    stableOwner.mask = stableMask;
    unavailableMask.destroy(false);
    assert.throws(() => { stableOwner.mask = unavailableMask; }, /cannot use a destroyed DisplayObject/);
    assert.equal(stableOwner.mask, stableMask, "destroyed-mask rejection is atomic");
    assert.equal(flashDisplayObjectNativeHost(stableMask)._maskParent, flashDisplayObjectNativeHost(stableOwner));
    stableOwner.destroy(false);
    assert.throws(() => { stableOwner.mask = new Shape(); }, /Cannot set mask on a destroyed DisplayObject/);
});

test("DisplayObject.mask rejects unauthenticated values and preserves detach and ancestor policy", () => {
    const clipped = new Sprite();
    const maskContainer = new Sprite();
    const mask = new Shape();
    maskContainer.addChild(mask);
    maskContainer.mask = mask;
    assert.deepEqual([maskContainer.mask, mask.parent], [mask, maskContainer],
        "the authored child-mask topology preserves both display-list and mask identity");
    assert.deepEqual([maskContainer.width, maskContainer.height], [0, 0],
        "the native mask owner excludes its mask child from ordinary content bounds");
    clipped.mask = mask;
    assert.equal(maskContainer.mask, null, "transferring a child mask releases its prior mask owner only");
    assert.equal(mask.parent, maskContainer, "mask transfer does not rewrite authored display-list membership");
    mask.removeSelf();
    assert.deepEqual([clipped.mask, mask.parent], [mask, null],
        "display-list detachment does not sever independent native mask ownership");

    assert.throws(
        () => Reflect.set(clipped, "mask", Object.create(Shape.prototype)),
        /requires a canonical DisplayObject or null/,
    );
    assert.throws(
        () => Reflect.set(clipped, "mask", new LayaSprite()),
        /requires a canonical DisplayObject or null/,
    );
    assert.equal(clipped.mask, mask, "rejected values cannot partially replace the active mask");

    const child = new Sprite();
    clipped.addChild(child);
    assert.throws(() => { child.mask = clipped; }, /Mask cannot be ancestor/);
    assert.equal(child.mask, null, "native ancestor rejection cannot publish partial ownership");
    clipped.mask = clipped;
    assert.equal(clipped.mask, mask, "native self-mask assignment remains a no-op");
});

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

test("Flash width and height derive from child bounds without changing native Laya sizing", () => {
    const root = new Sprite();
    const upperLeft = new Shape();
    const lowerRight = new Shape();
    upperLeft.graphics.beginFill(0x112233);
    upperLeft.graphics.drawRect(0, 0, 20, 10);
    upperLeft.graphics.endFill();
    upperLeft.pos(10, 20);
    lowerRight.graphics.beginFill(0x445566);
    lowerRight.graphics.drawRect(0, 0, 10, 10);
    lowerRight.graphics.endFill();
    lowerRight.pos(25, 5);
    root.addChild(upperLeft);
    root.addChild(lowerRight);

    assert.deepEqual([root.width, root.height], [25, 25]);
    root.scale(2, 3);
    assert.deepEqual([root.width, root.height], [50, 75]);
    root.scale(-2, -3);
    assert.deepEqual([root.width, root.height], [50, 75]);

    const rotated = new Sprite();
    const rotatedChild = new Shape();
    rotatedChild.graphics.beginFill(0x778899);
    rotatedChild.graphics.drawRect(0, 0, 20, 10);
    rotatedChild.graphics.endFill();
    rotated.addChild(rotatedChild);
    rotated.rotation = 90;
    assert.ok(Math.abs(rotated.width - 10) < 0.00001);
    assert.ok(Math.abs(rotated.height - 20) < 0.00001);

    root.width = 90;
    root.height = 70;
    assert.deepEqual([root.width, root.height], [90, 70], "explicit Flash sizing stays authoritative");

    const nativeRoot = new LayaSprite();
    const nativeChild = new LayaSprite();
    nativeChild.graphics.drawRect(0, 0, 20, 10, "#ffffff");
    nativeChild.pos(10, 20);
    nativeRoot.addChild(nativeChild);
    assert.deepEqual([nativeRoot.width, nativeRoot.height], [0, 0]);
    assert.deepEqual(
        [nativeRoot.getSelfBounds().width, nativeRoot.getSelfBounds().height],
        [20, 10],
        "native Laya child bounds remain available without changing native width semantics",
    );
});

test("native HTML links project to source-shaped TextEvent.LINK", () => {
    const field = new DisplayObject();
    let received: TextEvent | null = null;
    field.addEventListener(TextEvent.LINK, event => { received = event as TextEvent; });

    field.event(LayaEvent.LINK, "event:hero:17");

    assert.ok(received instanceof TextEvent);
    assert.equal(received.type, TextEvent.LINK);
    assert.equal(received.text, "event:hero:17");
    assert.equal(received.bubbles, true);
    assert.equal(received.cancelable, false);
    assert.equal(received.target, field);
});
