import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Config } from "../../../src/layaAir/Config";
import { ILaya } from "../../../src/layaAir/ILaya";
import { AnimationClip2D } from "../../../src/layaAir/laya/components/AnimationClip2D";
import { AnimatorClip2D } from "../../../src/layaAir/laya/components/AnimatorClip2D";
import { Input as LayaInput, setInputEventOwner } from "../../../src/layaAir/laya/display/Input";
import { Node as LayaNode } from "../../../src/layaAir/laya/display/Node";
import { Point as LayaPoint } from "../../../src/layaAir/laya/maths/Point";
import { isFlashPoint } from "../../../src/layaAir/flash/geom/Point";
import { isFlashRectangle } from "../../../src/layaAir/flash/geom/Rectangle";
import { isFlashDisplayObject } from "../../../src/layaAir/flash/display/DisplayObject";
import { isFlashGraphics } from "../../../src/layaAir/flash/display/Graphics";
import { isFlashBitmapDrawable } from "../../../src/layaAir/flash/display/IBitmapDrawable";
import { isFlashDisplayObjectContainer } from "../../../src/layaAir/flash/display/DisplayObjectContainer";
import { isFlashInteractiveObject } from "../../../src/layaAir/flash/display/InteractiveObject";
import { isFlashMovieClip } from "../../../src/layaAir/flash/display/MovieClip";
import { isFlashSimpleButton } from "../../../src/layaAir/flash/display/SimpleButton";
import { isFlashSprite } from "../../../src/layaAir/flash/display/Sprite";
import { isFlashShape } from "../../../src/layaAir/flash/display/Shape";
import { isFlashBitmap } from "../../../src/layaAir/flash/display/Bitmap";
import { isFlashBitmapData, observeBitmapData } from "../../../src/layaAir/flash/display/BitmapData";
import { isFlashEvent } from "../../../src/layaAir/flash/events/Event";
import { isFlashEventDispatcher } from "../../../src/layaAir/flash/events/EventDispatcher";
import { isFlashFocusEvent } from "../../../src/layaAir/flash/events/FocusEvent";
import { isFlashErrorEvent } from "../../../src/layaAir/flash/events/ErrorEvent";
import { isFlashContextMenuEvent } from "../../../src/layaAir/flash/events/ContextMenuEvent";
import { isFlashHTTPStatusEvent } from "../../../src/layaAir/flash/events/HTTPStatusEvent";
import { isFlashIOErrorEvent } from "../../../src/layaAir/flash/events/IOErrorEvent";
import { isFlashKeyboardEvent } from "../../../src/layaAir/flash/events/KeyboardEvent";
import { isFlashMouseEvent } from "../../../src/layaAir/flash/events/MouseEvent";
import { isFlashProgressEvent } from "../../../src/layaAir/flash/events/ProgressEvent";
import { isFlashSecurityErrorEvent } from "../../../src/layaAir/flash/events/SecurityErrorEvent";
import { isFlashTextEvent } from "../../../src/layaAir/flash/events/TextEvent";
import { isFlashTimerEvent } from "../../../src/layaAir/flash/events/TimerEvent";
import { isFlashUncaughtErrorEvent } from "../../../src/layaAir/flash/events/UncaughtErrorEvent";
import { isFlashURLRequest } from "../../../src/layaAir/flash/net/URLRequest";
import { isFlashTimer } from "../../../src/layaAir/flash/utils/Timer";
import { isFlashTextField } from "../../../src/layaAir/flash/text/TextField";
import { isFlashStaticText } from "../../../src/layaAir/flash/text/StaticText";
import { beginNodeMutationTransaction } from "../../../src/layaAir/laya/display/NodeMutationTransaction";
import { Sprite as LayaSprite } from "../../../src/layaAir/laya/display/Sprite";
import { Render2DProcessor } from "../../../src/layaAir/laya/display/Render2DProcessor";
import { Stage } from "../../../src/layaAir/laya/display/Stage";
import { Panel } from "../../../src/layaAir/laya/ui/Panel";
import { Event as LayaEvent } from "../../../src/layaAir/laya/events/Event";
import { InputManager } from "../../../src/layaAir/laya/events/InputManager";
import { PAL } from "../../../src/layaAir/laya/platform/PlatformAdapters";
import { TextInputAdapter } from "../../../src/layaAir/laya/platform/TextInputAdapter";
import { Browser } from "../../../src/layaAir/laya/utils/Browser";
import { HierarchyParser } from "../../../src/layaAir/laya/loaders/HierarchyParser";
import { LayaGL } from "../../../src/layaAir/laya/layagl/LayaGL";
import { Render } from "../../../src/layaAir/laya/renders/Render";
import { NoRender2DProcess } from "../../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { PrefabImpl } from "../../../src/layaAir/laya/resource/PrefabImpl";
import { Texture } from "../../../src/layaAir/laya/resource/Texture";
import { Loader } from "../../../src/layaAir/laya/net/Loader";
import "../../../src/layaAir/laya/ModuleDef";
import {
    AnimatorClip2DTimeline, DisplayObject, DisplayObjectContainer, Event, EventDispatcher, EventPhase,
    ContextMenuEvent, ErrorEvent, FlashStageBoundary, FocusEvent, Graphics, HTTPStatusEvent, IMEEvent,
    IOErrorEvent, KeyboardEvent, InteractiveObject, MouseEvent, MovieClip, ProgressEvent, SecurityErrorEvent,
    Shape, SimpleButton, Sprite, TextEvent, Timer, TimerEvent, UncaughtErrorEvent,
    AntiAliasType, CSMSettings, GridFitType,
    StaticText, TextColorType, TextField, TextFieldAutoSize, TextFieldType, TextFormat, TextFormatAlign, TextRenderer,
    Point, Rectangle, Matrix, Bitmap, BitmapData, BitmapDataChannel, GlowFilter, GradientType, PixelSnapping, type IBitmapDrawable,
    UnsupportedFlashFeatureError, URLRequest, navigateToURL, isFlashCSMSettings, isFlashTextFormat
} from "../../../src/layaAir/flash";
import {
    createAuthoredStaticText, createAuthoredTextField, LayaAuthoredBindingHost, mapLayaAuthoredEventData,
    createAuthoredPrefabDefinition, normalizeAuthoredCodeBindingContract, registerAuthoredContentRuntime,
    type AuthoredStaticTextConfiguration, type AuthoredTextFieldConfiguration,
} from "../../../src/extensions/authoredContent/runtime";
import {
    AUTHORED_CONTENT_RUNTIME_IDS,
    AuthoredDynamicTextField,
    AuthoredMovieClip,
    registerAuthoredContentPrimitives,
} from "../../../src/extensions/authoredContent/runtime/AuthoredRuntimePrimitives";
import {
    AUTHORED_BINDING_RESERVED_SOURCE_SURFACES,
} from "../../../src/extensions/authoredContent/runtime/AuthoredBindingReservedSurfaces";
import { ButtonStateLinkage, FlashPanel, SubmitButtonLinkage } from "./generated/FlashPanel";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
(Render2DProcessor as unknown as { runner: unknown }).runner = {
    _textRender: { getFontHeight: (): number => 10 },
};
Browser.context = {
    font: "10px Arial",
    fontKerning: "normal",
    measureText: (value: string) => ({ width: Array.from(value).length * 5 }),
} as unknown as CanvasRenderingContext2D;
ILaya.stage = {
    _graphicUpdateList: new Set(),
    _tranMatrixUpdateList: new Set(),
    _componentDriver: { _toDestroys: new Set() },
} as any;
const frameCallbacks: Array<{ caller: unknown; method: Function }> = [];
ILaya.timer = {
    callLater: (): void => undefined,
    frameLoop(_delay: number, caller: unknown, method: Function): void {
        frameCallbacks.push({ caller, method });
    },
    clear(caller: unknown, method: Function): void {
        const index = frameCallbacks.findIndex(item => item.caller === caller && item.method === method);
        if (index >= 0) frameCallbacks.splice(index, 1);
    }
} as any;
ILaya.systemTimer = {
    callLater: (): void => undefined, runCallLater: (): void => undefined,
    frameOnce: (_frame: number, caller: unknown, method: Function): void => { queueMicrotask(() => method.call(caller)); }
} as any;
(PAL as any).textInput = {
    target: null,
    begin(target: unknown): void { this.target = target; },
    end(): void { this.target = null; },
    setText: (): void => undefined,
    setSelection: (): void => undefined,
    syncSelection: (): void => undefined,
    syncText: (): void => undefined
};
(PAL as any).browser ??= { on: (): void => undefined };

test("A12 capability ledger owns exact Flash declarations, members, signatures and hashes", () => {
    const path = join(process.cwd(), "docTool/architecture/authored-content-capabilities.json");
    const ledger = JSON.parse(readFileSync(path, "utf8"));
    for (const namespace of ["display", "events", "geom", "net", "text", "utils"]) {
        const capability = ledger.capabilities.find((item: any) => item.id === `api.flash.${namespace}`);
        assert.equal(capability.status, "typescript-obligation");
        assert.ok(capability.obligations.length > 0);
        for (const obligation of capability.obligations) {
            assert.ok(obligation.module.startsWith(`src/layaAir/flash/${namespace}/`));
            assert.match(obligation.sha256, /^[a-f0-9]{64}$/);
            assert.ok(obligation.signature.length > 0);
            if (obligation.kind === "class") {
                assert.ok(obligation.members.length > 0);
                assert.ok(Array.isArray(obligation.constructors));
                assert.ok(Array.isArray(obligation.indexSignatures));
            }
        }
        const insertionOrder = capability.obligations.map((item: any) => item.sha256).reverse();
        if (insertionOrder.length > 0) insertionOrder.push(insertionOrder[0]);
        assert.deepEqual(capability.evidence[0].covers,
            [...new Set(insertionOrder)].sort(), "covers must be canonical regardless insertion order or duplicates");
    }
});

test("class-specific nominal predicates preserve exact Flash heritage without minting", () => {
    const display = new DisplayObject();
    const interactive = new InteractiveObject();
    const container = new DisplayObjectContainer();
    const sprite = new Sprite();
    const movie = new MovieClip();
    const button = new SimpleButton();
    const textField = new TextField();
    const event = new Event("nominal");
    const focus = new FocusEvent(FocusEvent.FOCUS_IN);
    const mouse = new MouseEvent(MouseEvent.CLICK);
    const text = new TextEvent(TextEvent.TEXT_INPUT);
    const dispatcher = new EventDispatcher();
    const shape = new Shape();
    const graphics = shape.graphics;
    const error = new ErrorEvent(ErrorEvent.ERROR);
    const contextMenu = new ContextMenuEvent(ContextMenuEvent.MENU_ITEM_SELECT);
    const httpStatus = new HTTPStatusEvent(HTTPStatusEvent.HTTP_STATUS);
    const ioError = new IOErrorEvent(IOErrorEvent.IO_ERROR);
    const keyboard = new KeyboardEvent(KeyboardEvent.KEY_DOWN);
    const timer = new TimerEvent(TimerEvent.TIMER);
    const progress = new ProgressEvent(ProgressEvent.PROGRESS);
    const securityError = new SecurityErrorEvent(SecurityErrorEvent.SECURITY_ERROR);
    const uncaughtError = new UncaughtErrorEvent(UncaughtErrorEvent.UNCAUGHT_ERROR);
    const timerDispatcher = new Timer(1);
    const request = new URLRequest();

    assert.deepEqual([
        isFlashDisplayObject(display), isFlashDisplayObject(interactive), isFlashDisplayObject(container),
        isFlashDisplayObject(sprite), isFlashDisplayObject(movie), isFlashDisplayObject(button), isFlashDisplayObject(textField),
    ], [true, true, true, true, true, true, true]);
    assert.deepEqual([
        isFlashInteractiveObject(display), isFlashInteractiveObject(interactive), isFlashInteractiveObject(container),
        isFlashInteractiveObject(sprite), isFlashInteractiveObject(movie), isFlashInteractiveObject(button),
        isFlashInteractiveObject(textField),
    ], [false, true, true, true, true, true, true]);
    assert.deepEqual([
        isFlashDisplayObjectContainer(container), isFlashDisplayObjectContainer(sprite),
        isFlashDisplayObjectContainer(movie), isFlashDisplayObjectContainer(button),
    ], [true, true, true, false]);
    assert.deepEqual([isFlashSprite(sprite), isFlashSprite(movie), isFlashSprite(button)], [true, true, false]);
    assert.deepEqual([isFlashMovieClip(movie), isFlashMovieClip(sprite)], [true, false]);
    assert.deepEqual([isFlashSimpleButton(button), isFlashSimpleButton(interactive)], [true, false]);
    assert.deepEqual([isFlashTextField(textField), isFlashTextField(interactive)], [true, false]);
    assert.deepEqual([isFlashEvent(event), isFlashEvent(focus), isFlashEvent(mouse), isFlashEvent(text)],
        [true, true, true, true]);
    assert.deepEqual([isFlashFocusEvent(focus), isFlashMouseEvent(mouse), isFlashTextEvent(text)], [true, true, true]);
    assert.deepEqual([isFlashFocusEvent(event), isFlashMouseEvent(focus), isFlashTextEvent(mouse)], [false, false, false]);
    assert.equal(isFlashEventDispatcher(dispatcher), true);
    assert.equal(isFlashEventDispatcher(event), false);
    assert.deepEqual([isFlashShape(shape), isFlashGraphics(graphics), isFlashBitmapDrawable(shape)], [true, true, true]);
    assert.deepEqual([isFlashErrorEvent(error), isFlashErrorEvent(ioError), isFlashIOErrorEvent(ioError)], [true, true, true]);
    assert.deepEqual([isFlashContextMenuEvent(contextMenu), isFlashHTTPStatusEvent(httpStatus),
        isFlashProgressEvent(progress), isFlashSecurityErrorEvent(securityError),
        isFlashUncaughtErrorEvent(uncaughtError)], [true, true, true, true, true]);
    assert.deepEqual([isFlashEvent(contextMenu), isFlashEvent(httpStatus), isFlashEvent(progress),
        isFlashErrorEvent(securityError), isFlashErrorEvent(uncaughtError)], [true, true, true, true, true]);
    assert.deepEqual([isFlashKeyboardEvent(keyboard), isFlashTimerEvent(timer), isFlashURLRequest(request),
        isFlashTimer(timerDispatcher)], [true, true, true, true]);

    const adversaries: Array<[(value: unknown) => boolean, new (...args: any[]) => object, object]> = [
        [isFlashDisplayObject, DisplayObject, display],
        [isFlashDisplayObjectContainer, DisplayObjectContainer, container],
        [isFlashInteractiveObject, InteractiveObject, interactive],
        [isFlashMovieClip, MovieClip, movie],
        [isFlashSimpleButton, SimpleButton, button],
        [isFlashSprite, Sprite, sprite],
        [isFlashEvent, Event, event],
        [isFlashEventDispatcher, EventDispatcher, dispatcher],
        [isFlashFocusEvent, FocusEvent, focus],
        [isFlashMouseEvent, MouseEvent, mouse],
        [isFlashTextEvent, TextEvent, text],
        [isFlashTextField, TextField, textField],
        [isFlashShape, Shape, shape],
        [isFlashGraphics, Graphics, graphics],
        [isFlashErrorEvent, ErrorEvent, error],
        [isFlashContextMenuEvent, ContextMenuEvent, contextMenu],
        [isFlashHTTPStatusEvent, HTTPStatusEvent, httpStatus],
        [isFlashIOErrorEvent, IOErrorEvent, ioError],
        [isFlashKeyboardEvent, KeyboardEvent, keyboard],
        [isFlashTimerEvent, TimerEvent, timer],
        [isFlashProgressEvent, ProgressEvent, progress],
        [isFlashSecurityErrorEvent, SecurityErrorEvent, securityError],
        [isFlashUncaughtErrorEvent, UncaughtErrorEvent, uncaughtError],
        [isFlashTimer, Timer, timerDispatcher],
        [isFlashURLRequest, URLRequest, request],
    ];
    for (const [predicate, constructor, genuine] of adversaries) {
        assert.equal(predicate({}), false);
        assert.equal(predicate(Object.create(constructor.prototype)), false);
        assert.equal(predicate(new Proxy(genuine, {})), false);
        assert.equal(predicate(null), false);
    }
});

test("Point and Rectangle retain Flash value semantics on native Laya values", () => {
    const point = new Point(3, 4);
    assert.equal(point.length, 5);
    assert.equal(point.toString(), "(x=3, y=4)");
    assert.equal(Point.distance(point, new Point()), 5);
    assert.deepEqual(Point.interpolate(new Point(-2, 1), new Point(2, 3), 0.25), new Point(1, 2.5));
    const polar = Point.polar(2, Math.PI / 2);
    assert.ok(Math.abs(polar.x) < 1e-12);
    assert.equal(polar.y, 2);
    assert.deepEqual(point.add(new Point(-1, 2)), new Point(2, 6));
    assert.deepEqual(point.subtract(new Point(-1, 2)), new Point(4, 2));
    assert.equal(point.equals(point.clone()), true);
    const copiedPoint = new Point();
    copiedPoint.copyFrom(point);
    copiedPoint.offset(5, 6);
    copiedPoint.normalize(10);
    assert.ok(Math.abs(copiedPoint.length - 10) < 1e-12);
    copiedPoint.setTo(7, 8);
    assert.deepEqual(copiedPoint, new Point(7, 8));
    assert.throws(() => Point.distance(null as Point, point), TypeError);
    assert.throws(() => Point.distance({ x: 3, y: 4 } as Point, point), TypeError);
    assert.throws(() => point.add(new Rectangle() as unknown as Point), TypeError);
    class PointSubclass extends Point {}
    assert.equal(Point.distance(new PointSubclass(3, 4), new Point()), 5);
    assert.equal(isFlashPoint(new PointSubclass()), true);
    assert.equal(isFlashPoint({ x: 0, y: 0 }), false);
    assert.deepEqual(new Point("3" as unknown as number, "4" as unknown as number), point);

    const rectangle = new Rectangle(10, 20, 30, 40);
    assert.equal(rectangle.left, 10);
    assert.equal(rectangle.top, 20);
    assert.equal(rectangle.right, 40);
    assert.equal(rectangle.bottom, 60);
    assert.deepEqual(rectangle.clone(), rectangle);
    rectangle.inflate(2, 3);
    assert.deepEqual(rectangle, new Rectangle(8, 17, 34, 46));
    assert.equal(rectangle.contains(8, 17), true);
    assert.equal(rectangle.contains(42, 63), false);
    assert.equal(rectangle.containsPoint(new Point(20, 30)), true);
    assert.equal(rectangle.containsRect(new Rectangle(20, 30, 10, 5)), true);
    assert.deepEqual(rectangle.intersection(new Rectangle(20, 30, 10, 5)), new Rectangle(20, 30, 10, 5));
    assert.deepEqual(rectangle.intersection(new Rectangle(100, 100, 1, 1)), new Rectangle());
    assert.equal(rectangle.intersects(new Rectangle(42, 17, 1, 1)), false);
    assert.deepEqual(new Rectangle(0, 0, 10, 10).union(new Rectangle(8, 9, 4, 3)), new Rectangle(0, 0, 12, 12));
    const changed = rectangle.clone();
    changed.left = 0;
    changed.top = 1;
    changed.right = 7;
    changed.bottom = 9;
    assert.deepEqual(changed.topLeft, new Point(0, 1));
    assert.deepEqual(changed.bottomRight, new Point(7, 9));
    changed.topLeft = new Point(2, 3);
    changed.bottomRight = new Point(8, 10);
    changed.size = new Point(12, 13);
    assert.deepEqual(changed, new Rectangle(2, 3, 12, 13));
    changed.inflatePoint(new Point(1, 2));
    changed.offsetPoint(new Point(3, 4));
    assert.deepEqual(changed, new Rectangle(4, 5, 14, 17));
    const copiedRectangle = new Rectangle();
    copiedRectangle.copyFrom(changed);
    assert.equal(copiedRectangle.equals(changed), true);
    copiedRectangle.offset(1, 2);
    copiedRectangle.setTo(1, 2, 3, 4);
    assert.equal(copiedRectangle.toString(), "(x=1, y=2, w=3, h=4)");
    copiedRectangle.setEmpty();
    assert.equal(copiedRectangle.isEmpty(), true);
    assert.throws(() => rectangle.intersection(null as Rectangle), TypeError);
    assert.throws(() => rectangle.intersection({ x: 1, y: 2, width: 3, height: 4 } as Rectangle), TypeError);
    assert.throws(() => rectangle.containsPoint(new Rectangle() as unknown as Point), TypeError);
    class RectangleSubclass extends Rectangle {}
    assert.equal(rectangle.containsRect(new RectangleSubclass(20, 30, 10, 5)), true);
    assert.equal(isFlashRectangle(new RectangleSubclass()), true);
    assert.equal(isFlashRectangle({ x: 0, y: 0, width: 0, height: 0 }), false);
    assert.deepEqual(new Rectangle("1" as unknown as number, "2" as unknown as number,
        "3" as unknown as number, "4" as unknown as number), new Rectangle(1, 2, 3, 4));

    const display = new DisplayObject();
    display.pos(10, 20);
    const local = new Point(3, 4);
    const global = display.localToGlobal(local);
    assert.ok(global instanceof Point);
    assert.notEqual(global, local);
    assert.deepEqual(global, new Point(13, 24));
    assert.deepEqual(display.globalToLocal(global), local);

    const nativeInPlace = new LayaPoint(3, 4);
    assert.equal(display.localToGlobal(nativeInPlace), nativeInPlace);
    assert.deepEqual(nativeInPlace, new LayaPoint(13, 24));
    const nativeCopiedInput = new LayaPoint(3, 4);
    const nativeCopied = display.localToGlobal(nativeCopiedInput, true);
    assert.ok(nativeCopied instanceof LayaPoint);
    assert.notEqual(nativeCopied, nativeCopiedInput);
    assert.deepEqual(nativeCopiedInput, new LayaPoint(3, 4));
    assert.deepEqual(nativeCopied, new LayaPoint(13, 24));
    assert.equal(display.globalToLocal(nativeCopied), nativeCopied);
    assert.deepEqual(nativeCopied, new LayaPoint(3, 4));
    assert.throws(() => display.localToGlobal({ x: 3, y: 4 } as Point), TypeError);
    assert.throws(() => display.localToGlobal(Object.create(Point.prototype) as Point), TypeError);
    assert.throws(() => display.localToGlobal(new Proxy(new Point(3, 4), {}) as Point), TypeError);
});

test("BitmapData preserves premultiplied Flash pixel, clipping and disposal semantics", () => {
    assert.equal("draw" in BitmapData.prototype, true);
    assert.equal("applyFilter" in BitmapData.prototype, true);
    assert.equal(Object.isFrozen(BitmapDataChannel), true);
    assert.equal(Object.isFrozen(PixelSnapping), true);
    assert.deepEqual([BitmapDataChannel.RED, BitmapDataChannel.GREEN, BitmapDataChannel.BLUE, BitmapDataChannel.ALPHA],
        [1, 2, 4, 8]);
    assert.deepEqual([PixelSnapping.ALWAYS, PixelSnapping.AUTO, PixelSnapping.NEVER], ["always", "auto", "never"]);

    const defaulted = new BitmapData(2, 2);
    assert.equal(defaulted.transparent, true);
    assert.equal(defaulted.getPixel32(0, 0), 0xffffffff);
    const explicitUndefined = new BitmapData(1, 1, undefined, 0x00112233);
    assert.equal(explicitUndefined.transparent, false);
    assert.equal(explicitUndefined.getPixel32(0, 0), 0xff112233);
    const gradientMatrix = new Matrix();
    gradientMatrix.createGradientBox(4, 1);
    const gradientShape = new Shape();
    gradientShape.graphics.beginGradientFill(GradientType.LINEAR,
        [0x000000, 0xffffff], [1, 1], [0, 255], gradientMatrix);
    gradientShape.graphics.drawRect(0, 0, 4, 1);
    gradientShape.graphics.endFill();
    const gradientPixels = new BitmapData(4, 1, false, 0xff000000);
    gradientPixels.draw(gradientShape);
    const palette = [0, 1, 2, 3].map(index => gradientPixels.getPixel(index, 0));
    assert.equal(palette.every((value, index) => index === 0 || value > palette[index - 1]), true);
    assert.equal(palette[0] < 0x404040, true);
    assert.equal(palette[3] > 0xbfbfbf, true);
    const scaleSource = new BitmapData(2, 1, false, 0xff000000);
    scaleSource.setPixel32(1, 0, 0xffffffff);
    const scaled = new BitmapData(4, 1, false, 0xff000000);
    scaled.draw(scaleSource, new Matrix(2, 0, 0, 1), null, null, null, true);
    assert.deepEqual([0, 1, 2, 3].map(index => scaled.getPixel(index, 0)),
        [0x000000, 0x404040, 0xbfbfbf, 0xffffff]);
    assert.equal(new BitmapData("10.5" as unknown as number, 1).width, 10);
    assert.throws(() => new BitmapData(0, 1), RangeError);
    assert.throws(() => new BitmapData(1, -1), RangeError);
    assert.throws(() => new BitmapData(8192, 1), /allocation limit/);
    assert.throws(() => new BitmapData(4096, 4096), /allocation limit/);

    const premultiplied = new BitmapData(1, 1, true, 0x12345678);
    assert.equal(premultiplied.getPixel32(0, 0), 0x12395571);
    premultiplied.setPixel32(0, 0, 0xaabbccdd);
    assert.equal(premultiplied.getPixel32(0, 0), 0xaabbccdc);
    premultiplied.setPixel(0, 0, 0x00112233);
    assert.equal(premultiplied.getPixel32(0, 0) >>> 24, 0xaa);
    assert.equal(premultiplied.getPixel(-1, 0), 0);
    assert.equal(premultiplied.getPixel32(1, 0), 0);
    premultiplied.setPixel32(8, 8, 0xffffffff);

    const clipped = new BitmapData(4, 3, true, 0);
    clipped.fillRect(new Rectangle(-1.5, 0.5, 4, 2), 0xff010203);
    assert.equal(clipped.getPixel32(0, 0), 0xff010203);
    assert.equal(clipped.getPixel32(2, 2), 0);
    assert.equal(clipped.getPixel32(3, 0), 0);
    const clone = clipped.clone();
    assert.notEqual(clone, clipped);
    assert.deepEqual(clone.rect, clipped.rect);
    assert.equal(clone.getPixel32(1, 0), clipped.getPixel32(1, 0));

    let invalidations = 0;
    const stop = observeBitmapData(clipped, () => invalidations++);
    clipped.lock();
    clipped.setPixel32(0, 0, 0xff112233);
    clipped.setPixel32(1, 0, 0xff445566);
    assert.equal(invalidations, 0);
    clipped.unlock(new Rectangle(0, 0, 2, 1));
    assert.equal(invalidations, 1);
    clipped.dispose();
    assert.equal(invalidations, 2);
    assert.doesNotThrow(() => clipped.dispose());
    assert.throws(() => clipped.getPixel32(0, 0), /disposed/);
    assert.throws(() => clipped.width, /disposed/);
    stop();
});

test("BitmapData channel, copyPixels, bounds and threshold operations match Flash edge behavior", () => {
    const channelSource = new BitmapData(2, 1, false, 0xff800000);
    const channelTarget = new BitmapData(2, 1, true, 0xff204060);
    channelTarget.copyChannel(channelSource, new Rectangle(0, 0, 2, 1), new Point(),
        BitmapDataChannel.RED, BitmapDataChannel.ALPHA);
    assert.equal(channelTarget.getPixel32(0, 0) >>> 24, 0x80);
    assert.equal(channelTarget.getPixel32(0, 0) & 0x00ffffff, 0x204060);
    assert.throws(() => channelTarget.copyChannel({} as BitmapData, new Rectangle(), new Point(), 1, 8), TypeError);

    const overlap = new BitmapData(4, 1, false, 0);
    for (let x = 0; x < 4; x++) overlap.setPixel(x, 0, x + 1);
    overlap.copyPixels(overlap, new Rectangle(0, 0, 3, 1), new Point(1, 0));
    assert.deepEqual([0, 1, 2, 3].map(x => overlap.getPixel(x, 0)), [1, 1, 2, 3]);

    const sourceOver = new BitmapData(1, 1, true, 0x80ff0000);
    const opaqueDestination = new BitmapData(1, 1, false, 0xff0000ff);
    opaqueDestination.copyPixels(sourceOver, sourceOver.rect, new Point(), null, null, false);
    assert.equal(opaqueDestination.getPixel32(0, 0), 0xff80007f);
    const alphaMask = new BitmapData(1, 1, true, 0x80000000);
    const maskedCopy = new BitmapData(1, 1, true, 0);
    maskedCopy.copyPixels(new BitmapData(1, 1, false, 0xffff0000), new Rectangle(0, 0, 1, 1),
        new Point(), alphaMask, null, false);
    assert.equal(maskedCopy.getPixel32(0, 0) >>> 24, 0x80);
    const opaqueAlphaMask = new BitmapData(1, 1, false, 0);
    const preservedSourceAlpha = new BitmapData(1, 1, true, 0);
    preservedSourceAlpha.copyPixels(sourceOver, sourceOver.rect, new Point(), opaqueAlphaMask, null, false);
    assert.equal(preservedSourceAlpha.getPixel32(0, 0), 0x80ff0000);
    const maskedOpaqueDestination = new BitmapData(1, 1, false, 0xff0000ff);
    maskedOpaqueDestination.copyPixels(new BitmapData(1, 1, false, 0xffff0000),
        new Rectangle(0, 0, 1, 1), new Point(), alphaMask, null, false);
    assert.equal(maskedOpaqueDestination.getPixel32(0, 0), 0xff80007f);

    const bounds = new BitmapData(3, 3, true, 0);
    bounds.setPixel32(1, 1, 0xff123456);
    assert.deepEqual(bounds.getColorBoundsRect(0xff000000, 0, false), new Rectangle(1, 1, 1, 1));
    assert.deepEqual(bounds.getColorBoundsRect(0, 0, true), new Rectangle(0, 0, 3, 3));
    const opaqueBounds = new BitmapData(3, 2, false, 0xffffffff);
    opaqueBounds.fillRect(new Rectangle(0, 0, 3, 1), 0xffff0000);
    assert.deepEqual(opaqueBounds.getColorBoundsRect(0x00ffffff, 0x00ff0000), new Rectangle(0, 0, 3, 1));
    const playerPmaBounds = new BitmapData(3, 3, true, 0xaabbccdd);
    assert.deepEqual(playerPmaBounds.getColorBoundsRect(0x000000ff, 0x000000dd, true), new Rectangle());
    const originOnly = new BitmapData(2, 2, true, 0);
    originOnly.setPixel32(0, 0, 0xffffffff);
    assert.deepEqual(originOnly.getColorBoundsRect(0xffffffff, 0xffffffff), new Rectangle());

    const thresholdSource = new BitmapData(2, 1, true, 0);
    thresholdSource.setPixel32(0, 0, 0x40102030);
    thresholdSource.setPixel32(1, 0, 0xc0102030);
    const thresholdDestination = new BitmapData(2, 1, true, 0xffffffff);
    assert.equal(thresholdDestination.threshold(thresholdSource, thresholdSource.rect, new Point(),
        "<", 0x80000000, 0, 0xff000000, true), 1);
    assert.equal(thresholdDestination.getPixel32(0, 0), 0);
    assert.equal(thresholdDestination.getPixel32(1, 0) >>> 24, 0xc0);

    const opaqueThreshold = new BitmapData(1, 1, false, 0xffffffff);
    assert.equal(opaqueThreshold.threshold(thresholdSource, new Rectangle(0, 0, 1, 1), new Point(),
        "==", 0x40000000, 0x80112233, 0xff000000, false), 1);
    assert.equal(opaqueThreshold.getPixel32(0, 0), 0x8009111a);
    const playerOpaqueThreshold = new BitmapData(1, 1, false, 0xffbbccdd);
    const playerTransparentSource = new BitmapData(1, 1, true, 0x12345678);
    assert.equal(playerOpaqueThreshold.threshold(playerTransparentSource, playerTransparentSource.rect, new Point(),
        "==", 0x33333333, 0xaaaaaaaa, 0x00ff0000, true), 0);
    assert.equal(playerOpaqueThreshold.getPixel32(0, 0), 0x12040608);
    assert.throws(() => opaqueThreshold.threshold(thresholdSource, thresholdSource.rect, new Point(),
        "invalid", 0), /operation/);
});

test("Bitmap keeps nullable source identity, nominal type and independent render state", () => {
    const data = new BitmapData(2, 3, true, 0xff123456);
    const bitmap = new Bitmap(data);
    assert.ok(bitmap instanceof DisplayObject);
    assert.equal(isFlashBitmap(bitmap), true);
    assert.equal(isFlashBitmap(Object.create(Bitmap.prototype)), false);
    assert.equal(isFlashBitmapData(data), true);
    assert.equal(isFlashBitmapData({ width: 2, height: 3 }), false);
    assert.equal(bitmap.bitmapData, data);
    assert.equal(bitmap.pixelSnapping, PixelSnapping.AUTO);
    assert.equal(bitmap.smoothing, false);
    bitmap.pixelSnapping = PixelSnapping.ALWAYS;
    bitmap.smoothing = true;
    assert.equal(bitmap.pixelSnapping, "always");
    assert.equal(bitmap.smoothing, true);
    assert.throws(() => { bitmap.pixelSnapping = "sometimes"; }, /pixelSnapping/);
    assert.equal(bitmap.pixelSnapping, "always");
    bitmap.bitmapData = null;
    assert.equal(bitmap.bitmapData, null);
    assert.throws(() => { bitmap.bitmapData = {} as BitmapData; }, TypeError);
    bitmap.destroy();
});

test("shared BitmapData owns two sampling backings and disposes each exactly once", () => {
    const previousTextureContext = LayaGL.textureContext;
    let creates = 0, disposals = 0;
    const uploads: number[][] = [];
    LayaGL.textureContext = {
        createTextureInternal: (_dimension: unknown, width: number, height: number) => {
            creates++;
            return {
                width, height, filterMode: 0, wrapU: 0, wrapV: 0, wrapW: 0,
                mipmap: false, mipmapCount: 1, useSRGBLoad: true, gammaCorrection: 1,
                dispose: () => disposals++,
            };
        },
        setTexturePixelsData: (_texture: unknown, pixels: Uint8Array) => uploads.push(Array.from(pixels)),
    } as any;
    try {
        const data = new BitmapData(2, 2, true, 0xff010203);
        const pointA = new Bitmap(data, PixelSnapping.AUTO, false);
        const pointB = new Bitmap(data, PixelSnapping.ALWAYS, false);
        assert.equal(creates, 1);
        assert.equal(uploads.length, 1);
        assert.equal(pointA.bitmapData, pointB.bitmapData);
        data.setPixel32(0, 0, 0xffaabbcc);
        assert.equal(uploads.length, 2);
        data.lock();
        data.setPixel32(0, 0, 0xff010101);
        data.setPixel32(1, 1, 0xff020202);
        const smooth = new Bitmap(data, PixelSnapping.NEVER, true);
        assert.equal(creates, 2);
        assert.equal(uploads.length, 3);
        assert.deepEqual(uploads[2].slice(0, 4), [0xaa, 0xbb, 0xcc, 0xff]);
        data.unlock();
        assert.equal(uploads.length, 5);
        assert.deepEqual(uploads[3].slice(0, 4), [1, 1, 1, 255]);
        assert.deepEqual(uploads[4].slice(0, 4), [1, 1, 1, 255]);
        data.dispose();
        assert.equal(disposals, 2);
        assert.equal(pointA.texture, null);
        assert.equal(pointB.texture, null);
        assert.equal(smooth.texture, null);
        pointA.destroy(); pointB.destroy(); smooth.destroy();
        assert.equal(disposals, 2);
    } finally {
        LayaGL.textureContext = previousTextureContext;
    }
});

test("Event validates immutable type and listener priority", () => {
    const event = new Event("change");
    assert.equal(event.type, "change");
    assert.throws(() => (event as { type: string }).type = "mutated", TypeError);
    assert.throws(() => (event as { bubbles: boolean }).bubbles = true, TypeError);
    assert.throws(() => (event as { cancelable: boolean }).cancelable = true, TypeError);
    assert.throws(() => new Event(""), /validated string/);
    assert.throws(() => new Event(" change"), /validated string/);
    const dispatcher = new EventDispatcher();
    assert.throws(() => dispatcher.addEventListener("change", () => undefined, false, Number.NaN), /finite/);
});

test("URLRequest preserves exact descriptor bytes and never opens transport", () => {
    const empty = new URLRequest();
    assert.equal(empty.url, null);
    const request = new URLRequest("assets/data.bin?x=%2F");
    assert.equal(request.url, "assets/data.bin?x=%2F");
    request.url = "assets/data.bin?x=%2F&cache=1";
    request.data = { untouched: true };
    request.method = "POST";
    request.contentType = "application/octet-stream";
    request.requestHeaders = [{ name: "X-Test", value: "exact" }];
    assert.deepEqual({ url: request.url, data: request.data, method: request.method,
        contentType: request.contentType, requestHeaders: request.requestHeaders }, {
        url: "assets/data.bin?x=%2F&cache=1", data: { untouched: true }, method: "POST",
        contentType: "application/octet-stream", requestHeaders: [{ name: "X-Test", value: "exact" }]
    });
    assert.throws(() => new URLRequest(1 as unknown as string), /string or null/);
    assert.equal(Object.keys(request).some(key => /socket|transport/i.test(key)), false);
});

test("navigateToURL admits only canonical trap-free GET/_blank browser navigation", () => {
    const previousWindow = Browser.window;
    const previousDomSupport = Browser.isDomSupported;
    const originalHasInstance = Object.getOwnPropertyDescriptor(URLRequest, Symbol.hasInstance);
    const opened: unknown[][] = [];
    let locationReads = 0;
    let hrefReads = 0;
    let openReads = 0;
    const fakeLocation = {} as Location;
    Object.defineProperty(fakeLocation, "href", {
        configurable: true,
        get(): string { hrefReads++; return "https://client.example/game/index.html"; },
    });
    const fakeWindow = {} as Window & typeof globalThis;
    Object.defineProperty(fakeWindow, "location", {
        configurable: true,
        get(): Location { locationReads++; return fakeLocation; },
    });
    Object.defineProperty(fakeWindow, "open", {
        configurable: true,
        get(): (...args: unknown[]) => null {
            openReads++;
            return (...args: unknown[]): null => { opened.push(args); return null; };
        },
    });

    try {
        Browser.isDomSupported = true;
        Browser.window = fakeWindow;

        assert.throws(() => navigateToURL(new URLRequest("javascript:alert(1)"), "_blank"), UnsupportedFlashFeatureError);
        assert.throws(() => navigateToURL(new URLRequest("data:text/plain,blocked"), "_blank"), UnsupportedFlashFeatureError);
        assert.throws(() => navigateToURL(new URLRequest("https://[invalid"), "_blank"), /valid absolute or browser-relative URL/);
        assert.deepEqual([locationReads, hrefReads, openReads, opened.length], [0, 0, 0, 0]);

        const header = { name: "X-Blocked", value: "exact" };
        const pushPop = new URLRequest("https://example.test/");
        pushPop.requestHeaders.push(header);
        pushPop.requestHeaders.pop();
        const setDelete = new URLRequest("https://example.test/");
        setDelete.requestHeaders[0] = header;
        delete setDelete.requestHeaders[0];
        const lengthGrowShrink = new URLRequest("https://example.test/");
        lengthGrowShrink.requestHeaders.length = 2;
        lengthGrowShrink.requestHeaders.length = 0;
        const defineDelete = new URLRequest("https://example.test/");
        Object.defineProperty(defineDelete.requestHeaders, "0", {
            configurable: true, enumerable: true, writable: true, value: header,
        });
        delete defineDelete.requestHeaders[0];
        const prototypeChange = new URLRequest("https://example.test/");
        Object.setPrototypeOf(prototypeChange.requestHeaders, null);
        const preventExtensions = new URLRequest("https://example.test/");
        Object.preventExtensions(preventExtensions.requestHeaders);
        const outerForward = new URLRequest("https://example.test/");
        const outerHeaders = new Proxy(outerForward.requestHeaders, {});
        outerHeaders.push(header);
        outerHeaders.pop();
        for (const value of [pushPop, setDelete, lengthGrowShrink, defineDelete,
            prototypeChange, preventExtensions, outerForward])
            assert.throws(() => navigateToURL(value, "_blank"), UnsupportedFlashFeatureError);
        assert.deepEqual([locationReads, hrefReads, openReads, opened.length], [0, 0, 0, 0]);

        const request = new URLRequest("../account/register?from=game%2Fmenu");
        const getterCounts = { url: 0, method: 0, data: 0, contentType: 0, requestHeaders: 0 };
        for (const name of Object.keys(getterCounts) as Array<keyof typeof getterCounts>) {
            Object.defineProperty(request, name, {
                configurable: true,
                get(): never { getterCounts[name]++; throw new Error(`hostile ${name} getter`); },
            });
        }
        navigateToURL(request, "_blank");
        assert.deepEqual(getterCounts, { url: 0, method: 0, data: 0, contentType: 0, requestHeaders: 0 });
        assert.deepEqual([locationReads, hrefReads, openReads], [1, 1, 1]);
        assert.deepEqual(opened, [["../account/register?from=game%2Fmenu", "_blank", "noopener"]]);

        let proxyTraps = 0;
        const proxied = new Proxy(new URLRequest("https://example.test/"), {
            get(): never { proxyTraps++; throw new Error("proxy get trap"); },
            getPrototypeOf(): never { proxyTraps++; throw new Error("proxy prototype trap"); },
        });
        assert.throws(() => navigateToURL(proxied, "_blank"), /canonical URLRequest/);
        assert.equal(proxyTraps, 0);
        assert.throws(() => navigateToURL(Object.create(URLRequest.prototype), "_blank"), /canonical URLRequest/);
        assert.throws(() => navigateToURL({ url: "https://example.test/" } as URLRequest, "_blank"), /canonical URLRequest/);
        Object.defineProperty(URLRequest, Symbol.hasInstance, { configurable: true, value: () => true });
        assert.throws(() => navigateToURL({} as URLRequest, "_blank"), /canonical URLRequest/);

        const unsupported = [
            Object.assign(new URLRequest("https://example.test/"), { method: "POST" }),
            Object.assign(new URLRequest("https://example.test/"), { data: "payload" }),
            Object.assign(new URLRequest("https://example.test/"), { contentType: "text/plain" }),
            Object.assign(new URLRequest("https://example.test/"), { requestHeaders: [] }),
        ];
        const mutatedDefaultHeaders = new URLRequest("https://example.test/");
        mutatedDefaultHeaders.requestHeaders.push({ name: "X-Blocked", value: "exact" });
        unsupported.push(mutatedDefaultHeaders);
        for (const value of unsupported) assert.throws(() => navigateToURL(value, "_blank"), UnsupportedFlashFeatureError);
        assert.throws(() => navigateToURL(new URLRequest("https://example.test/"), "_self"), UnsupportedFlashFeatureError);
        assert.throws(() => navigateToURL(new URLRequest(), "_blank"), /non-empty URL/);
        assert.throws(() => navigateToURL(new URLRequest("   "), "_blank"), /non-empty URL/);
        assert.equal(opened.length, 1);

        Browser.isDomSupported = false;
        assert.throws(() => navigateToURL(new URLRequest("https://example.test/"), "_blank"), /browser navigation is unavailable/);
        Browser.isDomSupported = true;
        Browser.window = null as unknown as Window & typeof globalThis;
        assert.throws(() => navigateToURL(new URLRequest("https://example.test/"), "_blank"), /browser navigation is unavailable/);
        Browser.window = { location: fakeLocation } as unknown as Window & typeof globalThis;
        assert.throws(() => navigateToURL(new URLRequest("https://example.test/"), "_blank"), /browser navigation is unavailable/);
        assert.equal(opened.length, 1);
        assert.equal(openReads, 1);
    } finally {
        Browser.window = previousWindow;
        Browser.isDomSupported = previousDomSupport;
        if (originalHasInstance) Object.defineProperty(URLRequest, Symbol.hasInstance, originalHasInstance);
        else delete (URLRequest as unknown as Record<PropertyKey, unknown>)[Symbol.hasInstance];
    }
});

test("native keyboard ingress projects one exact Flash KeyboardEvent", () => {
    const target = new DisplayObject();
    let received: KeyboardEvent | null = null;
    target.addEventListener(KeyboardEvent.KEY_DOWN, event => received = event as KeyboardEvent);
    const native = new LayaEvent();
    native.setTo(LayaEvent.KEY_DOWN, target, target);
    native.nativeEvent = {
        key: "p", keyCode: 80, charCode: 112, location: 2,
        ctrlKey: true, altKey: true, shiftKey: false, metaKey: false,
        preventDefault(): void {}, stopPropagation(): void {}
    } as any;
    target.event(LayaEvent.KEY_DOWN, native);
    assert.ok(received);
    assert.equal(received!.type, KeyboardEvent.KEY_DOWN);
    assert.equal(received!.target, target);
    assert.equal(received!.currentTarget, target);
    assert.deepEqual([received!.keyCode, received!.charCode, received!.keyLocation], [80, 112, 2]);
    assert.deepEqual([received!.ctrlKey, received!.altKey, received!.shiftKey], [true, true, false]);
    assert.deepEqual(received!.clone(), new KeyboardEvent(KeyboardEvent.KEY_DOWN, true, false,
        112, 80, 2, true, true, false, true, false));
    const zeroCharCode = new LayaEvent();
    zeroCharCode.nativeEvent = { key: "p", keyCode: 80, charCode: 0, location: 0 } as any;
    assert.equal(KeyboardEvent._fromNative(KeyboardEvent.KEY_DOWN, zeroCharCode).charCode, 112);
    const malformed = new LayaEvent();
    malformed.setTo(LayaEvent.KEY_DOWN, target, target);
    assert.throws(() => KeyboardEvent._fromNative(KeyboardEvent.KEY_DOWN, malformed), /DOM keyboard payload/);
});

test("IOErrorEvent and TimerEvent retain used hierarchy, constants and fields", () => {
    const target = new DisplayObject();
    let io: IOErrorEvent | null = null;
    target.addEventListener(IOErrorEvent.IO_ERROR, event => io = event as IOErrorEvent);
    target.event(IOErrorEvent.IO_ERROR, new Error("network unavailable"));
    assert.ok(io instanceof ErrorEvent);
    assert.equal(io!.text, "network unavailable");
    assert.equal(io!.target, target);
    assert.deepEqual([
        IOErrorEvent.DISK_ERROR, IOErrorEvent.IO_ERROR, IOErrorEvent.NETWORK_ERROR
    ], ["diskError", "ioError", "networkError"]);
    const timer = new TimerEvent(TimerEvent.TIMER_COMPLETE);
    assert.equal(timer.clone().type, "timerComplete");
    assert.throws(() => timer.updateAfterEvent(), UnsupportedFlashFeatureError);
});

test("source-used generic event leaves retain maintained Pepper object and dispatch semantics", () => {
    const progress = new ProgressEvent("progressMutable", true, true, 1.25, 2.5);
    progress.bytesLoaded = "9.75" as unknown as number;
    progress.bytesTotal = -4.5;
    const progressClone = progress.clone();
    progress.bytesLoaded = 101;
    assert.deepEqual([progressClone.type, progressClone.bubbles, progressClone.cancelable,
        progressClone.bytesLoaded, progressClone.bytesTotal], ["progressMutable", true, true, 9.75, -4.5]);
    assert.ok(Number.isNaN(new ProgressEvent("nan", false, false, Number.NaN).bytesLoaded));
    assert.equal(new ProgressEvent("infinity", false, false, 0, Number.POSITIVE_INFINITY).bytesTotal,
        Number.POSITIVE_INFINITY);
    assert.equal(new ProgressEvent("negative-infinity", false, false,
        Number.NEGATIVE_INFINITY).bytesLoaded, Number.NEGATIVE_INFINITY);
    assert.equal(new ProgressEvent("above-uint", false, false,
        4294967297).bytesLoaded, 4294967297);

    const http = new HTTPStatusEvent("httpMutable", true, true, 4294967297, true);
    assert.deepEqual([http.status, http.redirected], [1, true]);
    http.redirected = false;
    (http as unknown as { redirected: unknown }).redirected = 1;
    assert.equal(http.redirected, true);
    assert.equal(new HTTPStatusEvent("negative", false, false, -1.9).status, -1);
    assert.equal(new HTTPStatusEvent("overflow", false, false, 2147483648).status, -2147483648);
    assert.equal(new HTTPStatusEvent("nan", false, false, Number.NaN).status, 0);
    assert.equal(new HTTPStatusEvent("positive-infinity", false, false,
        Number.POSITIVE_INFINITY).status, 0);
    assert.equal(new HTTPStatusEvent("negative-infinity", false, false,
        Number.NEGATIVE_INFINITY).status, 0);
    assert.throws(() => { (http as unknown as { status: number }).status = 202; }, TypeError);
    assert.equal("responseURL" in http, false);
    assert.equal("responseHeaders" in http, false);
    assert.deepEqual([http.clone().status, http.clone().redirected], [1, true]);

    const customText = { toString: (): string => "custom-text" };
    const security = new SecurityErrorEvent("securityMutable", true, true,
        customText as unknown as string, 4294967297);
    assert.deepEqual([security.text, security.errorID], ["custom-text", 1]);
    security.text = "after";
    assert.throws(() => { (security as unknown as { errorID: number }).errorID = 18; }, TypeError);
    assert.deepEqual([security.clone().text, security.clone().errorID], ["after", 1]);
    const nullSecurity = new SecurityErrorEvent("nullText", false, false, null as unknown as string, -1.9);
    assert.equal(nullSecurity.text, null);
    assert.equal(nullSecurity.errorID, -1);
    assert.equal(new SecurityErrorEvent("numericText", false, false,
        123 as unknown as string, 7).text, "123");
    assert.equal(new SecurityErrorEvent("nanID", false, false, "id", Number.NaN).errorID, 0);
    assert.equal(new SecurityErrorEvent("infiniteID", false, false,
        "id", Number.POSITIVE_INFINITY).errorID, 0);

    const mouse = new Sprite();
    const owner = new Sprite();
    const replacement = new Sprite();
    const context = new ContextMenuEvent("contextMutable", true, true, mouse, owner);
    context.mouseTarget = replacement;
    context.contextMenuOwner = mouse;
    context.isMouseTargetInaccessible = 1 as unknown as boolean;
    const contextClone = context.clone();
    assert.deepEqual([contextClone.mouseTarget === replacement, contextClone.contextMenuOwner === mouse,
        contextClone.isMouseTargetInaccessible], [true, true, false]);

    const thrown = new Error("plain-error");
    const uncaught = new UncaughtErrorEvent("uncaughtMutable", undefined, undefined, thrown);
    assert.deepEqual([uncaught.bubbles, uncaught.cancelable, uncaught.error === thrown,
        uncaught.text, uncaught.errorID], [true, true, true, "", 0]);
    assert.equal(uncaught.clone().error, thrown);
    assert.throws(() => { (uncaught as unknown as { error: unknown }).error = "replacement"; }, TypeError);
    assert.throws(() => { (uncaught as unknown as { errorID: number }).errorID = 99; }, TypeError);
    uncaught.text = "replacement-text";
    assert.equal(uncaught.text, "replacement-text");
    const uncaughtValues: unknown[] = [
        new ErrorEvent(ErrorEvent.ERROR, false, false, "event-text", 42),
        "string-value",
        { marker: "object" },
        null,
    ];
    for (const [index, value] of uncaughtValues.entries()) {
        const valueEvent = new UncaughtErrorEvent(`uncaught-${index}`, index % 2 === 1,
            index % 2 === 0, value);
        const valueClone = valueEvent.clone();
        assert.equal(valueEvent.error, value);
        assert.equal(valueClone.error, value);
        assert.notEqual(valueClone, valueEvent);
        assert.ok(valueClone instanceof UncaughtErrorEvent);
        assert.equal(valueEvent.text, "");
        assert.equal(valueEvent.errorID, 0);
    }

    const target = new DisplayObject();
    const received: Event[] = [];
    for (const type of [ProgressEvent.PROGRESS, HTTPStatusEvent.HTTP_STATUS,
        SecurityErrorEvent.SECURITY_ERROR, ContextMenuEvent.MENU_SELECT, UncaughtErrorEvent.UNCAUGHT_ERROR])
        target.addEventListener(type, event => received.push(event));
    target.event(ProgressEvent.PROGRESS, { bytesLoaded: 6.5, bytesTotal: 7.25 });
    target.event(HTTPStatusEvent.HTTP_STATUS, { status: 201, redirected: true });
    target.event(SecurityErrorEvent.SECURITY_ERROR, { text: "denied", errorID: 7 });
    target.event(ContextMenuEvent.MENU_SELECT, { mouseTarget: mouse, contextMenuOwner: owner,
        isMouseTargetInaccessible: true });
    target.event(UncaughtErrorEvent.UNCAUGHT_ERROR, { error: thrown });
    assert.equal(received.length, 5);
    assert.deepEqual(received.map(event => [event.target === target, event.currentTarget === target]),
        Array.from({ length: 5 }, () => [true, true]));
    assert.deepEqual([(received[0] as ProgressEvent).bytesLoaded, (received[0] as ProgressEvent).bytesTotal],
        [6.5, 7.25]);
    assert.deepEqual([(received[1] as HTTPStatusEvent).status, (received[1] as HTTPStatusEvent).redirected],
        [201, true]);
    assert.deepEqual([(received[2] as SecurityErrorEvent).text, (received[2] as SecurityErrorEvent).errorID],
        ["denied", 7]);
    assert.deepEqual([(received[3] as ContextMenuEvent).mouseTarget === mouse,
        (received[3] as ContextMenuEvent).contextMenuOwner === owner,
        (received[3] as ContextMenuEvent).isMouseTargetInaccessible], [true, true, true]);
    assert.equal((received[4] as UncaughtErrorEvent).error, thrown);

    assert.throws(() => ProgressEvent._fromNative(ProgressEvent.PROGRESS, "bad"), TypeError);
    assert.throws(() => HTTPStatusEvent._fromNative(HTTPStatusEvent.HTTP_STATUS, "bad"), TypeError);
    assert.throws(() => SecurityErrorEvent._fromNative(SecurityErrorEvent.SECURITY_ERROR, 7), TypeError);
    assert.throws(() => ContextMenuEvent._fromNative(ContextMenuEvent.MENU_SELECT, 7), TypeError);
});

test("maintained Flash event constants are immutable", () => {
    assert.deepEqual([
        Event.ACTIVATE, Event.ADDED, Event.ADDED_TO_STAGE, Event.CHANGE, Event.CLOSE, Event.COMPLETE,
        Event.CONNECT, Event.DEACTIVATE, Event.ENTER_FRAME, Event.INIT, Event.REMOVED_FROM_STAGE,
        Event.RESIZE, Event.SOUND_COMPLETE,
        FocusEvent.FOCUS_IN, FocusEvent.FOCUS_OUT,
        IOErrorEvent.DISK_ERROR, IOErrorEvent.IO_ERROR, IOErrorEvent.NETWORK_ERROR,
        KeyboardEvent.KEY_DOWN, KeyboardEvent.KEY_UP,
        MouseEvent.CLICK, MouseEvent.DOUBLE_CLICK, MouseEvent.MOUSE_DOWN, MouseEvent.MOUSE_MOVE,
        MouseEvent.MOUSE_OUT, MouseEvent.MOUSE_OVER, MouseEvent.MOUSE_UP, MouseEvent.MOUSE_WHEEL,
        MouseEvent.ROLL_OUT, MouseEvent.ROLL_OVER,
        TextEvent.LINK, TextEvent.TEXT_INPUT,
        TimerEvent.TIMER, TimerEvent.TIMER_COMPLETE,
        ContextMenuEvent.MENU_ITEM_SELECT, ContextMenuEvent.MENU_SELECT,
        HTTPStatusEvent.HTTP_STATUS, ProgressEvent.PROGRESS, SecurityErrorEvent.SECURITY_ERROR,
        UncaughtErrorEvent.UNCAUGHT_ERROR,
    ], [
        "activate", "added", "addedToStage", "change", "close", "complete", "connect", "deactivate",
        "enterFrame", "init", "removedFromStage", "resize", "soundComplete",
        "focusIn", "focusOut", "diskError", "ioError", "networkError", "keyDown", "keyUp",
        "click", "doubleClick", "mouseDown", "mouseMove", "mouseOut", "mouseOver", "mouseUp",
        "mouseWheel", "rollOut", "rollOver", "link", "textInput", "timer", "timerComplete",
        "menuItemSelect", "menuSelect", "httpStatus", "progress", "securityError", "uncaughtError",
    ]);
    for (const constructor of [Event, FocusEvent, IOErrorEvent, KeyboardEvent, MouseEvent, TextEvent, TimerEvent,
        ContextMenuEvent, HTTPStatusEvent, ProgressEvent, SecurityErrorEvent, UncaughtErrorEvent]) {
        assert.equal(Object.isFrozen(constructor), true, constructor.name);
        const stringConstants = Object.values(Object.getOwnPropertyDescriptors(constructor))
            .filter(descriptor => "value" in descriptor && typeof descriptor.value === "string");
        assert.ok(stringConstants.length > 0, constructor.name);
        assert.equal(stringConstants.every(descriptor => descriptor.writable === false
            && descriptor.configurable === false), true, constructor.name);
    }
});

test("Flash Graphics owns state while preserving native command storage", () => {
    const sprite = new Sprite();
    const graphics = sprite.graphics;
    assert.ok(graphics instanceof Graphics);
    graphics.beginFill(0x112233, 0.5);
    graphics.drawRect(1, 2, 30, 40);
    graphics.endFill();
    graphics.lineStyle(2, 0x445566, 0.75);
    graphics.moveTo(3, 4);
    graphics.lineTo(8, 9);
    assert.equal(graphics.cmds.length, 2);
    graphics.clear();
    assert.equal(graphics.cmds.length, 0);
    graphics.drawRect(0, 0, 5, 5);
    assert.equal(graphics.cmds.length, 0, "drawing without Flash paint is a no-op");
    graphics.drawRect(0, 0, 5, 5, "#ffffff");
    assert.equal(graphics.cmds.length, 1, "native Laya drawRect remains available");
    graphics.beginFill(0xabcdef);
    graphics.drawRoundRect(0, 0, 18, 18, 4, 4);
    assert.equal(graphics.cmds.length, 2, "equal Flash ellipse diameters map to native corner radii");
    assert.throws(() => graphics.drawRoundRect(0, 0, 18, 18, 4, 6), UnsupportedFlashFeatureError);
    assert.throws(() => graphics.drawTriangles([0, 0, 1, 1], [0, 1, 2]), UnsupportedFlashFeatureError);
    graphics.clear();
    graphics.lineStyle(1, 0, 1, true);
    graphics.beginFill(0xffffff);
    graphics.moveTo(7, 4);
    graphics.lineTo(13, 9);
    graphics.lineTo(7, 14);
    graphics.lineTo(7, 4);
    assert.equal(graphics.cmds.length, 0, "filled paths remain buffered until endFill");
    graphics.endFill();
    assert.equal(graphics.cmds.length, 1, "retained arrow path becomes one filled native polygon");
    assert.throws(() => graphics.lineStyle(2, 0, 1, true), UnsupportedFlashFeatureError);
    const gradient = new Matrix();
    gradient.createGradientBox(8, 1);
    graphics.beginGradientFill(GradientType.LINEAR, [0, 0xffffff], [1, 1], [0, 255], gradient);
    graphics.drawRect(0, 0, 8, 1);
    graphics.endFill();
    assert.equal(graphics.cmds.length, 9, "linear gradient rectangle emits eight native strips");
    assert.throws(() => graphics.beginGradientFill("radial", [0, 0xffffff], [1, 1], [0, 255], gradient),
        UnsupportedFlashFeatureError);

    const fabricated = Object.create(Graphics.prototype) as Graphics;
    const proxy = new Proxy(new Graphics(), {});
    assert.throws(() => sprite.graphics = fabricated, /requires flash\.display\.Graphics/);
    assert.throws(() => sprite.graphics = proxy, /requires flash\.display\.Graphics/);
    const original = (sprite as any)._graphics;
    (sprite as any)._graphics = fabricated;
    assert.throws(() => sprite.graphics, /source-shaped Graphics seam/);
    (sprite as any)._graphics = original;

    Object.defineProperty(Graphics, Symbol.hasInstance, { configurable: true, value: () => true });
    try {
        assert.equal({} instanceof Graphics, true, "adversarial Symbol.hasInstance is active");
        assert.throws(() => sprite.graphics = {} as Graphics, /requires flash\.display\.Graphics/);
        const shape = new Shape();
        assert.throws(() => shape.graphics = fabricated, /requires flash\.display\.Graphics/);
        const shapeOriginal = (shape as any)._graphics;
        (shape as any)._graphics = fabricated;
        assert.throws(() => shape.graphics, /source-shaped Graphics seam/);
        (shape as any)._graphics = shapeOriginal;
    } finally {
        delete (Graphics as any)[Symbol.hasInstance];
    }
});

test("IBitmapDrawable uses central nominal identity and unattached Shape receives global enterFrame", () => {
    const shape = new Shape();
    const bitmapData: IBitmapDrawable = new BitmapData(1, 1);
    assert.equal(isFlashBitmapDrawable(shape), true);
    assert.equal(isFlashBitmapDrawable(bitmapData), true);
    assert.equal(isFlashBitmapDrawable({}), false);
    assert.equal(isFlashBitmapDrawable(new Proxy(shape, {})), false);
    assert.equal(isFlashBitmapDrawable(Object.create(BitmapData.prototype)), false);
    assert.equal(isFlashBitmapDrawable(new Proxy(bitmapData as BitmapData, {})), false);
    assert.equal(new DisplayObject().graphics instanceof Graphics, false, "base DisplayObject has no Flash Graphics seam");
    let frames = 0;
    const listener = (event: Event): void => {
        frames++;
        assert.equal(event.type, Event.ENTER_FRAME);
        assert.equal(event.target, shape);
    };
    shape.addEventListener(Event.ENTER_FRAME, listener);
    assert.equal(frameCallbacks.length, 1);
    frameCallbacks[0].method.call(frameCallbacks[0].caller);
    assert.equal(frames, 1);
    shape.removeEventListener(Event.ENTER_FRAME, listener);
    assert.equal(frameCallbacks.length, 0);
    shape.addEventListener(Event.ENTER_FRAME, listener);
    shape.destroy();
    assert.equal(frameCallbacks.length, 0, "destroy releases the global frame hook");
});

test("explicit Stage boundary preserves attachment, numeric FPS, focus and bootstrap policy", () => {
    const previousStage = ILaya.stage;
    const previousFPS = Config.FPS;
    const previousInterval = Render.frameInterval;
    const previousCanvas = Browser.mainCanvas;
    const textInputAdapter = (PAL as any).textInput;
    const previousTextInputTarget = textInputAdapter.target;
    const previousTextInputBegin = textInputAdapter.begin;
    const previousTextInputEnd = textInputAdapter.end;
    const stage = new Stage() as any;
    stage.width = 1024;
    stage.height = 768;
    stage.alignH = "center";
    stage.alignV = "middle";
    stage.scaleMode = "showall";
    stage.frameRate = "fast";
    stage.focus = null;
    const previousContextMenu = () => true;
    Browser.mainCanvas = { source: { oncontextmenu: previousContextMenu } } as any;
    textInputAdapter.begin = function (target: unknown): void {
        this.target = target;
        stage.focus = target;
    };
    textInputAdapter.end = function (): void {
        if (stage.focus === this.target) stage.focus = null;
        this.target = null;
    };
    const previousHasInstance = Object.getOwnPropertyDescriptor(Stage, Symbol.hasInstance);
    const previousInputHasInstance = Object.getOwnPropertyDescriptor(LayaInput, Symbol.hasInstance);
    try {
        Object.defineProperty(Stage, Symbol.hasInstance, { configurable: true, value: () => true });
        Object.defineProperty(LayaInput, Symbol.hasInstance, { configurable: true, value: () => true });
        const derivedCounters = { width: 0, focus: 0, configure: 0 };
        class DerivedStage extends Stage {
            constructor() {
                super();
                Object.defineProperties(this, {
                    width: {
                        configurable: true,
                        get: () => { derivedCounters.width++; return 1; },
                    },
                    focus: {
                        configurable: true,
                        get: () => { derivedCounters.focus++; return null; },
                        set: () => { derivedCounters.focus++; },
                    },
                    alignH: {
                        configurable: true,
                        get: () => { derivedCounters.configure++; return "left"; },
                        set: () => { derivedCounters.configure++; },
                    },
                    alignV: {
                        configurable: true,
                        get: () => { derivedCounters.configure++; return "top"; },
                        set: () => { derivedCounters.configure++; },
                    },
                    scaleMode: {
                        configurable: true,
                        get: () => { derivedCounters.configure++; return "noscale"; },
                        set: () => { derivedCounters.configure++; },
                    },
                });
            }
        }
        const derivedStage = new DerivedStage();
        ILaya.stage = derivedStage;
        assert.throws(() => FlashStageBoundary.getWidth(derivedStage), /live canonical Laya Stage/);
        assert.throws(() => FlashStageBoundary.setFocus(derivedStage, null), /live canonical Laya Stage/);
        assert.throws(() => FlashStageBoundary.configure(derivedStage, {
            align: "TL", scaleMode: "noScale", quality: "best", showDefaultContextMenu: false,
            loaderParameters: FlashStageBoundary.parseLoaderParameters("locale=en_US")
        }), /live canonical Laya Stage/);
        assert.deepEqual(derivedCounters, { width: 0, focus: 0, configure: 0 },
            "Stage boundary rejects a branded-subclass attempt before hostile member access");
        const fakeStage = new LayaSprite() as any;
        fakeStage.alignH = "fake";
        let proxyTraps = 0;
        const stageProxy = new Proxy(stage, {
            get(): never { proxyTraps++; throw new Error("Stage Proxy trap"); }
        });
        for (const impostor of [fakeStage, Object.create(Stage.prototype), stageProxy]) {
            ILaya.stage = impostor;
            const fps = Config.FPS;
            const interval = Render.frameInterval;
            assert.throws(() => FlashStageBoundary.setFrameRate(impostor, 24), /live canonical Laya Stage/);
            assert.throws(() => FlashStageBoundary.configure(impostor, {
                align: "TL", scaleMode: "noScale", quality: "best", showDefaultContextMenu: false,
                loaderParameters: FlashStageBoundary.parseLoaderParameters("locale=en_US")
            }), /live canonical Laya Stage/);
            assert.deepEqual([Config.FPS, Render.frameInterval, fakeStage.alignH,
                (Browser.mainCanvas.source as any).oncontextmenu], [fps, interval, "fake", previousContextMenu],
                "unbranded current-singleton rejection is side-effect-free");
        }
        assert.equal(proxyTraps, 0, "native Stage authentication never interrogates a Proxy");

        ILaya.stage = stage;
        const child = new Sprite();
        assert.equal(FlashStageBoundary.stageOf(child), null, "unattached Flash nodes have null Stage");
        stage.addChild(child);
        assert.equal(FlashStageBoundary.stageOf(child), stage);
        FlashStageBoundary.claimViewport(stage, { width: 1024, height: 768 });
        assert.deepEqual([FlashStageBoundary.getWidth(stage), FlashStageBoundary.getHeight(stage)], [1024, 768]);

        FlashStageBoundary.setFrameRate(stage, 33);
        assert.equal(FlashStageBoundary.getFrameRate(stage), 33);
        assert.equal(Render.frameInterval, 1000 / 33);
        assert.equal(stage.frameRate, "fast", "numeric Flash FPS never overwrites Laya's throttle property");
        assert.throws(() => FlashStageBoundary.setFrameRate(stage, 0), /between 0\.01 and 1000/);
        assert.throws(() => FlashStageBoundary.setFrameRate(stage, 1001), /between 0\.01 and 1000/);

        const focus = new InteractiveObject();
        stage.addChild(focus);
        assert.throws(() => setInputEventOwner({} as LayaInput, focus), /canonical Laya Input/,
            "hostile Input Symbol.hasInstance cannot forge the composed-owner registry");
        FlashStageBoundary.setFocus(stage, focus);
        assert.equal(FlashStageBoundary.getFocus(stage), focus);
        stage.removeChild(focus);
        assert.equal(FlashStageBoundary.getFocus(stage), null, "detached focus is normalized to null");
        assert.equal(stage.focus, null, "detached native focus is cleared");
        stage.addChild(focus);
        FlashStageBoundary.setFocus(stage, focus);
        FlashStageBoundary.setFocus(stage, null);
        assert.equal(FlashStageBoundary.getFocus(stage), null);
        assert.throws(() => FlashStageBoundary.setFocus(stage, new InteractiveObject()), /must be attached/);

        const textFocus = new TextField();
        textFocus.type = TextFieldType.INPUT;
        stage.addChild(textFocus);
        FlashStageBoundary.setFocus(stage, textFocus);
        assert.notEqual(stage.focus, textFocus, "native focus remains on the composed Input");
        assert.equal(FlashStageBoundary.getFocus(stage), textFocus,
            "authenticated native Input ownership round-trips to the outer TextField");
        stage.removeChild(textFocus);
        assert.equal(FlashStageBoundary.getFocus(stage), null,
            "detached composed TextField focus normalizes through its outer owner");
        assert.equal(textInputAdapter.target, null, "detached TextField releases the native input adapter");
        stage.addChild(textFocus);
        FlashStageBoundary.setFocus(stage, textFocus);
        FlashStageBoundary.setFocus(stage, null);
        assert.equal(FlashStageBoundary.getFocus(stage), null);

        const parameters = FlashStageBoundary.parseLoaderParameters("?locale=en_US&__proto__=literal");
        let getterCalls = 0;
        const getterParameters = Object.defineProperty({}, "locale", {
            enumerable: true,
            get(): string { getterCalls++; return "hostile"; }
        });
        assert.throws(() => FlashStageBoundary.configure(stage, {
            align: "TL", scaleMode: "noScale", quality: "best",
            showDefaultContextMenu: false, loaderParameters: getterParameters as any
        }), /authenticated search parser/);
        assert.equal(getterCalls, 0, "bootstrap never evaluates loader-parameter getters");
        let parameterProxyTraps = 0;
        const proxyParameters = new Proxy(parameters, {
            ownKeys(): ArrayLike<string | symbol> { parameterProxyTraps++; throw new Error("trap"); },
            getOwnPropertyDescriptor(): PropertyDescriptor | undefined { parameterProxyTraps++; throw new Error("trap"); },
            get(): unknown { parameterProxyTraps++; throw new Error("trap"); }
        });
        assert.throws(() => FlashStageBoundary.configure(stage, {
            align: "TL", scaleMode: "noScale", quality: "best",
            showDefaultContextMenu: false, loaderParameters: proxyParameters as any
        }), /authenticated search parser/);
        assert.equal(parameterProxyTraps, 0, "bootstrap never interrogates an unbranded Proxy");
        assert.throws(() => FlashStageBoundary.parseLoaderParameters("locale=en&locale=de"), /duplicated/);

        const tMainBootstrap = FlashStageBoundary.configure(stage, {
            align: "TL", scaleMode: "noScale", quality: "best",
            showDefaultContextMenu: false, loaderParameters: parameters
        });
        assert.equal(tMainBootstrap.quality, "best", "maintained TMain StageQuality.BEST is preserved");
        const bootstrap = FlashStageBoundary.configure(stage, {
            align: "TL", scaleMode: "noScale", quality: "high",
            showDefaultContextMenu: false, loaderParameters: parameters
        });
        assert.equal(bootstrap.quality, "high", "maintained TApplication StageQuality.HIGH is preserved");
        assert.deepEqual([stage._alignH, stage._alignV, stage._scaleMode], ["left", "top", "noscale"],
            "Flash bootstrap maps onto native Stage adaptation state");
        assert.equal(Object.getPrototypeOf(bootstrap.loaderParameters), null);
        assert.equal(bootstrap.loaderParameters.__proto__, "literal");
        assert.equal(Object.isFrozen(bootstrap.loaderParameters), true);
        assert.equal((Browser.mainCanvas.source as any).oncontextmenu(), false);
        assert.equal(FlashStageBoundary.getBootstrap(stage), bootstrap, "bootstrap identity is stable");
        assert.throws(() => FlashStageBoundary.configure(stage, { ...bootstrap,
            loaderParameters: FlashStageBoundary.parseLoaderParameters("locale=de_DE") }), /immutable/);

        let activated = 0;
        const onActivate = (event: Event): void => {
            activated++;
            assert.equal(event.type, Event.ACTIVATE);
            assert.equal(event.target, stage);
        };
        FlashStageBoundary.addEventListener(stage, Event.ACTIVATE, onActivate);
        stage.event(LayaEvent.FOCUS);
        assert.equal(activated, 1);
        FlashStageBoundary.removeEventListener(stage, Event.ACTIVATE, onActivate);
        FlashStageBoundary.dispose(stage);
        assert.equal((Browser.mainCanvas.source as any).oncontextmenu, previousContextMenu,
            "Stage disposal restores the exact prior context-menu policy");
    } finally {
        ILaya.stage = previousStage;
        Config.FPS = previousFPS;
        Render.frameInterval = previousInterval;
        Browser.mainCanvas = previousCanvas;
        textInputAdapter.target = previousTextInputTarget;
        textInputAdapter.begin = previousTextInputBegin;
        textInputAdapter.end = previousTextInputEnd;
        if (previousHasInstance) Object.defineProperty(Stage, Symbol.hasInstance, previousHasInstance);
        else delete (Stage as any)[Symbol.hasInstance];
        if (previousInputHasInstance) Object.defineProperty(LayaInput, Symbol.hasInstance, previousInputHasInstance);
        else delete (LayaInput as any)[Symbol.hasInstance];
    }
});

test("Stage viewport ownership publishes one validated atomic pair through the Laya boundary", () => {
    const previousStage = ILaya.stage;
    try {
        const stage = new Stage() as any;
        ILaya.stage = stage;
        const reads: string[] = [];
        const snapshots: Array<[number, number, boolean, boolean, unknown, unknown]> = [];
        FlashStageBoundary.addEventListener(stage, Event.RESIZE, event => snapshots.push([
            FlashStageBoundary.getWidth(stage), FlashStageBoundary.getHeight(stage),
            event.bubbles, event.cancelable, event.target, event.currentTarget
        ]));

        const owner = FlashStageBoundary.claimViewport(stage, {
            get width() { reads.push("width"); return 1250; },
            get height() { reads.push("height"); return 650; }
        });
        assert.deepEqual(reads, ["width", "height"], "initial dimensions are snapshotted exactly once in order");
        assert.deepEqual([owner.stageWidth, owner.stageHeight], [1250, 650]);
        assert.deepEqual([FlashStageBoundary.getWidth(stage), FlashStageBoundary.getHeight(stage)], [1250, 650]);
        assert.deepEqual(snapshots, [], "initial design viewport is published silently");

        let duplicateReads = 0;
        assert.throws(() => FlashStageBoundary.claimViewport(stage, {
            get width() { duplicateReads++; return 1920; },
            get height() { duplicateReads++; return 1080; }
        }), /already has a viewport owner/);
        assert.equal(duplicateReads, 0, "duplicate rejection precedes caller-controlled reads");

        owner.resizeViewport(1366, 768);
        owner.resizeViewport(1366, 768);
        assert.deepEqual(snapshots, [[1366, 768, false, false, stage, stage]],
            "one non-bubbling RESIZE observes the complete committed pair");

        const invalid: Array<[number, number]> = [
            [-1, 768], [1366, -1], [1366.5, 768], [1366, 768.5],
            [Number.NaN, 768], [1366, Number.POSITIVE_INFINITY],
            [Number.MAX_SAFE_INTEGER + 1, 768]
        ];
        for (const pair of invalid) assert.throws(() => owner.resizeViewport(...pair), RangeError);
        assert.deepEqual([owner.stageWidth, owner.stageHeight, snapshots.length], [1366, 768, 1],
            "invalid changes publish neither half nor an event");

        const resizeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(owner), "resizeViewport");
        const widthDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(owner), "stageWidth");
        const heightDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(owner), "stageHeight");
        assert.equal(typeof resizeDescriptor?.value, "function");
        for (const descriptor of [widthDescriptor, heightDescriptor]) {
            assert.equal(typeof descriptor?.get, "function");
            assert.equal(descriptor?.set, undefined);
        }
        assert.deepEqual(Reflect.ownKeys(owner), [], "owner carries no public backing state");
        assert.equal(Reflect.ownKeys(stage).some(key => /stage(?:Width|Height)|viewport/i.test(String(key))), false,
            "native Stage carries no Flash viewport backing state");
        assert.throws(() => Reflect.apply(resizeDescriptor?.value, {}, [1600, 900]), /exact engine-issued owner/);
        assert.deepEqual([owner.stageWidth, owner.stageHeight, snapshots.length], [1366, 768, 1]);

        const failure = new Error("fixture RESIZE listener failure");
        const throwing = (): never => { throw failure; };
        FlashStageBoundary.addEventListener(stage, Event.RESIZE, throwing, false, 10);
        assert.throws(() => owner.resizeViewport(1440, 900), error => error === failure);
        assert.deepEqual([owner.stageWidth, owner.stageHeight], [1440, 900],
            "listener failure cannot roll back a committed pair");
        FlashStageBoundary.removeEventListener(stage, Event.RESIZE, throwing);

        stage.destroy(false);
        assert.throws(() => owner.resizeViewport(Number.NaN, -1), /live canonical Laya Stage/,
            "destroyed Stage rejection precedes viewport input validation");
        assert.deepEqual([owner.stageWidth, owner.stageHeight], [1440, 900],
            "destroy preserves the last committed private pair");
    } finally {
        ILaya.stage = previousStage;
    }
});

test("Stage viewport claim resists reentrant getters and failed initialization", () => {
    const previousStage = ILaya.stage;
    try {
        const reentrantStage = new Stage() as any;
        ILaya.stage = reentrantStage;
        const reads: string[] = [];
        let winner: ReturnType<typeof FlashStageBoundary.claimViewport> | undefined;
        assert.throws(() => FlashStageBoundary.claimViewport(reentrantStage, {
            get width() {
                reads.push("outer-width");
                winner = FlashStageBoundary.claimViewport(reentrantStage, { width: 320, height: 200 });
                return 1250;
            },
            get height() { reads.push("outer-height"); return 650; }
        }), /already has a viewport owner/);
        assert.deepEqual(reads, ["outer-width", "outer-height"]);
        assert.ok(winner);
        assert.deepEqual([winner.stageWidth, winner.stageHeight], [320, 200]);
        winner.resizeViewport(640, 400);
        assert.deepEqual([FlashStageBoundary.getWidth(reentrantStage),
            FlashStageBoundary.getHeight(reentrantStage)], [640, 400]);

        const throwingStage = new Stage() as any;
        ILaya.stage = throwingStage;
        const failure = new Error("fixture viewport height failure");
        const failureReads: string[] = [];
        assert.throws(() => FlashStageBoundary.claimViewport(throwingStage, {
            get width() { failureReads.push("width"); return 1024; },
            get height(): number { failureReads.push("height"); throw failure; }
        }), error => error === failure);
        assert.deepEqual(failureReads, ["width", "height"]);
        assert.throws(() => FlashStageBoundary.getWidth(throwingStage), /has not been claimed/);
        const recovered = FlashStageBoundary.claimViewport(throwingStage, { width: 1024, height: 576 });
        assert.deepEqual([recovered.stageWidth, recovered.stageHeight], [1024, 576]);

        const destroyedStage = new Stage() as any;
        ILaya.stage = destroyedStage;
        assert.throws(() => FlashStageBoundary.claimViewport(destroyedStage, {
            get width() { return 1280; },
            get height() { destroyedStage.destroy(false); return 720; }
        }), /live canonical Laya Stage/);
        assert.throws(() => FlashStageBoundary.getWidth(destroyedStage), /live canonical Laya Stage/);

        const replacedStage = new Stage() as any;
        const replacement = new Stage() as any;
        ILaya.stage = replacedStage;
        assert.throws(() => FlashStageBoundary.claimViewport(replacedStage, {
            get width() { ILaya.stage = replacement; return 800; },
            get height() { return 600; }
        }), /live canonical Laya Stage/);
        ILaya.stage = replacedStage;
        const replacementSafe = FlashStageBoundary.claimViewport(replacedStage, { width: 800, height: 600 });
        assert.deepEqual([replacementSafe.stageWidth, replacementSafe.stageHeight], [800, 600]);
    } finally {
        ILaya.stage = previousStage;
    }
});

test("priority, duplicate identity, cancellation and removal preserve Flash behavior", () => {
    const dispatcher = new EventDispatcher();
    const calls: string[] = [];
    const low = (event: Event) => calls.push(`low:${event.type}`);
    const high = (event: Event) => { calls.push(`high:${event.type}`); event.preventDefault(); };
    dispatcher.addEventListener(Event.CHANGE, low, false, 0);
    dispatcher.addEventListener(Event.CHANGE, high, false, 10);
    dispatcher.addEventListener(Event.CHANGE, high, false, 10);
    assert.equal(dispatcher.dispatchEvent(new Event(Event.CHANGE, false, true)), false);
    assert.deepEqual(calls, ["high:change", "low:change"]);
    dispatcher.removeEventListener(Event.CHANGE, high);
    calls.length = 0;
    dispatcher.dispatchEvent(new Event(Event.CHANGE));
    assert.deepEqual(calls, ["low:change"]);
});

test("EventDispatcher aggregation retains dispatcher listener ownership", () => {
    const aggregate = new EventDispatcher();
    const dispatcher = new EventDispatcher(aggregate);
    let own = 0;
    let foreign = 0;
    dispatcher.addEventListener(Event.CHANGE, event => {
        own++;
        assert.equal(event.currentTarget, dispatcher);
        assert.equal(event.target, aggregate);
    });
    aggregate.addEventListener(Event.CHANGE, () => foreign++);
    dispatcher.dispatchEvent(new Event(Event.CHANGE));
    assert.equal(own, 1);
    assert.equal(foreign, 0);
});

test("one Event instance traverses capture, target and bubble in real Laya parent order", () => {
    const root = new DisplayObject();
    const middle = new DisplayObject();
    const target = new DisplayObject();
    root.addChild(middle); middle.addChild(target);
    const seen: Event[] = [];
    const calls: string[] = [];
    root.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push(`root-c:${event.eventPhase}`); seen.push(event); }, true);
    middle.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push(`middle-c:${event.eventPhase}`); seen.push(event); }, true);
    target.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push(`target:${event.eventPhase}`); seen.push(event); });
    middle.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push(`middle-b:${event.eventPhase}`); seen.push(event); });
    root.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push(`root-b:${event.eventPhase}`); seen.push(event); });
    const native = nativeMouse(LayaEvent.MOUSE_DOWN, target, 10, 12, 1);
    target.event(LayaEvent.MOUSE_DOWN, native);
    // Native InputManager would continue bubbling; the routed marker prevents duplicate delivery.
    native.setTo(LayaEvent.MOUSE_DOWN, middle, target); middle.event(LayaEvent.MOUSE_DOWN, native);
    native.setTo(LayaEvent.MOUSE_DOWN, root, target); root.event(LayaEvent.MOUSE_DOWN, native);
    assert.deepEqual(calls, [
        `root-c:${EventPhase.CAPTURING_PHASE}`, `middle-c:${EventPhase.CAPTURING_PHASE}`,
        `target:${EventPhase.AT_TARGET}`, `middle-b:${EventPhase.BUBBLING_PHASE}`,
        `root-b:${EventPhase.BUBBLING_PHASE}`
    ]);
    assert.ok(seen.every(event => event === seen[0]));
    assert.equal(seen[0].target, target);
    native.setTo(LayaEvent.MOUSE_DOWN, target, target);
    target.event(LayaEvent.MOUSE_DOWN, native);
    assert.equal(calls.length, 10, "a persistent TouchInfo Event starts a fresh dispatch at its target");
});

test("stopPropagation controls the native event and prevents ancestor bubble", () => {
    const parent = new DisplayObject();
    const child = new DisplayObject();
    parent.addChild(child);
    const calls: string[] = [];
    child.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push("child"); event.stopPropagation(); });
    parent.addEventListener(MouseEvent.MOUSE_DOWN, _event => calls.push("parent"));
    const native = nativeMouse(LayaEvent.MOUSE_DOWN, child, 1, 2, 1);
    child.event(LayaEvent.MOUSE_DOWN, native);
    assert.equal(native._stopped, true);
    assert.deepEqual(calls, ["child"]);
});

test("mouse local coordinates, buttons and roll non-bubbling semantics are projected", () => {
    const parent = new DisplayObject();
    const child = new DisplayObject();
    child.pos(5, 7); parent.addChild(child);
    let mouse: MouseEvent | null = null;
    let parentRolls = 0;
    child.addEventListener(MouseEvent.MOUSE_DOWN, event => mouse = event as MouseEvent);
    child.addEventListener(MouseEvent.ROLL_OVER, event => { assert.equal(event.bubbles, false); });
    parent.addEventListener(MouseEvent.ROLL_OVER, _event => parentRolls++);
    child.event(LayaEvent.MOUSE_DOWN, nativeMouse(LayaEvent.MOUSE_DOWN, child, 15, 19, 1));
    assert.ok(mouse);
    assert.equal(mouse!.localX, 10); assert.equal(mouse!.localY, 12);
    assert.equal(mouse!.stageX, 15); assert.equal(mouse!.stageY, 19);
    assert.equal(mouse!.buttonDown, true);
    child.event(LayaEvent.MOUSE_OVER, nativeMouse(LayaEvent.MOUSE_OVER, child, 15, 19, 0));
    assert.equal(parentRolls, 0);
    const parentBoundary = nativeMouse(LayaEvent.MOUSE_OVER, parent, 15, 19, 0);
    parent.event(LayaEvent.MOUSE_OVER, parentBoundary);
    assert.equal(parentRolls, 1);
});

test("DisplayObjectContainer mouseChildren redirects child hits to the container", () => {
    const container = new DisplayObjectContainer();
    const child = new DisplayObject();
    container.size(40, 40);
    child.size(20, 20);
    container.mouseEnabled = true;
    child.mouseEnabled = true;
    container.addChild(child);
    const manager = new InputManager();

    assert.equal(container.mouseChildren, true);
    assert.equal(manager.getSpriteUnderPoint(container as unknown as LayaSprite, 5, 5), child);
    container.mouseChildren = false;
    assert.equal(manager.getSpriteUnderPoint(container as unknown as LayaSprite, 5, 5), container);
    container.mouseChildren = true;
    assert.equal(manager.getSpriteUnderPoint(container as unknown as LayaSprite, 5, 5), child);
});

test("SimpleButton state replacement is clean and hitTestState drives InputManager", () => {
    const up = state(20, 10), over = state(20, 10), down = state(20, 10), hit = state(20, 10);
    const button = new SimpleButton(up, over, down, hit);
    const replacement = state(30, 12);
    button.upState = replacement;
    assert.equal(up.parent, null);
    assert.equal(replacement.parent, button);
    const manager = new InputManager();
    assert.equal(manager.hitTest(button as unknown as LayaSprite, 19, 9), true);
    assert.equal(manager.hitTest(button as unknown as LayaSprite, 20, 9), false);
    assert.equal(hit.visible, false);
    button.event(LayaEvent.MOUSE_DOWN, nativeMouse(LayaEvent.MOUSE_DOWN, button, 2, 2, 1));
    assert.equal(down.visible, true);
    button.enabled = false;
    assert.equal(button.mouseEnabled, false);
    button.mouseEnabled = false;
    button.enabled = true;
    assert.equal(button.mouseEnabled, false, "authored mouseEnabled survives enabled toggles");

    const priorUp = button.upState;
    assert.throws(() => button.upState = button as DisplayObject, /ancestors/);
    assert.equal(button.upState, priorUp, "self rejection is atomic");
    const ancestor = new DisplayObject(); ancestor.addChild(button);
    assert.throws(() => button.upState = ancestor, /ancestors/);
    assert.equal(button.upState, priorUp, "ancestor rejection is atomic");
    ancestor.removeChild(button);

    class HostileMouseState extends DisplayObject {
        override get mouseEnabled(): boolean { return super.mouseEnabled; }
        override set mouseEnabled(value: boolean) {
            if (!value) throw new Error("hostile mouse setter");
            super.mouseEnabled = value;
        }
    }
    const hostileMouse = new HostileMouseState();
    button.overState = hostileMouse;
    assert.equal(button.overState, hostileMouse);
    assert.equal(over.parent, null);
    assert.equal(hostileMouse.parent, button);
    assert.equal(hostileMouse.mouseEnabled, false, "native state mutation bypasses hostile override");

    class HostileAttachButton extends SimpleButton {
        attachCalls = 0;
        override addChild<T extends LayaNode>(node: T): T {
            this.attachCalls++;
            super.addChild(node);
            throw new Error("hostile attach");
        }
    }
    const hostileButton = new HostileAttachButton();
    const attachState = state(4, 4);
    hostileButton.upState = attachState;
    assert.equal(hostileButton.attachCalls, 0);
    assert.equal(hostileButton.upState, attachState);
    assert.equal(attachState.parent, hostileButton);

    class HostileBeforeRemoveButton extends SimpleButton {
        removeCalls = 0;
        override removeChild<T extends LayaNode>(_node: T): T {
            this.removeCalls++;
            throw new Error("hostile remove before");
        }
    }
    class HostileAfterRemoveButton extends SimpleButton {
        removeCalls = 0;
        override removeChild<T extends LayaNode>(node: T): T {
            this.removeCalls++;
            super.removeChild(node);
            throw new Error("hostile remove after");
        }
    }
    for (const hostileRemove of [new HostileBeforeRemoveButton(state(3, 3)), new HostileAfterRemoveButton(state(3, 3))]) {
        const oldState = hostileRemove.upState!;
        const nextState = state(5, 5);
        hostileRemove.upState = nextState;
        assert.equal(hostileRemove.removeCalls, 0);
        assert.equal(hostileRemove.upState, nextState);
        assert.equal(nextState.parent, hostileRemove);
        assert.equal(oldState.parent, null);
    }

    class HostileBeforeSetParentState extends DisplayObject {
        setParentCalls = 0;
        protected override _setParent(_value: LayaNode, _index: number = -1): void {
            this.setParentCalls++;
            throw new Error("hostile _setParent before");
        }
    }
    class HostileAfterSetParentState extends DisplayObject {
        setParentCalls = 0;
        protected override _setParent(value: LayaNode, index: number = -1): void {
            this.setParentCalls++;
            super._setParent(value, index);
            throw new Error("hostile _setParent after");
        }
    }
    for (const hostileState of [new HostileBeforeSetParentState(), new HostileAfterSetParentState()]) {
        hostileState.name = "hostile";
        hostileState.mouseEnabled = true;
        hostileState.visible = true;
        const beforeState = button.upState;
        const beforeChildren = Array.from(button.children);
        assert.throws(() => button.upState = hostileState, /canonical Laya DisplayObject _setParent/);
        assert.equal(hostileState.setParentCalls, 0, "hostile lifecycle override is rejected before invocation");
        assert.equal(button.upState, beforeState);
        assert.deepEqual(Array.from(button.children), beforeChildren);
        assert.ok(hostileState.parent == null);
        assert.equal(hostileState.name, "hostile");
        assert.equal(hostileState.mouseEnabled, true);
        assert.equal(hostileState.visible, true);
    }

    const reentrantState = state(7, 7);
    const beforeReentrantState = button.upState;
    const beforeReentrantChildren = Array.from(button.children);
    const internals = (node: LayaNode) => node as unknown as {
        _children: LayaNode[]; _$children: LayaNode[];
        _parent: LayaNode | null | undefined; _$parent: LayaNode | null | undefined;
        _$container: LayaNode; _destroyed: boolean;
    };
    const beforeActualChildren = Array.from(internals(button)._children);
    const beforeOldActualParent = beforeReentrantState ? internals(beforeReentrantState)._parent : undefined;
    const beforeOldLogicalParent = beforeReentrantState ? internals(beforeReentrantState)._$parent : undefined;
    const beforeCandidateActualParent = internals(reentrantState)._parent;
    const beforeCandidateLogicalParent = internals(reentrantState)._$parent;
    reentrantState.on(LayaEvent.ADDED, reentrantState, () => {
        try { reentrantState.removeSelf(); } catch { }
    });
    assert.throws(() => button.upState = reentrantState, /poisoned/);
    assert.equal(button.upState, beforeReentrantState, "reentrant ADDED rejection restores the state slot");
    assert.deepEqual(Array.from(button.children), beforeReentrantChildren, "reentrant ADDED rejection restores exact child order");
    assert.deepEqual(internals(button)._children, beforeActualChildren, "rollback restores the actual engine child array");
    if (beforeReentrantState) {
        assert.equal(internals(beforeReentrantState)._parent, beforeOldActualParent);
        assert.equal(internals(beforeReentrantState)._$parent, beforeOldLogicalParent);
    }
    assert.equal(internals(reentrantState)._parent, beforeCandidateActualParent);
    assert.equal(internals(reentrantState)._$parent, beforeCandidateLogicalParent);

    for (const phase of [LayaEvent.ADDED, LayaEvent.REMOVED]) {
        for (const nestedSlot of ["same", "cross"] as const) {
            const initialUp = state(9, 9), initialOver = state(10, 10);
            const guarded = new SimpleButton(initialUp, initialOver);
            const candidate = state(11, 11), nested = state(12, 12);
            const beforeChildren = Array.from(guarded.children);
            const trigger = phase === LayaEvent.ADDED ? candidate : initialUp;
            let nestedAttempts = 0;
            trigger.on(phase, trigger, () => {
                nestedAttempts++;
                try {
                    if (nestedSlot === "same") guarded.upState = nested;
                    else guarded.overState = nested;
                } catch { /* outer transaction must remain poisoned even when the handler catches this */ }
            });
            assert.throws(() => guarded.upState = candidate, /poisoned by reentrant state or child mutation/);
            assert.equal(nestedAttempts, 1, `${phase}/${nestedSlot} adversary ran exactly once`);
            assert.equal(guarded.upState, initialUp);
            assert.equal(guarded.overState, initialOver);
            assert.deepEqual(Array.from(guarded.children), beforeChildren);
            assert.deepEqual(internals(guarded)._children, beforeChildren);
            assert.equal(internals(initialUp)._parent, guarded);
            assert.equal(internals(initialUp)._$parent, guarded);
            assert.equal(internals(initialOver)._parent, guarded);
            assert.equal(internals(initialOver)._$parent, guarded);
            assert.ok(candidate.parent == null);
            assert.ok(nested.parent == null);
            assert.equal(guarded.children.includes(candidate), false);
            assert.equal(guarded.children.includes(nested), false);
        }
    }

    const siblingUp = state(13, 13), siblingOver = state(14, 14);
    const siblingGuarded = new SimpleButton(siblingUp, siblingOver);
    const siblingCandidate = state(15, 15);
    const siblingChildren = Array.from(siblingGuarded.children);
    siblingCandidate.on(LayaEvent.ADDED, siblingCandidate, () => {
        try { siblingOver.removeSelf(); } catch { }
        try { siblingCandidate.removeSelf(); } catch { }
    });
    assert.throws(() => siblingGuarded.upState = siblingCandidate, /poisoned by reentrant state or child mutation/);
    assert.equal(siblingGuarded.upState, siblingUp);
    assert.equal(siblingGuarded.overState, siblingOver);
    assert.deepEqual(Array.from(siblingGuarded.children), siblingChildren);
    assert.deepEqual(internals(siblingGuarded)._children, siblingChildren);
    assert.equal(internals(siblingUp)._parent, siblingGuarded);
    assert.equal(internals(siblingUp)._$parent, siblingGuarded);
    assert.equal(internals(siblingOver)._parent, siblingGuarded);
    assert.equal(internals(siblingOver)._$parent, siblingGuarded);
    assert.ok(siblingCandidate.parent == null);
    assert.equal(siblingGuarded.children.includes(siblingCandidate), false);

    for (const prototypeAttack of ["remove", "add"] as const) {
        const prototypeUp = state(16, 16), prototypeOver = state(17, 17);
        const prototypeGuarded = new SimpleButton(prototypeUp, prototypeOver);
        const prototypeCandidate = state(18, 18), introduced = state(19, 19);
        const prototypeChildren = Array.from(prototypeGuarded.children);
        prototypeCandidate.on(LayaEvent.ADDED, prototypeCandidate, () => {
            try {
                if (prototypeAttack === "remove")
                    LayaNode.prototype.removeChild.call(prototypeGuarded, prototypeOver);
                else
                    LayaNode.prototype.addChildAt.call(prototypeGuarded, introduced, prototypeGuarded.numChildren);
            } catch { /* the canonical primitive must poison the outer transaction before mutation */ }
        });
        assert.throws(() => prototypeGuarded.upState = prototypeCandidate, /poisoned by reentrant state or child mutation/);
        assert.equal(prototypeGuarded.upState, prototypeUp);
        assert.equal(prototypeGuarded.overState, prototypeOver);
        assert.deepEqual(Array.from(prototypeGuarded.children), prototypeChildren);
        assert.deepEqual(internals(prototypeGuarded)._children, prototypeChildren);
        assert.equal(internals(prototypeUp)._parent, prototypeGuarded);
        assert.equal(internals(prototypeUp)._$parent, prototypeGuarded);
        assert.equal(internals(prototypeOver)._parent, prototypeGuarded);
        assert.equal(internals(prototypeOver)._$parent, prototypeGuarded);
        assert.ok(prototypeCandidate.parent == null);
        assert.ok(introduced.parent == null);
        assert.equal(prototypeGuarded.children.includes(prototypeCandidate), false);
        assert.equal(prototypeGuarded.children.includes(introduced), false);
    }

    for (const internalAttack of ["setParent", "setContainer", "maskHook", "privateFields", "nestedTransaction", "destroy"] as const) {
        const internalUp = state(20, 20), internalOver = state(21, 21);
        const internalGuarded = new SimpleButton(internalUp, internalOver);
        const internalCandidate = state(22, 22), rogue = state(23, 23);
        const internalChildren = Array.from(internalGuarded.children);
        internalCandidate.on(LayaEvent.ADDED, internalCandidate, () => {
            try {
                if (internalAttack === "setParent") {
                    (LayaNode.prototype as unknown as { _setParent(value: LayaNode | null): void })
                        ._setParent.call(internalOver, null);
                } else if (internalAttack === "setContainer") {
                    LayaNode.prototype._setContainer.call(internalGuarded, rogue);
                } else if (internalAttack === "maskHook") {
                    Object.defineProperty(internalGuarded, "_beforeChildMutation", {
                        configurable: true, value: (LayaNode.prototype as unknown as Record<string, unknown>)._beforeChildMutation,
                    });
                    try { LayaNode.prototype.removeChild.call(internalGuarded, internalOver); }
                    finally { delete (internalGuarded as unknown as Record<string, unknown>)._beforeChildMutation; }
                } else if (internalAttack === "privateFields") {
                    const exposed = internalGuarded as unknown as Record<string, unknown>;
                    exposed._stateChildMutationPermit = 1;
                    exposed._stateTransaction = null;
                    try {
                        assert.equal(exposed._runStateChildMutation, undefined);
                        LayaNode.prototype.addChildAt.call(internalGuarded, rogue, internalGuarded.numChildren);
                    } finally {
                        delete exposed._stateChildMutationPermit;
                        delete exposed._stateTransaction;
                    }
                } else if (internalAttack === "nestedTransaction") {
                    beginNodeMutationTransaction([internalGuarded], () => { throw new Error("foreign guard"); });
                } else {
                    internalGuarded.destroy(false);
                }
            } catch { /* direct canonical/internal calls must poison before their first mutation */ }
        });
        assert.throws(() => internalGuarded.upState = internalCandidate, /poisoned by reentrant state or child mutation/);
        assert.equal(internalGuarded.destroyed, false);
        assert.equal(internalGuarded.upState, internalUp);
        assert.equal(internalGuarded.overState, internalOver);
        assert.deepEqual(Array.from(internalGuarded.children), internalChildren);
        assert.deepEqual(internals(internalGuarded)._children, internalChildren);
        assert.equal(internals(internalUp)._parent, internalGuarded);
        assert.equal(internals(internalUp)._$parent, internalGuarded);
        assert.equal(internals(internalOver)._parent, internalGuarded);
        assert.equal(internals(internalOver)._$parent, internalGuarded);
        assert.ok(internalCandidate.parent == null);
        assert.ok(rogue.parent == null);
        assert.equal(internalGuarded.children.includes(internalCandidate), false);
        assert.equal(internalGuarded.children.includes(rogue), false);
    }

    for (const descendantAttack of [
        "add", "setContainer", "setParent", "array", "parentFields", "destroyChildren", "derivedDestroy",
    ] as const) {
        const roots = [state(24, 24), state(25, 25), state(26, 26), state(27, 27)];
        const branches = roots.map((root, index) => {
            const branch = state(8 + index, 8 + index);
            const leaf = state(3 + index, 3 + index);
            branch.addChild(leaf);
            root.addChild(branch);
            return { branch, leaf };
        });
        const recursiveButton = new SimpleButton(roots[0], roots[1], roots[2], roots[3]);
        const candidate = state(28, 28), introduced = state(4, 4), foreign = state(5, 5), rogueContainer = state(6, 6);
        const rootChildren = roots.map(root => Array.from(root.children));
        const branchChildren = branches.map(({ branch }) => Array.from(branch.children));
        let irreversibleCalls = 0;
        let restoreDerivedProbe = (): void => undefined;
        if (descendantAttack === "setParent") {
            const globalTrans = (branches[3].leaf as unknown as { _globalTrans: { _spTransChanged(kind: unknown): void } })._globalTrans;
            const original = globalTrans._spTransChanged;
            globalTrans._spTransChanged = (): void => { irreversibleCalls++; };
            restoreDerivedProbe = (): void => { globalTrans._spTransChanged = original; };
        }
        if (descendantAttack === "derivedDestroy") {
            const exposed = roots[1] as unknown as Record<string, unknown>;
            exposed._filterArr = [{ off: (): void => { irreversibleCalls++; } }];
            exposed._textureCompositor = { destroy: (): void => { irreversibleCalls++; } };
        }
        candidate.on(LayaEvent.ADDED, candidate, () => {
            try {
                if (descendantAttack === "add") {
                    branches[1].branch.addChild(introduced);
                } else if (descendantAttack === "setContainer") {
                    branches[2].branch._setContainer(rogueContainer);
                } else if (descendantAttack === "setParent") {
                    (LayaSprite.prototype as unknown as { _setParent(value: LayaNode | null): void })
                        ._setParent.call(branches[3].leaf, foreign);
                } else if (descendantAttack === "array") {
                    internals(branches[1].branch)._children.push(introduced);
                } else if (descendantAttack === "parentFields") {
                    internals(branches[3].leaf)._parent = foreign;
                    internals(branches[3].leaf)._$parent = foreign;
                } else if (descendantAttack === "destroyChildren") {
                    roots[1].destroyChildren();
                } else {
                    roots[1].destroy(false);
                }
            } catch { /* registered descendant primitives reject before their first side effect */ }
        });
        const expectedFailure = descendantAttack === "array" ? /(child-array content mutation|child occurrence does not match)/
            : descendantAttack === "parentFields" ? /(parent-field mutation|child occurrence does not match)/
                : /poisoned by reentrant state or child mutation/;
        assert.throws(() => recursiveButton.upState = candidate, expectedFailure);
        assert.equal(irreversibleCalls, 0, "derived destroy admission precedes filter/compositor side effects");
        restoreDerivedProbe();
        assert.equal(recursiveButton.upState, roots[0]);
        assert.equal(recursiveButton.overState, roots[1]);
        assert.equal(recursiveButton.downState, roots[2]);
        assert.equal(recursiveButton.hitTestState, roots[3]);
        for (let index = 0; index < roots.length; index++) {
            assert.deepEqual(Array.from(roots[index].children), rootChildren[index]);
            assert.deepEqual(Array.from(branches[index].branch.children), branchChildren[index]);
            assert.equal(roots[index].destroyed, false);
            assert.equal(branches[index].branch.destroyed, false);
            assert.equal(branches[index].leaf.destroyed, false);
            assert.equal(internals(branches[index].branch)._$container, branches[index].branch);
            assert.equal(internals(branches[index].leaf)._parent, branches[index].branch);
            assert.equal(internals(branches[index].leaf)._$parent, branches[index].branch);
        }
        assert.ok(candidate.parent == null);
        assert.ok(introduced.parent == null);
        assert.ok(foreign.parent == null);
        assert.ok(rogueContainer.parent == null);
    }

    const ownerRoot = state(30, 30), ownerHolder = state(29, 29);
    const nestedButton = new SimpleButton(state(7, 7), state(8, 8));
    ownerRoot.addChild(ownerHolder);
    ownerHolder.addChild(nestedButton);
    const nestedReplacement = state(9, 9);
    nestedButton.upState = nestedReplacement;
    assert.equal(nestedButton.upState, nestedReplacement);
    assert.equal(nestedButton.parent, ownerHolder);
    assert.equal(ownerHolder.parent, ownerRoot);
    assert.deepEqual(Array.from(ownerRoot.children), [ownerHolder]);
    assert.deepEqual(Array.from(ownerHolder.children), [nestedButton]);

    const sourceGrandparent = state(31, 31), sourceParent = state(10, 10), sourcedCandidate = state(11, 11);
    sourceGrandparent.addChild(sourceParent);
    sourceParent.addChild(sourcedCandidate);
    const sourceTarget = new SimpleButton(state(12, 12));
    sourceTarget.overState = sourcedCandidate;
    assert.equal(sourcedCandidate.parent, sourceTarget);
    assert.deepEqual(Array.from(sourceParent.children), []);
    assert.deepEqual(Array.from(sourceGrandparent.children), [sourceParent]);
    assert.equal(sourceParent.parent, sourceGrandparent);

    const siblingSourceParent = state(17, 17), siblingSourceCandidate = state(18, 18), sourceSibling = state(19, 19);
    siblingSourceParent.addChild(siblingSourceCandidate);
    siblingSourceParent.addChild(sourceSibling);
    const siblingSourceTarget = new SimpleButton(state(20, 20));
    siblingSourceCandidate.on(LayaEvent.ADDED, siblingSourceCandidate, () => {
        internals(sourceSibling)._parent = null;
        internals(sourceSibling)._$parent = null;
    });
    assert.throws(() => siblingSourceTarget.overState = siblingSourceCandidate,
        /(parent-field mutation|child occurrence does not match)/);
    assert.deepEqual(Array.from(siblingSourceParent.children), [siblingSourceCandidate, sourceSibling]);
    assert.equal(siblingSourceCandidate.parent, siblingSourceParent);
    assert.equal(sourceSibling.parent, siblingSourceParent);
    assert.equal(internals(sourceSibling)._parent, siblingSourceParent);
    assert.equal(internals(sourceSibling)._$parent, siblingSourceParent);
    assert.equal(siblingSourceTarget.overState, null);

    const rogueSourceParent = state(21, 21), rogueSourceCandidate = state(22, 22), rogueSourceChild = state(23, 23);
    rogueSourceParent.addChild(rogueSourceCandidate);
    const rogueSourceTarget = new SimpleButton(state(24, 24));
    rogueSourceCandidate.on(LayaEvent.ADDED, rogueSourceCandidate, () => {
        internals(rogueSourceParent)._children.push(rogueSourceChild);
        internals(rogueSourceParent)._$children.push(rogueSourceChild);
        internals(rogueSourceChild)._parent = rogueSourceParent;
        internals(rogueSourceChild)._$parent = rogueSourceParent;
    });
    assert.throws(() => rogueSourceTarget.overState = rogueSourceCandidate,
        /(child-array content mutation|duplicate logical child)/);
    assert.deepEqual(Array.from(rogueSourceParent.children), [rogueSourceCandidate]);
    assert.equal(rogueSourceCandidate.parent, rogueSourceParent);
    assert.ok(rogueSourceChild.parent == null);
    assert.ok(internals(rogueSourceChild)._parent == null);
    assert.ok(internals(rogueSourceChild)._$parent == null);
    assert.equal(rogueSourceTarget.overState, null);

    const boundaryGrandparent = state(32, 32), boundaryParent = state(13, 13), boundaryCandidate = state(14, 14);
    boundaryGrandparent.addChild(boundaryParent);
    boundaryParent.addChild(boundaryCandidate);
    const boundaryTarget = new SimpleButton(state(15, 15));
    boundaryCandidate.on(LayaEvent.ADDED, boundaryCandidate, () => {
        try { boundaryGrandparent.removeChild(boundaryParent); } catch { }
    });
    assert.throws(() => boundaryTarget.overState = boundaryCandidate, /poisoned by reentrant state or child mutation/);
    assert.equal(boundaryCandidate.parent, boundaryParent);
    assert.equal(boundaryParent.parent, boundaryGrandparent);
    assert.deepEqual(Array.from(boundaryParent.children), [boundaryCandidate]);
    assert.deepEqual(Array.from(boundaryGrandparent.children), [boundaryParent]);
    assert.equal(boundaryTarget.overState, null);

    class HostileDestroyDescendant extends DisplayObject {
        calls = 0;
        override destroy(destroyChild: boolean = true): void { this.calls++; super.destroy(destroyChild); }
    }
    class HostileParentDescendant extends DisplayObject {
        calls = 0;
        protected override _setParent(value: LayaNode, index: number = -1): void {
            this.calls++;
            super._setParent(value, index);
        }
    }
    class HostileDestroyChildrenDescendant extends DisplayObject {
        calls = 0;
        override destroyChildren(): void { this.calls++; super.destroyChildren(); }
    }
    for (const hostileDescendant of [
        new HostileDestroyDescendant(), new HostileParentDescendant(), new HostileDestroyChildrenDescendant(),
    ]) {
        const hostileRoot = state(16, 16);
        hostileRoot.addChild(hostileDescendant);
        hostileDescendant.calls = 0;
        const hostileTarget = new SimpleButton();
        assert.throws(() => hostileTarget.upState = hostileRoot, /graph node must not replace canonical Laya/);
        assert.equal(hostileDescendant.calls, 0, "hostile descendant lifecycle code is rejected before invocation");
        assert.ok(hostileRoot.parent == null);
        assert.equal(hostileDescendant.parent, hostileRoot);
        assert.equal(hostileTarget.upState, null);
        assert.equal(hostileTarget.numChildren, 0);
    }

    class NativeHostileSprite extends LayaSprite {
        calls = 0;
        override destroy(destroyChild: boolean = true): void { this.calls++; super.destroy(destroyChild); }
    }
    class NativeHostileNode extends LayaNode {
        calls = 0;
        protected override _setParent(value: LayaNode, index: number = -1): void {
            this.calls++;
            super._setParent(value, index);
        }
    }
    for (const nativeDescendant of [new NativeHostileSprite(), new NativeHostileNode()]) {
        const nativeRoot = state(25, 25);
        nativeRoot.addChild(nativeDescendant);
        nativeDescendant.calls = 0;
        const nativeTarget = new SimpleButton();
        assert.throws(() => nativeTarget.upState = nativeRoot, /graph node must not replace canonical Laya/);
        assert.equal(nativeDescendant.calls, 0, "native Laya descendant override is rejected before invocation");
        assert.equal(nativeDescendant.parent, nativeRoot);
        assert.equal(nativeTarget.upState, null);
    }
    const nativeInputRoot = state(24, 24), nativeInput = new LayaInput(), nativeInputTarget = new SimpleButton();
    nativeInputRoot.addChild(nativeInput);
    assert.throws(() => nativeInputTarget.upState = nativeInputRoot,
        /graph node must not replace canonical Laya (destroy|_setParent)/,
        "native Text/Input lifecycle overrides are rejected before their pre-Sprite side effects");
    assert.equal(nativeInput.parent, nativeInputRoot);
    assert.equal(nativeInputTarget.upState, null);

    class UnrelatedHostileBranch extends LayaSprite {
        override destroy(destroyChild: boolean = true): void { super.destroy(destroyChild); }
    }
    const sceneRoot = new Stage(); sceneRoot.size(320, 200);
    const ownerBranch = state(27, 27), unrelatedBranch = new UnrelatedHostileBranch();
    const boundedButton = new SimpleButton(state(28, 28));
    sceneRoot.addChild(ownerBranch);
    sceneRoot.addChild(unrelatedBranch);
    ownerBranch.addChild(boundedButton);
    const unrelatedMutation = new LayaNode(), boundedReplacement = state(29, 29);
    boundedReplacement.on(LayaEvent.ADDED, boundedReplacement, () => unrelatedBranch.addChild(unrelatedMutation));
    boundedButton.upState = boundedReplacement;
    assert.equal(boundedButton.upState, boundedReplacement);
    assert.equal(unrelatedMutation.parent, unrelatedBranch,
        "unrelated Stage sibling subtree is neither traversed nor frozen by button admission");

    const panel = new Panel(), panelButton = new SimpleButton(state(10, 10));
    panel.addChild(panelButton);
    const panelReplacement = state(11, 11);
    panelButton.upState = panelReplacement;
    assert.equal(panelButton.upState, panelReplacement);
    assert.equal(panelButton.parent, panel);
    assert.equal(internals(panelButton)._$parent, panel);
    assert.equal(internals(panelButton)._parent, panel.content,
        "Panel logical ownership and content actual container remain distinct and valid");

    const admittedExternal = state(20, 20), admittedRogue = state(21, 21);
    const admittedSource = state(22, 22), admittedCandidate = state(23, 23), admittedTarget = new SimpleButton();
    admittedExternal.addChild(admittedRogue);
    admittedSource.addChild(admittedCandidate);
    admittedCandidate.on(LayaEvent.ADDED, admittedCandidate, () => {
        try { admittedSource.addChild(admittedRogue); } catch { }
    });
    assert.throws(() => admittedTarget.upState = admittedCandidate, /poisoned by reentrant state or child mutation/);
    assert.deepEqual(Array.from(admittedExternal.children), [admittedRogue]);
    assert.equal(admittedRogue.parent, admittedExternal,
        "admitted public child mutation rejects before disturbing externally owned state");
    assert.deepEqual(Array.from(admittedSource.children), [admittedCandidate]);
    assert.equal(admittedCandidate.parent, admittedSource);

    const appendRawChild = (parent: LayaNode, child: LayaNode): void => {
        internals(parent)._children.push(child);
        if (internals(parent)._$children !== internals(parent)._children) internals(parent)._$children.push(child);
    };
    const inverseRoot = state(30, 30), inverseChild = state(31, 31), inverseTarget = new SimpleButton();
    appendRawChild(inverseRoot, inverseChild);
    assert.throws(() => inverseTarget.upState = inverseRoot, /child occurrence does not match its declared parent/);
    assert.equal(inverseTarget.upState, null);

    const sharedRoot = state(32, 32), sharedLeft = state(12, 12), sharedRight = state(13, 13), sharedNode = state(14, 14);
    sharedRoot.addChild(sharedLeft);
    sharedRoot.addChild(sharedRight);
    sharedLeft.addChild(sharedNode);
    appendRawChild(sharedRight, sharedNode);
    assert.throws(() => new SimpleButton().upState = sharedRoot, /(shared logical child|child occurrence does not match)/);

    const cycleA = state(15, 15), cycleB = state(16, 16);
    appendRawChild(cycleA, cycleB);
    appendRawChild(cycleB, cycleA);
    internals(cycleB)._parent = cycleA;
    internals(cycleB)._$parent = cycleA;
    internals(cycleA)._parent = cycleB;
    internals(cycleA)._$parent = cycleB;
    assert.throws(() => new SimpleButton().upState = cycleA, /parent\/child cycle/);

    const ancestryA = state(17, 17), ancestryB = state(18, 18), cyclicOwnerButton = new SimpleButton();
    ancestryB.addChild(ancestryA);
    ancestryA.addChild(cyclicOwnerButton);
    appendRawChild(ancestryA, ancestryB);
    internals(ancestryB)._parent = ancestryA;
    internals(ancestryB)._$parent = ancestryA;
    assert.throws(() => cyclicOwnerButton.upState = state(19, 19), /button ancestry is cyclic/);

    const reservedEvent = { button: "click", form: "change", input: "input", interactive: "click", timeline: "cue" } as const;
    const reservedContract = (
        member: string,
        nodeKind: keyof typeof reservedEvent = "interactive",
        sourceBase: keyof typeof AUTHORED_BINDING_RESERVED_SOURCE_SURFACES = "MovieClip",
    ) => ({
        schema: "neutral-authored-code-bindings@1",
        documentId: "reserved-member-probe",
        sourceBase,
        bindings: [{
            bindingId: "probe", memberName: member, nodeId: "probe-node", nodeKind, required: true,
            events: [{ eventId: "probe-event", type: reservedEvent[nodeKind], required: true }],
        }],
    });
    const exactReportedCollisions = [
        "event", "on", "off", "graphics", "hitArea", "mouseThrough", "timer", "addChildren",
        "removeChildByName", "setChildIndexBefore", "replaceChild", "children", "getChild", "getChildByPath",
        "findChild", "once", "addComponent", "getComponent", "destroyed", "url", "size", "pos",
    ];
    const crossKind = { MovieClip: "button", SimpleButton: "input", Sprite: "timeline", TextField: "button" } as const;
    for (const [sourceBase, surface] of Object.entries(AUTHORED_BINDING_RESERVED_SOURCE_SURFACES)) {
        for (const collision of exactReportedCollisions)
            assert.ok(surface.includes(collision), `${sourceBase} A12 surface owns reported collision ${collision}`);
        for (const reserved of [...surface, "constructor", "prototype", "__proto__"]) {
            assert.throws(() => normalizeAuthoredCodeBindingContract(
                reservedContract(reserved, crossKind[sourceBase as keyof typeof crossKind], sourceBase as keyof typeof crossKind),
            ), /(public authored TypeScript member name|collides with the .* document public surface)/,
            `${sourceBase}.${reserved} must not be admitted as a root-injected authored member`);
        }
    }
    assert.throws(() => normalizeAuthoredCodeBindingContract(
        reservedContract("gotoAndStop", "button", "MovieClip"),
    ), /collides with the MovieClip document public surface/,
    "a button field may not override its MovieClip document root's gotoAndStop method");
    assert.doesNotThrow(() => normalizeAuthoredCodeBindingContract(
        reservedContract("gotoAndStop", "timeline", "SimpleButton"),
    ), "timeline node methods do not over-reserve an unrelated SimpleButton document root");
    assert.throws(() => normalizeAuthoredCodeBindingContract(
        reservedContract("upState", "input", "SimpleButton"),
    ), /collides with the SimpleButton document public surface/);
    assert.doesNotThrow(() => normalizeAuthoredCodeBindingContract(
        reservedContract("upState", "button", "TextField"),
    ));
    assert.throws(() => normalizeAuthoredCodeBindingContract({
        ...reservedContract("safeChild", "button", "Sprite"), sourceBase: "DisplayObject",
    }), /not an authenticated document source type/);

    class HostileVisibleState extends DisplayObject {
        visibleWrites = 0;
        override get visible(): boolean { return super.visible; }
        override set visible(_value: boolean) { this.visibleWrites++; throw new Error("hostile visible setter"); }
    }
    const hostileVisible = new HostileVisibleState();
    button.downState = hostileVisible;
    assert.equal(hostileVisible.visibleWrites, 0);
    assert.equal(hostileVisible.visible, false);
    button.event(LayaEvent.MOUSE_DOWN, nativeMouse(LayaEvent.MOUSE_DOWN, button, 1, 1, 1));
    assert.equal(hostileVisible.visibleWrites, 0);
    assert.equal(hostileVisible.visible, true);

    const shared = state(15, 8);
    const aliased = new SimpleButton(shared, null, null, shared);
    assert.equal(shared.visible, true, "a visible state aliased as hitTestState remains visible");
    const recursiveHit = new DisplayObject();
    const nested = state(8, 6); nested.pos(12, 4); nested.mouseEnabled = true; recursiveHit.addChild(nested);
    aliased.hitTestState = recursiveHit;
    assert.equal(manager.hitTest(aliased as unknown as LayaSprite, 13, 5), true, "nested native hit geometry is retained");
    assert.equal(manager.hitTest(aliased as unknown as LayaSprite, 5, 5), false, "hit geometry is not reduced to aggregate bounds");
});

test("TextField has genuine Flash heritage and a composed native Laya input", () => {
    const field = new TextField();
    const displayProbe: DisplayObject = field;
    const interactiveProbe: InteractiveObject = field;
    assert.ok(field instanceof LayaSprite);
    assert.ok(field instanceof InteractiveObject);
    assert.ok(field instanceof DisplayObject);
    assert.equal(field instanceof LayaInput, false, "TextField uses composition instead of breaking Flash heritage");
    assert.equal("dispatchImeComposition" in field, false, "no public compatibility-looking IME control seam exists");
    assert.equal(displayProbe, field);
    assert.equal(interactiveProbe, field);
    assert.equal(field.root, field);
    const textRoot = new DisplayObject(); textRoot.addChild(field);
    assert.equal(field.root, textRoot);
    assert.equal(field.type, TextFieldType.DYNAMIC);
    assert.equal(field.editable, false);
    field.type = TextFieldType.INPUT;
    field.text = "Bleach";
    field.htmlText = "<b>Bleach</b>";
    assert.equal(field.htmlText, "<b>Bleach</b>");
    field.displayAsPassword = true; assert.equal(field.displayAsPassword, true);
    field.embedFonts = true; assert.equal(field.embedFonts, true);
    field.tabEnabled = true; field.tabIndex = 3; field.doubleClickEnabled = true;
    field.setSelection(1, 3);
    field.focus = true;
    assert.equal(field.selectionBeginIndex, 1); assert.equal(field.selectionEndIndex, 3); assert.equal(field.caretIndex, 3);
    assert.equal(field.focus, true); assert.equal(field.mouseEnabled, true);
    assert.equal(field.editable, true);
    let changed = 0;
    field.addEventListener(Event.CHANGE, () => changed++);
    field.dispatchEvent(new Event(Event.CHANGE));
    assert.equal(changed, 1);
    assert.throws(() => field.type = "password", /TextField.type/);
});

test("authored TextField factory atomically publishes the three launch-critical device-Arial fields", () => {
    const configurations: readonly AuthoredTextFieldConfiguration[] = [
        {
            sourceId: 17, x: -2, y: -2, width: 574.85, height: 22.45,
            type: "dynamic", multiline: false, wordWrap: false, selectable: false,
            displayAsPassword: false, autoSize: "none", html: false, gutter: 2, overflow: "hidden",
            initialText: "",
            format: {
                fontMode: "device", font: "Arial", size: 14, color: 0xffffff, bold: true,
                italic: false, underline: false, align: "center", leftMargin: 0, rightMargin: 0,
                indent: 0, leading: 2,
            },
        },
        {
            sourceId: 19, x: -2, y: -2, width: 679, height: 33,
            type: "dynamic", multiline: true, wordWrap: true, selectable: false,
            displayAsPassword: false, autoSize: "none", html: false, gutter: 2, overflow: "hidden",
            initialText: "",
            format: {
                fontMode: "device", font: "Arial", size: 12, color: 0xcccccc, bold: false,
                italic: false, underline: false, align: "center", leftMargin: 0, rightMargin: 0,
                indent: 0, leading: 2,
            },
        },
        {
            sourceId: 20, x: -2, y: -2, width: 547, height: 23,
            type: "dynamic", multiline: false, wordWrap: false, selectable: false,
            displayAsPassword: false, autoSize: "none", html: false, gutter: 2, overflow: "hidden",
            initialText: "",
            format: {
                fontMode: "device", font: "Arial", size: 12, color: 0xcccccc, bold: false,
                italic: false, underline: false, align: "center", leftMargin: 0, rightMargin: 0,
                indent: 0, leading: 2,
            },
        },
    ];

    for (const configuration of configurations) {
        const field = createAuthoredTextField(configuration);
        const native = field.children[0] as LayaInput;
        assert.ok(field instanceof InteractiveObject);
        assert.equal(isFlashTextField(field), true);
        assert.deepEqual([field.name, field.x, field.y, field.width, field.height],
            [`symbol${configuration.sourceId}`, configuration.x, configuration.y, configuration.width, configuration.height]);
        assert.deepEqual([field.type, field.multiline, field.wordWrap, field.selectable, field.displayAsPassword],
            [configuration.type, configuration.multiline, configuration.wordWrap,
                configuration.selectable, configuration.displayAsPassword]);
        assert.deepEqual([field.flashAutoSize, field.text], [configuration.autoSize, configuration.initialText]);
        assert.deepEqual(native.padding, [2, 2, 2, 2], "the Flash two-pixel gutter remains engine-owned");
        assert.equal(native.overflow, "hidden", "authored bounds clip incomplete and overflowing lines");
        assert.equal(field.embedFonts, false, "launch slice uses the device Arial path, not embedded-font readiness");
        assert.deepEqual([
            field.defaultTextFormat.font, field.defaultTextFormat.size, field.defaultTextFormat.color,
            field.defaultTextFormat.bold, field.defaultTextFormat.italic, field.defaultTextFormat.underline,
            field.defaultTextFormat.align, field.defaultTextFormat.leftMargin, field.defaultTextFormat.rightMargin,
            field.defaultTextFormat.indent, field.defaultTextFormat.leading,
        ], [
            configuration.format.font, configuration.format.size, configuration.format.color,
            configuration.format.bold, configuration.format.italic, configuration.format.underline,
            configuration.format.align, configuration.format.leftMargin, configuration.format.rightMargin,
            configuration.format.indent, configuration.format.leading,
        ]);

        let changes = 0;
        let textInputs = 0;
        let focusEvents = 0;
        let compositionEvents = 0;
        field.addEventListener(Event.CHANGE, () => changes++);
        field.addEventListener(TextEvent.TEXT_INPUT, () => textInputs++);
        field.addEventListener(FocusEvent.FOCUS_IN, () => focusEvents++);
        field.addEventListener(IMEEvent.IME_COMPOSITION, () => compositionEvents++);
        field.text = `field-${configuration.sourceId}`;
        assert.equal(field.text, `field-${configuration.sourceId}`, "programmatic writes are synchronous");
        assert.equal(field.numLines, 1, "metrics are synchronous before the next frame");
        assert.equal(field.getLineMetrics(0).leading, 2, "authored leading survives native layout");
        assert.deepEqual([changes, textInputs], [0, 0], "programmatic writes emit no user-edit events");

        (PAL as any).textInput.target = native;
        field.destroy(configuration.sourceId !== 20);
        assert.deepEqual([field.destroyed, native.destroyed, field.numChildren, (PAL as any).textInput.target],
            [true, true, 0, null], "destroy releases private input ownership and focus");
        native.event(LayaEvent.INPUT, "late");
        native.event(LayaEvent.CHANGE, "late");
        native.event(LayaEvent.FOCUS, "late");
        native.event(LayaEvent.COMPOSITION_START, "late");
        native.event(LayaEvent.COMPOSITION_UPDATE, "late");
        native.event(LayaEvent.COMPOSITION_END, "late");
        assert.deepEqual([changes, textInputs, focusEvents, compositionEvents, field.numChildren], [0, 0, 0, 0, 0],
            "destroyed native controls cannot resurrect or forward listeners");
    }
});

test("authored TextField validation fails before publication and preserves prior fields", () => {
    const valid: AuthoredTextFieldConfiguration = {
        sourceId: 17, x: -2, y: -2, width: 574.85, height: 22.45,
        type: "dynamic", multiline: false, wordWrap: false, selectable: false,
        displayAsPassword: false, autoSize: "none", html: false, gutter: 2, overflow: "hidden",
        initialText: "stable",
        format: {
            fontMode: "device", font: "Arial", size: 14, color: 0xffffff, bold: true,
            italic: false, underline: false, align: "center", leftMargin: 0, rightMargin: 0,
            indent: 0, leading: 2,
        },
    };
    const published = createAuthoredTextField(valid);
    const invalid = { ...valid, format: { ...valid.format, leading: Number.NaN } };
    assert.throws(() => createAuthoredTextField(invalid), /format\.leading must be finite/);
    assert.deepEqual([published.text, published.x, published.width, published.defaultTextFormat.leading],
        ["stable", -2, 574.85, 2], "a rejected batch cannot partially mutate a published field");

    let getterReads = 0;
    const accessor = { ...valid } as any;
    Object.defineProperty(accessor, "width", { enumerable: true, get(): number { getterReads++; return 1; } });
    assert.throws(() => createAuthoredTextField(accessor), /width must be an own data property/);
    assert.equal(getterReads, 0, "validation does not execute authored accessors");
    class ForgedFilter {
        kind = "glow"; color = 0; alpha = 1; blurX = 3; blurY = 3; strength = 3;
        quality = 1; inner = false; knockout = false;
    }
    assert.throws(
        () => createAuthoredTextField({ ...valid, filters: [new ForgedFilter()] } as AuthoredTextFieldConfiguration),
        /filters\[0\] must be a plain data object/,
    );
    published.destroy(true);
});

test("canonical hierarchy deserializes a Laya-owned authored dynamic TextField primitive", () => {
    registerAuthoredContentPrimitives();
    const configuration: AuthoredTextFieldConfiguration = {
        sourceId: 17, x: 347.1, y: 558, width: 574.85, height: 22.45,
        type: "dynamic", multiline: false, wordWrap: false, selectable: false,
        displayAsPassword: false, autoSize: "none", html: false, gutter: 2,
        overflow: "hidden", initialText: "",
        format: {
            fontMode: "device", font: "Arial", size: 14, color: 0xffffff, bold: true,
            italic: false, underline: false, align: "center", leftMargin: 0,
            rightMargin: 0, indent: 0, leading: 2,
        },
        filters: [{
            _$type: "any",
            value: {
                kind: "glow", color: 0, alpha: 1, blurX: 3, blurY: 3,
                strength: 3, quality: 1, inner: false, knockout: false,
            },
        }] as unknown as AuthoredTextFieldConfiguration["filters"],
    };
    const errors: unknown[] = [];
    const prefab = new PrefabImpl(HierarchyParser, {
        "_$ver": 1,
        "_$id": "symbol17",
        "_$type": "Sprite",
        "_$runtime": AUTHORED_CONTENT_RUNTIME_IDS.textField,
        authoredConfiguration: configuration,
        name: "TF_ProgressText",
        x: 347.1,
        y: 558,
        width: 574.85,
        height: 22.45,
    });
    const field = prefab.create({}, errors) as AuthoredDynamicTextField;
    assert.deepEqual(errors, []);
    assert.equal(field instanceof AuthoredDynamicTextField, true);
    assert.equal(isFlashTextField(field), true);
    assert.equal(field.name, "TF_ProgressText");
    assert.equal(field.defaultTextFormat.font, "Arial");
    assert.equal(field.defaultTextFormat.bold, true);
    assert.deepEqual(field.filters.map(filter => [
        (filter as GlowFilter).color, (filter as GlowFilter).blurX,
        (filter as GlowFilter).blurY, (filter as GlowFilter).strength,
    ]), [[0, 3, 3, 3]], "hierarchy-decoded authored GlowFilter remains exact");
    field.text = "Loading 10%";
    assert.equal(field.text, "Loading 10%");
    field.destroy(true);
});

test("canonical hierarchy binds an independently clocked 16-frame authored MovieClip", () => {
    registerAuthoredContentPrimitives();
    const clip = new AnimationClip2D();
    clip._duration = 16 / 30;
    clip._frameRate = 30;
    clip.islooping = true;
    clip._setCreateURL("res://happy-bear-timeline", "happy-bear-timeline");
    const type = Loader.getURLInfo("happy-bear-timeline.mc");
    Loader._cacheRes("happy-bear-timeline", clip, type.typeId, type.main);
    const priorLoader = ILaya.loader;
    ILaya.loader = {
        getRes: (): AnimationClip2D => clip,
        clearRes: (): void => undefined,
    } as any;
    const errors: unknown[] = [];
    const prefab = new PrefabImpl(HierarchyParser, {
        "_$ver": 1,
        "_$id": "symbol11",
        "_$type": "Sprite",
        "_$runtime": AUTHORED_CONTENT_RUNTIME_IDS.movieClip,
        name: "HappyBear",
        "_$comp": [{
            "_$type": "AnimatorClip2D",
            clip: { "_$uuid": "happy-bear-timeline", "_$type": "AnimationClip2D" },
            autoPlay: true,
        }],
    });
    const bear = prefab.create({}, errors) as AuthoredMovieClip;
    assert.deepEqual(errors, []);
    assert.equal(bear instanceof AuthoredMovieClip, true);
    assert.equal(isFlashMovieClip(bear), true);
    assert.equal(bear.name, "HappyBear");
    assert.equal(bear.totalFrames, 16);
    bear.gotoAndStop(5);
    assert.equal(bear.currentFrame, 5);
    bear.gotoAndStop(13);
    assert.equal(bear.currentFrame, 13);
    assert.equal(bear.isPlaying, false);
    bear.play();
    assert.equal(bear.isPlaying, true);
    bear.stop();
    assert.equal(bear.isPlaying, false);
    bear.destroy(true);
    Loader.clearRes("happy-bear-timeline", clip);
    ILaya.loader = priorLoader;
});

test("texture-backed StaticText preserves Flash identity, authored bounds and exact mapped text", () => {
    const glyphA = new Texture();
    glyphA.sourceWidth = 8; glyphA.sourceHeight = 10;
    (glyphA as any)._bitmap = { _addReference(): void {}, _removeReference(): void {} };
    const unknownGlyph = new Texture();
    unknownGlyph.sourceWidth = 7; unknownGlyph.sourceHeight = 10;
    (unknownGlyph as any)._bitmap = { _addReference(): void {}, _removeReference(): void {} };
    const configuration: AuthoredStaticTextConfiguration = {
        sourceId: 41, x: 12, y: -3, width: 40, height: 14,
        runs: [{
            color: "#12AB34", alpha: 0.75,
            glyphs: [
                { texture: glyphA, character: "A", x: 1, y: 2, width: 8, height: 10 },
                { texture: null, character: " ", x: 9, y: 2, width: 4, height: 10 },
                { texture: unknownGlyph, character: null, x: 13, y: 2, width: 7, height: 10 },
                { texture: null, character: "\u{1F5E1}", x: 20, y: 2, width: 10, height: 10 },
            ],
        }],
    };
    const value = createAuthoredStaticText(configuration);
    const displayProbe: DisplayObject = value;
    assert.ok(value instanceof StaticText);
    assert.ok(value instanceof DisplayObject);
    assert.ok(value instanceof LayaSprite);
    assert.equal(isFlashStaticText(value), true);
    assert.equal(isFlashDisplayObject(value), true);
    assert.equal(value.text, "A \u{1F5E1}", "unmapped glyphs render without invented Unicode text");
    assert.deepEqual([value.name, value.x, value.y, value.width, value.height, value.visible, value.mouseEnabled],
        ["symbol41", 12, -3, 40, 14, true, false]);
    assert.deepEqual(["_$authoredSourceType" in StaticText, "_$authoredSerializedType" in StaticText], [false, false],
        "native prefab serialization remains an explicit HOLD rather than an unverified identity claim");
    const root = new DisplayObject(); root.addChild(value);
    assert.deepEqual([value.parent, value.root, displayProbe], [root, root, value]);
    const parentBounds = value.getBounds();
    assert.deepEqual([parentBounds.x, parentBounds.y, parentBounds.width, parentBounds.height], [13, -1, 19, 10],
        "normal Laya bounds reflect the actual native glyph geometry in parent coordinates");
    const commands = value.graphics.cmds!;
    assert.equal(commands.length, 2, "only texture-bearing glyphs create native draw commands");
    assert.deepEqual([glyphA.referenceCount, unknownGlyph.referenceCount], [1, 1],
        "each native draw command owns exactly one texture reference");
    assert.deepEqual(commands.map(command => [command.cmdID, (command as any).x, (command as any).y,
        (command as any).width, (command as any).height, (command as any).alpha]), [
        ["DrawTextureCmd", 1, 2, 8, 10, 0.75],
        ["DrawTextureCmd", 13, 2, 7, 10, 0.75],
    ]);
    (configuration.runs[0].glyphs[0] as { character: string | null }).character = "Z";
    assert.equal(value.text, "A \u{1F5E1}", "published text is detached from mutable caller data");
    const ownText = Object.getOwnPropertyDescriptor(value, "text")!;
    const prototypeText = Object.getOwnPropertyDescriptor(StaticText.prototype, "text")!;
    assert.deepEqual([ownText.configurable, ownText.enumerable, typeof ownText.get, typeof ownText.set],
        [false, false, "function", "function"]);
    assert.throws(() => ownText.get!.call({}), /canonical StaticText receiver/);
    assert.throws(() => prototypeText.get!.call({}), /canonical StaticText receiver/);
    assert.throws(() => prototypeText.get!.call(Object.create(StaticText.prototype)), /canonical StaticText receiver/);
    const proxied = new Proxy(value, {});
    assert.equal(isFlashStaticText(proxied), false);
    assert.throws(() => proxied.text, /canonical StaticText receiver/);
    assert.throws(() => { (value as any).text = "forged"; }, /read-only/);
    assert.throws(() => Object.defineProperty(value, "text", { value: "forged" }), /redefine|configurable/);
    value.visible = false;
    assert.equal(value.visible, false);
    const graphics = value.graphics;
    value.destroy(true);
    assert.deepEqual([value.destroyed, graphics.cmds.length, glyphA.referenceCount, unknownGlyph.referenceCount],
        [true, 0, 0, 0], "destroy recovers every DrawTextureCmd and releases every texture reference exactly once");
    assert.throws(() => ownText.get!.call(value), /unavailable after destroy/);
});

test("StaticText validation is atomic and rejects accessors, malformed scalars and texture impostors", () => {
    assert.throws(() => new (StaticText as any)(), /created only by LayaAir authored content/);
    const base: AuthoredStaticTextConfiguration = {
        sourceId: 1, x: 0, y: 0, width: 10, height: 10,
        runs: [{ color: "#FFFFFF", alpha: 1,
            glyphs: [{ texture: null, character: "A", x: 0, y: 0, width: 4, height: 8 }] }],
    };
    const stable = createAuthoredStaticText(base);
    assert.throws(() => createAuthoredStaticText({ ...base, runs: [{ ...base.runs[0],
        glyphs: [{ ...base.runs[0].glyphs[0], character: "AB" }] }] }), /one Unicode scalar/);
    assert.throws(() => createAuthoredStaticText({ ...base, runs: [{ ...base.runs[0],
        glyphs: [{ ...base.runs[0].glyphs[0], texture: {} as Texture }] }] }), /native Laya Texture/);
    let reads = 0;
    const accessor = { ...base } as any;
    Object.defineProperty(accessor, "runs", { enumerable: true, get(): unknown { reads++; return []; } });
    assert.throws(() => createAuthoredStaticText(accessor), /runs must be an own data property/);
    assert.equal(reads, 0);
    assert.deepEqual([stable.text, stable.name, stable.width, stable.height], ["A", "symbol1", 10, 10]);
});

test("TextField preserves nullable defaults, character ranges, replacement, and independent plain and HTML views", () => {
    const bridgeSource = readFileSync(join(process.cwd(), "src/layaAir/flash/text/TextField.ts"), "utf8");
    assert.doesNotMatch(bridgeSource, /\bas\s+(?:unknown\s+as\s+)?(?:Readonly<)?Record\s*</,
        "bridge mutation and payload validation remain closed and compiler-checked");
    const routerSource = readFileSync(join(process.cwd(), "src/layaAir/flash/events/FlashEventRouter.ts"), "utf8");
    const textProjection = routerSource.slice(routerSource.indexOf("if (type === TextEvent.TEXT_INPUT)"),
        routerSource.indexOf("if (type === IMEEvent.IME_COMPOSITION)"));
    assert.doesNotMatch(textProjection, /\bas\s+|\bin\s+value\b|value\s*\[/,
        "text-input routing consumes only the authenticated producer snapshot");
    assert.doesNotMatch(routerSource, /\(value as \{ preventDefault\?: unknown \}\)\.preventDefault/,
        "native cancellation is never discovered by probing unknown payloads");
    const imeProjection = routerSource.slice(routerSource.indexOf("if (type === IMEEvent.IME_COMPOSITION)"));
    assert.doesNotMatch(imeProjection, /\bas\s+/,
        "IME routing consumes only the authenticated producer snapshot");
    const producerSource = readFileSync(join(process.cwd(), "src/layaAir/laya/platform/TextInputAdapter.ts"), "utf8");
    assert.match(producerSource, /private dispatchComposition\(/,
        "composition payload creation cannot be overridden or used as a generic factory");
    assert.match(producerSource, /private createBeforeInputData\(/,
        "before-input payload creation cannot be overridden or used as a generic factory");
    assert.match(producerSource, /private dispatchBeforeInput\(/,
        "before-input authority exists for only one synchronous native dispatch");

    const nullable = new TextFormat();
    assert.deepEqual([
        nullable.font, nullable.size, nullable.color, nullable.bold, nullable.italic, nullable.underline,
        nullable.url, nullable.target, nullable.align, nullable.leftMargin, nullable.rightMargin,
        nullable.indent, nullable.leading, nullable.blockIndent, nullable.bullet, nullable.kerning,
        nullable.letterSpacing, nullable.tabStops,
    ], Array(18).fill(null));

    const field = new TextField();
    const fabricated = Object.create(TextFormat.prototype) as TextFormat;
    const proxied = new Proxy(new TextFormat(), {});
    assert.equal(isFlashTextFormat(nullable), true);
    assert.equal(isFlashTextFormat(fabricated), false);
    assert.equal(isFlashTextFormat(proxied), false);
    assert.throws(() => field.defaultTextFormat = fabricated, TypeError);
    assert.throws(() => field.defaultTextFormat = proxied, TypeError);
    Object.defineProperty(TextFormat, Symbol.hasInstance, { configurable: true, value: () => true });
    try {
        assert.throws(() => field.defaultTextFormat = {} as TextFormat, TypeError,
            "hostile Symbol.hasInstance cannot mint an authenticated TextFormat");
    } finally {
        Reflect.deleteProperty(TextFormat, Symbol.hasInstance);
    }
    field.defaultTextFormat = new TextFormat("Arial", 12, 0xff0000, false, false, false,
        null, null, TextFormatAlign.LEFT, 0, 0, 0, 2);
    field.text = "alpha";
    assert.equal(field.getTextFormat(0, field.length).color, 0xff0000);

    const nextDefault = field.defaultTextFormat;
    nextDefault.color = 0x00ff00;
    nextDefault.italic = true;
    field.defaultTextFormat = nextDefault;
    assert.equal(field.getTextFormat(0, field.length).color, 0xff0000,
        "changing defaultTextFormat does not restyle existing text");
    field.appendText(" beta");
    assert.equal(field.getTextFormat(5, field.length).color, 0x00ff00,
        "appendText receives the current defaultTextFormat");

    const range = new TextFormat();
    range.bold = true;
    range.color = 0x334455;
    field.setTextFormat(range, 0, 2);
    assert.equal(field.getTextFormat(0, 2).bold, true);
    assert.equal(field.getTextFormat(0, field.length).bold, null, "mixed range properties are nullable");
    field.replaceText(2, 5, "XY");
    assert.equal(field.text, "alXY beta");
    assert.equal(field.getTextFormat(2, 4).color, 0xff0000,
        "replacement inherits the insertion range rather than the later default");

    field.text = "AxyB";
    field.setSelection(1, 3);
    field.replaceSelectedText("\r\n");
    assert.equal(field.text, "A\rB");
    assert.equal(field.caretIndex, 2, "caret uses normalized UTF-16 replacement length");

    field.htmlText = "<p><b>A&amp;</b><sbr>B</p>";
    assert.equal(field.text, "A&\rB");
    assert.equal(field.htmlText, "<p><b>A&amp;</b><sbr>B</p>");
    field.text = "<literal>\nvalue";
    assert.equal(field.text, "<literal>\rvalue");
    assert.equal(field.htmlText, "&lt;literal&gt;<br>value");

    const condense = new TextField();
    condense.text = "a   b";
    condense.condenseWhite = true;
    assert.equal(condense.text, "a   b", "condenseWhite never reparses the independent plain-text view");
    condense.condenseWhite = false;
    condense.htmlText = "<b>a   b</b>";
    condense.condenseWhite = true;
    assert.equal(condense.text, "a   b", "condenseWhite does not retroactively reparse existing HTML");
    condense.htmlText = "<b>a   b</b>";
    assert.equal(condense.text, "a b", "condenseWhite applies on the next htmlText assignment");
});

test("TextField exposes deterministic line metrics, character bounds, line scroll, and explicit Flash auto-size", () => {
    class ProbeTextField extends TextField {
        get nativeInput(): LayaInput { return this._nativeTextInput; }
    }
    const field = new ProbeTextField();
    field.nativeInput.fontMetricsProvider = (_font, size) => ({ ascent: size * 0.8, descent: size * 0.2, lineGap: 0 });
    field.nativeInput.textAdvanceProvider = text => Array.from(text).map(() => 5);
    field.multiline = true;
    field.wordWrap = false;
    field.size(40, 17);
    field.defaultTextFormat = new TextFormat("Arial", 10, 0xffffff, false, false, false,
        null, null, TextFormatAlign.LEFT, 0, 0, 0, 2);
    field.text = "abc\rdef\rghi";

    assert.equal(field.numLines, 3);
    assert.deepEqual([field.getLineOffset(0), field.getLineLength(0), field.getLineText(0)], [0, 4, "abc\r"]);
    const metrics = field.getLineMetrics(0);
    assert.equal(metrics.width, 15);
    assert.equal(metrics.leading, 2);
    const bounds = field.getCharBoundaries(1);
    assert.ok(bounds instanceof Rectangle);
    assert.equal(bounds?.width, 5);
    assert.equal(field.getCharBoundaries(3), null, "paragraph separators have no glyph bounds");
    assert.equal(field.getCharIndexAtPoint(bounds!.x + 1, bounds!.y + 1), 1);
    assert.equal(field.getLineIndexOfChar(5), 1);
    assert.equal(field.getFirstCharInParagraph(5), 4);
    assert.equal(field.getParagraphLength(5), 4);
    assert.ok(field.maxScrollV > 1);
    let scrollEvents = 0;
    field.addEventListener(Event.SCROLL, () => scrollEvents++);
    field.scrollV = field.maxScrollV;
    assert.equal(field.scrollV, field.maxScrollV);
    assert.equal(field.bottomScrollV, 3);
    assert.equal(scrollEvents, 1);

    const right = field.x + field.width;
    field.flashAutoSize = TextFieldAutoSize.RIGHT;
    assert.equal(field.flashAutoSize, TextFieldAutoSize.RIGHT);
    assert.equal(field.autoSize, false, "Flash auto-size never mutates inherited Sprite.autoSize");
    assert.equal(field.x + field.width, right, "RIGHT auto-size retains the right edge");
    assert.throws(() => field.flashAutoSize = "true", /TextFieldAutoSize/);

    for (const mode of [TextFieldAutoSize.LEFT, TextFieldAutoSize.CENTER, TextFieldAutoSize.RIGHT]) {
        const wrapped = new ProbeTextField();
        wrapped.nativeInput.fontMetricsProvider = (_font, size) => ({ ascent: size * 0.8, descent: size * 0.2, lineGap: 0 });
        wrapped.nativeInput.textAdvanceProvider = text => Array.from(text).map(() => 5);
        wrapped.wordWrap = true;
        wrapped.multiline = true;
        wrapped.x = 17;
        wrapped.size(30, 12);
        wrapped.text = "wrapped text";
        wrapped.flashAutoSize = mode;
        assert.equal(wrapped.width, 30, `${mode} word-wrapped auto-size preserves authored width`);
        assert.equal(wrapped.x, 17, `${mode} word-wrapped auto-size preserves x`);
        assert.ok(wrapped.height > 12, `${mode} word-wrapped auto-size grows height`);
    }
});

test("TextField applies retained paragraph formats per range without global-style leakage", () => {
    class ProbeTextField extends TextField {
        get nativeInput(): LayaInput { return this._nativeTextInput; }
    }
    const field = new ProbeTextField();
    field.nativeInput.fontMetricsProvider = (_font, size) => ({ ascent: size * 0.8, descent: size * 0.2, lineGap: 0 });
    field.nativeInput.textAdvanceProvider = text => Array.from(text).map(() => 5);
    field.multiline = true;
    field.size(100, 60);
    field.defaultTextFormat = new TextFormat("Arial", 10, 0xffffff);
    field.text = "abc\rdef";

    const first = new TextFormat();
    first.align = TextFormatAlign.LEFT;
    first.leading = 1;
    first.leftMargin = 4;
    first.blockIndent = 2;
    first.indent = 3;
    const second = new TextFormat();
    second.align = TextFormatAlign.RIGHT;
    second.leading = 7;
    second.leftMargin = 5;
    second.rightMargin = 6;
    second.blockIndent = 3;
    second.indent = 11;
    field.setTextFormat(first, 0, 4);
    field.setTextFormat(second, 4, field.length);

    const firstMetrics = field.getLineMetrics(0);
    const secondMetrics = field.getLineMetrics(1);
    assert.equal(firstMetrics.leading, 1);
    assert.equal(secondMetrics.leading, 7);
    assert.equal(firstMetrics.x, 11, "left margin, block indent and first-line indent affect the first paragraph");
    assert.ok(secondMetrics.x > 60, "right alignment, margins and indent remain range-local");

    const linked = new ProbeTextField();
    const linkedFormat = new TextFormat("Arial", 10, 0xffffff);
    linkedFormat.leftMargin = 6;
    linkedFormat.indent = 4;
    linkedFormat.url = "https://example.invalid/bleach";
    linkedFormat.target = "_blank";
    linked.defaultTextFormat = linkedFormat;
    linked.text = "linked";
    assert.equal(linked.nativeInput.html, true, "default url/target selects native linked HTML layout");
    assert.equal(linked.getLineMetrics(0).x, 12, "default paragraph margins apply to assigned text");

    const authoredHtml = new ProbeTextField();
    authoredHtml.nativeInput.fontMetricsProvider = (_font, size) => ({ ascent: size * 0.8, descent: size * 0.2, lineGap: 0 });
    authoredHtml.nativeInput.textAdvanceProvider = text => Array.from(text).map(() => 5);
    authoredHtml.multiline = true;
    authoredHtml.size(100, 60);
    authoredHtml.htmlText = '<p align="right">abc</p><p align="left">def</p>';
    assert.ok(authoredHtml.getLineMetrics(0).x > 60,
        "range paragraph projection does not overwrite alignment authored in htmlText");
});

test("embedded advanced text maps CSM tables, grid fit, sharpness, and thickness into native rasterization", () => {
    class ProbeTextField extends TextField {
        get nativeInput(): LayaInput { return this._nativeTextInput; }
    }
    const fabricated = Object.create(CSMSettings.prototype) as CSMSettings;
    const proxied = new Proxy(new CSMSettings(10, 0.3, -0.2), {});
    assert.equal(isFlashCSMSettings(new CSMSettings()), true);
    assert.equal(isFlashCSMSettings(fabricated), false);
    assert.equal(isFlashCSMSettings(proxied), false);
    assert.throws(() => TextRenderer.setAdvancedAntiAliasingTable(
        "Fabricated", "regular", TextColorType.LIGHT_COLOR, [fabricated]), TypeError);
    assert.throws(() => TextRenderer.setAdvancedAntiAliasingTable(
        "Proxied", "regular", TextColorType.LIGHT_COLOR, [proxied]), TypeError);
    Object.defineProperty(CSMSettings, Symbol.hasInstance, { configurable: true, value: () => true });
    try {
        assert.throws(() => TextRenderer.setAdvancedAntiAliasingTable(
            "Hostile", "regular", TextColorType.LIGHT_COLOR, [{} as CSMSettings]), TypeError,
            "hostile Symbol.hasInstance cannot mint authenticated CSMSettings");
    } finally {
        Reflect.deleteProperty(CSMSettings, Symbol.hasInstance);
    }
    TextRenderer.setAdvancedAntiAliasingTable("FixtureCSM", "regular", TextColorType.LIGHT_COLOR, [
        new CSMSettings(10, 0.30, -0.20),
        new CSMSettings(20, 0.20, -0.10),
    ]);
    const field = new ProbeTextField();
    field.defaultTextFormat = new TextFormat("FixtureCSM", 15, 0xffffff);
    field.text = "advanced";
    field.embedFonts = true;
    field.antiAliasType = AntiAliasType.ADVANCED;
    field.gridFitType = GridFitType.PIXEL;
    field.sharpness = 50;
    field.thickness = 80;
    const settings = field.nativeInput.rasterizationSettings;
    assert.equal(settings.coverageMode, "linear-cutoff");
    assert.equal(settings.gridFit, GridFitType.PIXEL);
    assert.ok(settings.outsideCutoff! < settings.insideCutoff!);
    field.antiAliasType = AntiAliasType.NORMAL;
    assert.equal(field.nativeInput.rasterizationSettings, null);
    assert.throws(() => field.antiAliasType = "lcd", /AntiAliasType/);
    assert.throws(() => field.gridFitType = "quarter", /GridFitType/);
});

test("native focus, input and IME events project exact Flash-shaped payloads", () => {
    class ProbeTextField extends TextField {
        get nativeInput(): LayaInput { return this._nativeTextInput; }
    }
    const field = new ProbeTextField();
    field.type = TextFieldType.INPUT;
    const focus: FocusEvent[] = [];
    const text: TextEvent[] = [];
    const ime: IMEEvent[] = [];
    field.addEventListener(FocusEvent.FOCUS_IN, event => focus.push(event as FocusEvent));
    field.addEventListener(FocusEvent.FOCUS_OUT, event => focus.push(event as FocusEvent));
    field.addEventListener(TextEvent.TEXT_INPUT, event => {
        text.push(event as TextEvent);
        event.preventDefault();
    });
    field.addEventListener(IMEEvent.IME_COMPOSITION, event => ime.push(event as IMEEvent));
    field.nativeInput.event(LayaEvent.FOCUS);
    const invalidErrors: unknown[] = [];
    const previousError = console.error; console.error = value => invalidErrors.push(value);
    let getterReads = 0;
    const getterPayload = {
        get text(): string { getterReads++; throw new Error("payload getter must not run"); },
        get selectionStart(): number { getterReads++; throw new Error("payload getter must not run"); },
        get selectionEnd(): number { getterReads++; throw new Error("payload getter must not run"); },
    };
    let proxyTraps = 0;
    const hostileProxy = new Proxy({}, {
        has(): boolean { proxyTraps++; throw new Error("payload has trap must not run"); },
        get(): never { proxyTraps++; throw new Error("payload get trap must not run"); },
        getOwnPropertyDescriptor(): never { proxyTraps++; throw new Error("payload descriptor trap must not run"); },
    });
    try {
        field.nativeInput.event(LayaEvent.BEFORE_INPUT, getterPayload);
        field.nativeInput.event(LayaEvent.BEFORE_INPUT, hostileProxy);
        field.nativeInput.event(LayaEvent.COMPOSITION_START, getterPayload);
        field.nativeInput.event(LayaEvent.COMPOSITION_START, hostileProxy);
        field.nativeInput.event(LayaEvent.COMPOSITION_UPDATE, getterPayload);
        field.nativeInput.event(LayaEvent.COMPOSITION_UPDATE, hostileProxy);
    } finally { console.error = previousError; }
    field.nativeInput.event(LayaEvent.BLUR);
    assert.deepEqual(focus.map(event => event.type), [FocusEvent.FOCUS_IN, FocusEvent.FOCUS_OUT]);
    assert.ok(focus.every(event => event.target === field && event.bubbles));
    assert.deepEqual(text, [], "fabricated before-input objects cannot enter Flash routing");
    assert.deepEqual(ime, []);
    assert.equal(getterReads, 0, "text and IME admission never evaluate hostile accessors");
    assert.equal(proxyTraps, 0, "text and IME admission never evaluate hostile Proxy traps");
    assert.equal(invalidErrors.length, 6);
    assert.equal(invalidErrors.filter(error => /exact before-input text/.test(String(error))).length, 2);
    assert.equal(invalidErrors.filter(error => /authenticated composition payload/.test(String(error))).length, 4);
});

test("real InputManager hit activates composed TextInputAdapter and keeps Flash target outer", async () => {
    class ProbeTextField extends TextField {
        get nativeInput(): LayaInput { return this._nativeTextInput; }
    }
    class ProbeInputManager extends InputManager {
        bind(stage: Stage): void { this._stage = stage; }
        get hitTarget(): LayaNode { return this._touchTarget; }
    }
    class ProbeTextInputAdapter extends TextInputAdapter {
        keyboardShows = 0;
        constructor() { super(); this._editInline = false; }
        install(stage: Stage): void {
            InputManager.onMouseDownCapture.add(this.onTouchBegin, this);
            stage.on(LayaEvent.MOUSE_UP, this, this.onTouchEnd);
        }
        uninstall(stage: Stage): void {
            InputManager.onMouseDownCapture.remove(this.onTouchBegin, this);
            stage.off(LayaEvent.MOUSE_UP, this, this.onTouchEnd);
        }
        protected override onBegin(): Promise<void> {
            this._visEle = {
                value: this.target.text, selectionStart: 0, selectionEnd: 0, selectionDirection: "none"
            } as HTMLInputElement;
            return Promise.resolve();
        }
        protected override onCanShowKeyboard(): Promise<void> { this.keyboardShows++; return Promise.resolve(); }
        protected override onEnd(target: LayaInput): Promise<void> {
            target.text = this._visEle?.value ?? target.text;
            this._visEle = null;
            return Promise.resolve();
        }
        browserEdit(value: string): void {
            const state = { defaultPrevented: false };
            const before = {
                data: value, inputType: "insertText", isComposing: false, cancelable: true,
                get defaultPrevented(): boolean { return state.defaultPrevented; },
                preventDefault(): void { state.defaultPrevented = true; }
            } as unknown as InputEvent;
            this.processBeforeInput(before);
            if (state.defaultPrevented) return;
            const element = this._visEle;
            element.value = value;
            Object.defineProperties(element, {
                selectionStart: { value: value.length, configurable: true },
                selectionEnd: { value: value.length, configurable: true },
            });
            this.processInputting({ target: element } as unknown as globalThis.Event);
        }
        browserComposition(start: string, update: string, commit: string): void {
            const event = (type: string, data: string): CompositionEvent => ({
                type, data, target: this._visEle
            }) as unknown as CompositionEvent;
            this.processCompositionStart(event("compositionstart", start));
            this.processCompositionUpdate(event("compositionupdate", update));
            this._visEle.value = commit;
            this._visEle.selectionStart = commit.length;
            this._visEle.selectionEnd = commit.length;
            this.processCompositionEnd(event("compositionend", commit));
        }
    }

    const previousStage = ILaya.stage;
    const previousAdapter = PAL.textInput;
    const stage = new Stage(); stage.size(320, 200);
    ILaya.stage = stage;
    const adapter = new ProbeTextInputAdapter();
    (PAL as unknown as { textInput: TextInputAdapter }).textInput = adapter;
    adapter.install(stage);
    try {
        const field = new ProbeTextField(); field.type = TextFieldType.INPUT; field.size(120, 24); field.pos(10, 10);
        field.restrict = "A-Z"; field.maxChars = 8; field.multiline = false; field.wordWrap = true; field.selectable = true;
        stage.addChild(field);
        const manager = new ProbeInputManager(); manager.bind(stage);
        const flashClicks: MouseEvent[] = [];
        const changes: Event[] = [];
        const compositions: IMEEvent[] = [];
        const textInputs: TextEvent[] = [];
        let cancelNextInput = true;
        field.addEventListener(MouseEvent.CLICK, event => flashClicks.push(event as MouseEvent));
        field.addEventListener(Event.CHANGE, event => changes.push(event));
        field.addEventListener(IMEEvent.IME_COMPOSITION, event => compositions.push(event as IMEEvent));
        field.addEventListener(TextEvent.TEXT_INPUT, event => {
            textInputs.push(event as TextEvent);
            if (cancelNextInput) {
                cancelNextInput = false;
                event.preventDefault();
            }
        });
        const pointer = (type: string, x = 20, y = 18) => ({ type, pageX: x, pageY: y, clientX: x, clientY: y,
            button: 0, buttons: type === "mousedown" ? 1 : 0, cancelable: true, preventDefault() {} }) as globalThis.MouseEvent;
        const click = async (x: number, y: number): Promise<void> => {
            manager.handleMouse(pointer("mousedown", x, y), 0);
            await new Promise(resolve => setTimeout(resolve, 0));
            manager.handleMouse(pointer("mouseup", x, y), 1);
            await new Promise(resolve => setTimeout(resolve, 0));
        };
        manager.handleMouse(pointer("mousedown"), 0);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(manager.hitTarget, field.nativeInput, "real hit target remains native Input");
        assert.equal(adapter.target, field.nativeInput, "TextInputAdapter owns the composed native Input");
        manager.handleMouse(pointer("mouseup"), 1);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(adapter.keyboardShows, 1, "touch completion reaches the mobile keyboard seam");
        assert.equal(flashClicks.length, 1);
        assert.equal(flashClicks[0].target, field, "Flash source target is the outer TextField");
        assert.equal(changes.length, 0, "focus and click do not fabricate a change");
        const crossInputField = new ProbeTextField();
        crossInputField.addEventListener(TextEvent.TEXT_INPUT, () => undefined);
        let capturedBeforeInput: unknown = null;
        let attackedBeforeInput = false;
        field.nativeInput.on(LayaEvent.BEFORE_INPUT, field, (payload: unknown) => {
            capturedBeforeInput = payload;
            if (attackedBeforeInput) return;
            attackedBeforeInput = true;
            crossInputField.nativeInput.event(LayaEvent.BEFORE_INPUT, payload);
        });
        const beforeInputReplayErrors: unknown[] = [];
        const previousBeforeInputError = console.error;
        console.error = value => beforeInputReplayErrors.push(value);
        try {
            adapter.browserEdit("BLOCKED");
            field.nativeInput.event(LayaEvent.BEFORE_INPUT, capturedBeforeInput);
        } finally {
            console.error = previousBeforeInputError;
            crossInputField.destroy(true);
        }
        assert.equal(field.text, "", "Flash textInput cancellation reaches the browser edit before mutation");
        assert.equal(changes.length, 0, "cancelled browser input produces no change generation");
        assert.deepEqual(textInputs.map(event => event.text), ["BLOCKED"]);
        assert.equal(beforeInputReplayErrors.length, 2,
            "cross-field and stale before-input payload replays fail closed");
        assert.ok(beforeInputReplayErrors.every(error => /exact before-input text/.test(String(error))));
        adapter.browserEdit("ABC");
        assert.equal(field.text, "ABC");
        assert.deepEqual(textInputs.map(event => event.text), ["BLOCKED", "ABC"]);
        assert.equal(changes.length, 1, "real Laya INPUT becomes outer Flash change after mutation");
        assert.equal(changes[0].target, field);
        await click(250, 100);
        assert.equal(adapter.target, null);
        assert.equal(changes.length, 1, "later adapter CHANGE and blur do not duplicate the edited generation");

        await click(20, 18);
        assert.equal(adapter.target, field.nativeInput);
        field.text = "PROGRAM";
        assert.equal(changes.length, 1, "programmatic text assignment while focused is not a user change");
        await click(250, 100);
        assert.equal(changes.length, 1, "programmatic assignment remains silent after real adapter blur");

        await click(20, 18);
        assert.equal(adapter.target, field.nativeInput);
        await click(250, 100);
        assert.equal(changes.length, 1, "untouched real focus and blur emit no Flash change");

        field.restrict = null;
        await click(20, 18);
        const crossField = new ProbeTextField();
        let capturedComposition: unknown = null;
        let attackedActivePayload = false;
        field.nativeInput.on(LayaEvent.COMPOSITION_START, field, (payload: unknown) => {
            capturedComposition = payload;
            if (attackedActivePayload) return;
            attackedActivePayload = true;
            crossField.nativeInput.event(LayaEvent.COMPOSITION_START, payload);
            field.nativeInput.event(LayaEvent.COMPOSITION_END, payload);
        });
        const replayErrors: unknown[] = [];
        const previousError = console.error;
        console.error = value => replayErrors.push(value);
        try {
            adapter.browserComposition("に", "日本", "日本語");
            field.nativeInput.event(LayaEvent.COMPOSITION_START, capturedComposition);
        } finally {
            console.error = previousError;
            crossField.destroy(true);
        }
        assert.equal(replayErrors.length, 3,
            "cross-field, wrong-phase and stale composition payload replays fail closed");
        assert.ok(replayErrors.every(error => /authenticated composition payload/.test(String(error))));
        assert.deepEqual(compositions.map(event => event.text), ["に", "日本", "日本語"]);
        assert.equal(field.nativeInput.composing, false);
        assert.equal(field.nativeInput.compositionText, "");
        assert.equal(field.text, "日本語");
        assert.deepEqual([field.selectionBeginIndex, field.selectionEndIndex, field.caretIndex], [3, 3, 3]);
        assert.equal(changes.length, 2, "composition commit is one dirty user generation");
        await click(250, 100);
        assert.equal(changes.length, 2, "composition blur does not duplicate its committed change");
        assert.deepEqual([field.restrict, field.maxChars, field.multiline, field.wordWrap, field.selectable],
            [null, 8, false, true, true]);
        field.mouseEnabled = false;
        assert.equal(field.nativeInput.mouseEnabled, false, "outer authored mouse policy disables the native hit owner");
    } finally {
        adapter.uninstall(stage);
        await adapter.end();
        (PAL as unknown as { textInput: typeof previousAdapter }).textInput = previousAdapter;
        ILaya.stage = previousStage;
        stage.destroy(true);
    }
});

test("tab traversal uses native Stage focus order and a visible focus indicator", () => {
    class ProbeInputManager extends InputManager { bind(stage: Stage): void { this._stage = stage; } }
    const previousStage = ILaya.stage;
    const stage = new Stage(); stage.size(320, 200); ILaya.stage = stage;
    try {
        const first = new InteractiveObject(); first.name = "first"; first.size(50, 20);
        first.tabIndex = 2; first.tabEnabled = true; first.focusRect = true;
        const second = new InteractiveObject(); second.name = "second"; second.size(50, 20);
        second.tabIndex = 1; second.tabEnabled = true; second.focusRect = true;
        stage.addChildren(first, second);
        const manager = new ProbeInputManager(); manager.bind(stage);
        let prevented = 0;
        const tab = (shiftKey: boolean) => ({ type: "keydown", key: "Tab", keyCode: 9, shiftKey,
            cancelable: true, preventDefault(): void { prevented++; } }) as unknown as globalThis.KeyboardEvent;
        manager.handleKeys(tab(false));
        assert.equal(stage.focus, second);
        assert.ok(second.getChildByName("__flashFocusIndicator"), "focused control owns a visible native ring");
        manager.handleKeys(tab(false));
        assert.equal(stage.focus, first);
        assert.equal(second.getChildByName("__flashFocusIndicator"), null);
        manager.handleKeys(tab(true));
        assert.equal(stage.focus, second);
        assert.equal(prevented, 3);
        const duplicate = new InteractiveObject(); duplicate.name = "duplicate";
        duplicate.tabEnabled = true; duplicate.tabIndex = second.tabIndex; stage.addChild(duplicate);
        const errors: unknown[] = [];
        const previousError = console.error; console.error = value => errors.push(value);
        try { manager.handleKeys(tab(false)); } finally { console.error = previousError; }
        assert.match(String(errors[0]), /unique tabIndex/);
        assert.equal(stage.focus, second, "ambiguous tab order never changes focus");
    } finally {
        ILaya.stage = previousStage;
        stage.destroy(true);
    }
});

test("real Laya ADDED and REMOVED use one Flash Event through capture, target and bubble", () => {
    const parent = new DisplayObject();
    const child = new DisplayObject();
    for (const type of [Event.ADDED, Event.REMOVED]) {
        const seen: Event[] = [];
        parent.addEventListener(type, event => seen.push(event), true);
        parent.addEventListener(type, event => seen.push(event));
        child.addEventListener(type, event => seen.push(event));
        if (type === Event.ADDED) parent.addChild(child); else parent.removeChild(child);
        assert.equal(seen.length, 3);
        assert.ok(seen.every(event => event === seen[0]));
        assert.equal(seen[0].target, child);
        assert.equal(seen[0].bubbles, true);
    }
});

test("timeline invariants reject fallback and invalid replacement without corrupting state", () => {
    const movie = new MovieClip();
    assert.throws(() => movie.totalFrames, error => error instanceof UnsupportedFlashFeatureError);
    const animator = new AnimatorClip2D();
    const clip = new AnimationClip2D(); clip._duration = 0.5; clip._frameRate = 6; animator.autoPlay = false; animator.clip = clip;
    const timeline = new AnimatorClip2DTimeline(animator);
    movie._bindNativeTimeline(timeline, { idle: 1, done: 3 });
    movie.gotoAndStop("done");
    assert.equal(movie.currentFrame, 3);
    assert.throws(() => movie._bindNativeTimeline(timeline, { broken: 4 }), /outside/);
    assert.equal(movie.currentFrame, 3);
    assert.deepEqual({ ...movie.flashFrameLabels }, { idle: 1, done: 3 });
    const invalid = { totalFrames: 0, currentFrame: 0, playing: false, play() {}, stop() {}, gotoAndStop() {} };
    assert.throws(() => movie._bindNativeTimeline(invalid), /totalFrames/);
    assert.equal(movie.totalFrames, 3);
});

test("neutral Laya host rejects missing native event, selection, cue, frame and time data", () => {
    const host = new LayaAuthoredBindingHost();
    const click = new DisplayObject(); click.name = "button";
    const clickLease = host.attach([{ node: click, nodeId: "button", type: "click", receive: () => undefined }]);
    assert.throws(() => mapLayaAuthoredEventData(click, "click", LayaEvent.CLICK, undefined), /requires a native Laya Event/);
    clickLease.detach();

    const input = new DisplayObject(); input.name = "input"; (input as any).text = "value";
    const inputLease = host.attach([{ node: input, nodeId: "input", type: "input", receive: () => undefined }]);
    assert.throws(() => mapLayaAuthoredEventData(input, "input", LayaEvent.INPUT,
        new LayaEvent().setTo(LayaEvent.INPUT, input, input)), /selectionStart/);
    inputLease.detach();

    const timeline = new DisplayObject(); timeline.name = "timeline";
    const cueLease = host.attach([{ node: timeline, nodeId: "timeline", type: "cue", receive: () => undefined }]);
    assert.throws(() => mapLayaAuthoredEventData(timeline, "cue", LayaEvent.LABEL,
        { timelineId: "timeline", cueId: "start" }), /frame/);
    assert.throws(() => mapLayaAuthoredEventData(timeline, "cue", LayaEvent.LABEL,
        { timelineId: "timeline", cueId: "start", frame: 1 }), /timeMs/);
    cueLease.detach();
});

test("explicit bootstrap loads canonical Laya hierarchy with application linkage and named injection", () => {
    registerAuthoredContentRuntime([
        { id: "fixtures.FlashPanel", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite" },
        { id: "fixtures.SubmitButtonLinkage", ctor: SubmitButtonLinkage, sourceType: "SimpleButton", serializedType: "Sprite" },
        { id: "fixtures.ButtonStateLinkage", ctor: ButtonStateLinkage, sourceType: "DisplayObject", serializedType: "Sprite" }
    ]);
    // Idempotent identical bootstrap is admitted; Flash aliases and collisions are not.
    registerAuthoredContentRuntime([{
        id: "fixtures.FlashPanel", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite"
    }]);
    assert.throws(() => registerAuthoredContentRuntime([
        { id: "fixtures.Duplicate", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite" },
        { id: "fixtures.Duplicate", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite" }
    ]), /Duplicate/);
    assert.throws(() => registerAuthoredContentRuntime([{
        id: "flash.display.MovieClip", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite"
    }]), /application-owned/);
    assert.throws(() => registerAuthoredContentRuntime([{
        id: "fixtures.FlashPanel", ctor: SubmitButtonLinkage, sourceType: "SimpleButton", serializedType: "Sprite"
    }]), /collision/);
    assert.throws(() => registerAuthoredContentRuntime([{
        id: "fixtures.WrongSerialized", ctor: SubmitButtonLinkage, sourceType: "SimpleButton", serializedType: "Input"
    }]), /does not match/);
    const data = JSON.parse(readFileSync(join(process.cwd(), "tests/extensions/authoredContentBridge/fixtures/flash-panel.lh"), "utf8"));
    const serializedTypes: string[] = [];
    const visit = (node: any): void => { serializedTypes.push(node._$type); for (const child of node._$child ?? []) visit(child); };
    visit(data);
    assert.ok(serializedTypes.every(type => type === "Sprite"));
    const errors: unknown[] = [];
    const panel = new PrefabImpl(HierarchyParser, data).create(undefined, errors) as FlashPanel;
    assert.deepEqual(errors, []);
    assert.ok(panel instanceof FlashPanel);
    assert.ok(panel.submitButton instanceof SubmitButtonLinkage, `actual child: ${panel.submitButton?.constructor?.name}`);
    assert.equal(panel.submitButton.hitTestState?.visible, false);
    const mismatched = structuredClone(data);
    mismatched._$type = "Input";
    const mismatchErrors: unknown[] = [];
    assert.ok(!new PrefabImpl(HierarchyParser, mismatched).create(undefined, mismatchErrors));
    assert.match(String(mismatchErrors[0]), /requires serialized type 'Sprite'/);
});

test("loaded canonical prefab exposes a fail-closed synchronous definition token", () => {
    registerAuthoredContentRuntime([{
        id: "fixtures.FlashPanel", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite"
    }]);
    const data = JSON.parse(readFileSync(join(process.cwd(), "tests/extensions/authoredContentBridge/fixtures/flash-panel.lh"), "utf8"));
    const prefab = new PrefabImpl(HierarchyParser, data);
    const Definition = createAuthoredPrefabDefinition("fixtures.FlashPanel", prefab, FlashPanel);
    const panel = new Definition();
    assert.ok(panel instanceof FlashPanel);
    assert.ok(panel.submitButton instanceof SubmitButtonLinkage);
    panel.destroy(true);

    assert.throws(() => createAuthoredPrefabDefinition("flash.display.MovieClip", prefab, FlashPanel), /application-owned/);
    assert.throws(() => createAuthoredPrefabDefinition("fixtures.Missing", {} as any, FlashPanel), /loaded canonical/);
    const wrongRoot = { create: () => new SubmitButtonLinkage() };
    assert.throws(() => new (createAuthoredPrefabDefinition("fixtures.WrongRoot", wrongRoot, FlashPanel))(), /expected FlashPanel/);
    const failed = new FlashPanel();
    let destroyed = false;
    failed.destroy = (() => { destroyed = true; }) as typeof failed.destroy;
    const errored = { create: (_options?: Record<string, unknown>, errors?: unknown[]) => {
        errors?.push("fixture failure");
        return failed;
    } };
    assert.throws(() => new (createAuthoredPrefabDefinition("fixtures.Errored", errored, FlashPanel))(), /fixture failure/);
    assert.equal(destroyed, true);
});

test("transpiled-style class keeps Flash add/remove APIs and bound method identity", () => {
    const panel = createPanel();
    const animator = new AnimatorClip2D();
    const clip = new AnimationClip2D(); clip._duration = 0.5; clip._frameRate = 6; animator.autoPlay = false; animator.clip = clip;
    panel._bindNativeTimeline(new AnimatorClip2DTimeline(animator), { idle: 1, done: 3 });
    panel.activate();
    panel.submitButton.event(LayaEvent.CLICK, nativeMouse(LayaEvent.CLICK, panel.submitButton, 40, 24, 0));
    assert.equal(panel.clickCount, 1); assert.equal(panel.status, "clicked"); assert.equal(panel.currentFrame, 3);
    panel.deactivate();
    panel.submitButton.event(LayaEvent.CLICK, nativeMouse(LayaEvent.CLICK, panel.submitButton, 40, 24, 0));
    assert.equal(panel.clickCount, 1);
});

function state(width: number, height: number): DisplayObject {
    const value = new DisplayObject(); value.size(width, height); return value;
}
function nativeMouse(type: string, target: DisplayObject, x: number, y: number, buttons: number): LayaEvent {
    const event = new LayaEvent(); event.touchPos.setTo(x, y); event.button = 0;
    Object.defineProperty(event, "nativeEvent", { value: { buttons, ctrlKey: false, altKey: false, shiftKey: false }, configurable: true });
    event.setTo(type, target, target); return event;
}
function createPanel(): FlashPanel {
    registerAuthoredContentRuntime([
        { id: "fixtures.FlashPanel", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite" },
        { id: "fixtures.SubmitButtonLinkage", ctor: SubmitButtonLinkage, sourceType: "SimpleButton", serializedType: "Sprite" },
        { id: "fixtures.ButtonStateLinkage", ctor: ButtonStateLinkage, sourceType: "DisplayObject", serializedType: "Sprite" }
    ]);
    const data = JSON.parse(readFileSync(join(process.cwd(), "tests/extensions/authoredContentBridge/fixtures/flash-panel.lh"), "utf8"));
    const errors: unknown[] = [];
    const panel = new PrefabImpl(HierarchyParser, data).create(undefined, errors) as FlashPanel;
    assert.deepEqual(errors, []); return panel;
}
