import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ILaya } from "../../src/layaAir/ILaya";
import { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject";
import { BitmapFilter } from "../../src/layaAir/flash/filters/BitmapFilter";
import { BlurFilter, isBlurFilter } from "../../src/layaAir/flash/filters/BlurFilter";
import { ColorMatrixFilter, isColorMatrixFilter } from "../../src/layaAir/flash/filters/ColorMatrixFilter";
import { DropShadowFilter, isDropShadowFilter } from "../../src/layaAir/flash/filters/DropShadowFilter";
import { FilterProxy } from "../../src/layaAir/flash/filters/FilterProxy";
import { bitmapFilterEquals, isBitmapFilter } from "../../src/layaAir/flash/filters/FilterRegistry";
import { GlowFilter, isGlowFilter } from "../../src/layaAir/flash/filters/GlowFilter";
import { GradientBevelFilter, isGradientBevelFilter } from "../../src/layaAir/flash/filters/GradientBevelFilter";
import {
    createFlashAuthoredBevelFilter, FlashBevelEffect2D,
} from "../../src/layaAir/laya/display/effect2d/FlashBevelEffects";
import {
    FLASH_IDENTITY_COLOR_MATRIX, FlashBlurEffect2D, FlashColorMatrixEffect2D, FlashShadowEffect2D,
    applyFlashColorMatrixPixel, flashBoxKernelMargins, flashBoxKernelOffsets,
} from "../../src/layaAir/laya/display/effect2d/FlashFilterEffects";
import { PostProcess2D } from "../../src/layaAir/laya/display/PostProcess2D";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { NoRenderUnitModuleDataFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderUnitModuleDataFactory";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import "../../src/layaAir/laya/ModuleDef";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
LayaGL.unitRenderModuleDataFactory = new NoRenderUnitModuleDataFactory();
await LayaGL.renderDeviceFactory.createEngine(null as any, null as any);
ILaya.stage = { _graphicUpdateList: new Set(), _tranMatrixUpdateList: new Set() } as any;
ILaya.timer = { callLater: (): void => undefined } as any;

class DetachedFilterDisplayObject extends DisplayObject {
    private readonly _filterPostProcess = {
        clear(): void {},
        addEffect<T>(effect: T): T { return effect; },
    };
    protected override getPostProcess(_create: boolean = true): PostProcess2D {
        return this._filterPostProcess as unknown as PostProcess2D;
    }
    override get postProcess(): PostProcess2D { return this._filterPostProcess as unknown as PostProcess2D; }
    override set postProcess(_value: PostProcess2D) {}
    injectRawFilters(value: BitmapFilter[]): void {
        if (!Reflect.defineProperty(this, "_filterArr", { value, writable: true, configurable: true }))
            throw new Error("Laya Sprite filter backing is unavailable");
    }
}

test("BlurFilter matches the Pepper Flash constructor, setter, and clone oracle", () => {
    const blur = new BlurFilter();
    assert.deepEqual([blur.blurX, blur.blurY, blur.quality], [4, 4, 1]);
    blur.blurX = -1; blur.blurY = 300; blur.quality = 20;
    assert.deepEqual([blur.blurX, blur.blurY, blur.quality], [0, 255, 15]);
    blur.blurX = Number.NaN; blur.blurY = Number.POSITIVE_INFINITY; blur.quality = -3;
    assert.ok(Number.isNaN(blur.blurX));
    assert.deepEqual([blur.blurY, blur.quality], [255, 0]);
    blur.blurX = 4.75; blur.blurY = 5.25; blur.quality = 2.9;
    assert.deepEqual([blur.blurX, blur.blurY, blur.quality], [4.75, 5.25, 2]);
    const clone = blur.clone(); clone.blurX = 9;
    assert.equal(isBlurFilter(clone), true);
    assert.deepEqual([blur.blurX, clone.blurX], [4.75, 9]);
});

test("GlowFilter matches byte alpha, numeric clamps, booleans, and clone semantics", () => {
    const glow = new GlowFilter();
    assert.deepEqual([glow.color, glow.alpha, glow.blurX, glow.blurY, glow.strength, glow.quality, glow.inner, glow.knockout],
        [16711680, 1, 6, 6, 2, 1, false, false]);
    glow.color = 0x12345678; glow.alpha = -2; glow.blurX = -4; glow.blurY = 999;
    glow.strength = 999; glow.quality = 99; glow.inner = 1 as any; glow.knockout = "" as any;
    assert.deepEqual([glow.color, glow.alpha, glow.blurX, glow.blurY, glow.strength, glow.quality, glow.inner, glow.knockout],
        [3430008, 0, 0, 255, 255, 15, true, false]);
    glow.alpha = 4; glow.strength = -5; glow.quality = -2;
    assert.deepEqual([glow.alpha, glow.strength, glow.quality], [1, 0, 0]);
    glow.alpha = 0.25; glow.strength = 1.25;
    assert.deepEqual([glow.alpha, glow.strength], [63 / 255, 1.25]);
    glow.alpha = Number.NaN; glow.strength = Number.NaN;
    assert.deepEqual([glow.alpha, glow.strength], [0, 0]);
    const clone = glow.clone(); clone.color = 7;
    assert.deepEqual([glow.color, clone.color], [3430008, 7]);
});

test("DropShadowFilter preserves distance, normalizes angle, and exposes every Flash value", () => {
    const shadow = new DropShadowFilter();
    assert.deepEqual([shadow.distance, shadow.angle, shadow.color, shadow.alpha, shadow.blurX, shadow.blurY,
        shadow.strength, shadow.quality, shadow.inner, shadow.knockout, shadow.hideObject],
    [4, 45, 0, 1, 4, 4, 1, 1, false, false, false]);
    shadow.distance = -999; shadow.angle = -450; shadow.color = 0xabcdef12; shadow.alpha = 2;
    shadow.blurX = -2; shadow.blurY = 999; shadow.strength = 999; shadow.quality = 99;
    shadow.inner = 1 as any; shadow.knockout = 1 as any; shadow.hideObject = 1 as any;
    assert.deepEqual([shadow.distance, shadow.angle, shadow.color, shadow.alpha, shadow.blurX, shadow.blurY,
        shadow.strength, shadow.quality, shadow.inner, shadow.knockout, shadow.hideObject],
    [-999, -90, 13496082, 1, 0, 255, 255, 15, true, true, true]);
    shadow.distance = 999; shadow.angle = 810; shadow.alpha = -1; shadow.strength = -1; shadow.quality = -1;
    assert.deepEqual([shadow.distance, shadow.angle, shadow.alpha, shadow.strength, shadow.quality], [999, 90, 0, 0, 0]);
    shadow.distance = Number.NaN; shadow.angle = 361.25; shadow.alpha = 0.25; shadow.strength = 1.25;
    assert.ok(Number.isNaN(shadow.distance));
    assert.deepEqual([shadow.angle, shadow.alpha, shadow.strength], [1.25, 63 / 255, 1.25]);
    const clone = shadow.clone(); clone.distance = 7;
    assert.ok(Number.isNaN(shadow.distance)); assert.equal(clone.distance, 7);
});

test("ColorMatrixFilter copies on every boundary and retains exactly 20 values", () => {
    const source = Array.from({ length: 20 }, (_, index) => index + 1);
    const filter = new ColorMatrixFilter(source); source[0] = 99;
    const read = filter.matrix; read[1] = 88;
    assert.deepEqual([filter.matrix[0], filter.matrix[1], filter.matrix.length], [1, 2, 20]);
    filter.matrix = read;
    assert.equal(filter.matrix[1], 88);
    const clone = filter.clone(); const cloneMatrix = clone.matrix; cloneMatrix[2] = 77; clone.matrix = cloneMatrix;
    assert.deepEqual([filter.matrix[2], clone.matrix[2]], [3, 77]);
    assert.deepEqual(new ColorMatrixFilter().matrix, FLASH_IDENTITY_COLOR_MATRIX);
    assert.deepEqual(new ColorMatrixFilter(null).matrix, FLASH_IDENTITY_COLOR_MATRIX, "constructor null selects the Flash identity default");
    assert.throws(() => filter.matrix = null as any, TypeError);
    filter.matrix = [1, 2, 3];
    assert.deepEqual(filter.matrix, [1, 2, 3, ...new Array(17).fill(0)]);
    filter.matrix = Array.from({ length: 22 }, (_, index) => index + 1);
    assert.deepEqual(filter.matrix, Array.from({ length: 20 }, (_, index) => index + 1));
});

test("GradientBevelFilter matches the Pepper constructor, array, scalar, type, and clone oracle", () => {
    const gradient = new GradientBevelFilter();
    assert.deepEqual([
        gradient.distance, gradient.angle, gradient.colors, gradient.alphas, gradient.ratios,
        gradient.blurX, gradient.blurY, gradient.strength, gradient.quality, gradient.type, gradient.knockout,
    ], [4, 45, null, null, null, 4, 4, 1, 1, "inner", false]);

    const sourceColors = [0x12345678, 0x112233];
    const sourceAlphas = [-1, 2];
    const sourceRatios = [-2, 300];
    gradient.colors = sourceColors; gradient.alphas = sourceAlphas; gradient.ratios = sourceRatios;
    sourceColors[0] = 7; sourceAlphas[0] = 0.5; sourceRatios[0] = 8;
    const readColors = gradient.colors!; const readAlphas = gradient.alphas!; const readRatios = gradient.ratios!;
    readColors[1] = 9; readAlphas[1] = 0.25; readRatios[1] = 10;
    assert.deepEqual([gradient.colors, gradient.alphas, gradient.ratios], [[3430008, 1122867], [0, 1], [0, 255]]);

    gradient.colors = [-1, 0x12345678];
    gradient.alphas = [Number.NaN, 0.25];
    gradient.ratios = [31.75, 128.9];
    assert.deepEqual([gradient.colors, gradient.alphas, gradient.ratios],
        [[16777215, 3430008], [0, 63 / 255], [31, 128]]);
    gradient.distance = -999; gradient.angle = -450; gradient.blurX = -1; gradient.blurY = 999;
    gradient.strength = 999; gradient.quality = 99; gradient.type = "bogus"; gradient.knockout = 1 as any;
    assert.deepEqual([
        gradient.distance, gradient.angle, gradient.blurX, gradient.blurY,
        gradient.strength, gradient.quality, gradient.type, gradient.knockout,
    ], [-999, -90, 0, 255, 255, 15, "full", true]);

    const clone = gradient.clone();
    const cloneColors = clone.colors!; cloneColors[0] = 1; clone.colors = cloneColors;
    assert.equal(isGradientBevelFilter(clone), true);
    assert.deepEqual([gradient.colors![0], clone.colors![0]], [16777215, 1]);
    assert.throws(() => { gradient.colors = null; }, TypeError);
    assert.throws(() => { gradient.alphas = null; }, TypeError);
    assert.throws(() => { gradient.ratios = null; }, TypeError);
    assert.throws(() => { gradient.colors = new Uint32Array(2) as unknown as number[]; }, /non-null Array/);
});

test("authored BEVELFILTER maps exact FFDec flags and four-stop ramp into the shared native effect", () => {
    const filter = createFlashAuthoredBevelFilter({
        sourceType: "BEVELFILTER", distance: 7, angleRadians: Math.PI / 3,
        highlightColor: 0xff8822, highlightAlpha: 225 / 255,
        shadowColor: 0x251a70, shadowAlpha: 195 / 255,
        blurX: 9, blurY: 5, strength: 2.4, passes: 2,
        innerShadow: false, onTop: true, knockout: true, compositeSource: false,
    });
    const effect = filter.getEffect();
    assert.ok(effect instanceof FlashBevelEffect2D);
    assert.deepEqual({
        distance: effect.options.distance, angleRadians: effect.options.angleRadians,
        blurX: effect.options.blurX, blurY: effect.options.blurY,
        strength: effect.options.strength, quality: effect.options.quality,
        type: effect.options.type, knockout: effect.options.knockout,
        compositeSource: effect.options.compositeSource,
        gradient: effect.options.gradient,
    }, {
        distance: 7, angleRadians: Math.PI / 3, blurX: 9, blurY: 5,
        strength: 2.4, quality: 2, type: "full", knockout: true, compositeSource: false,
        gradient: {
            colors: [0x251a70, 0x251a70, 0xff8822, 0xff8822],
            alphas: [195 / 255, 0, 0, 225 / 255], ratios: [0, 127 / 255, 128 / 255, 1],
        },
    });
    const inner = createFlashAuthoredBevelFilter({
        sourceType: "BEVELFILTER", distance: 0, angleRadians: 0,
        highlightColor: 0xffffff, highlightAlpha: 1, shadowColor: 0, shadowAlpha: 1,
        blurX: 0, blurY: 0, strength: 1, passes: 0,
        innerShadow: true, onTop: true, knockout: false, compositeSource: true,
    }).getEffect() as FlashBevelEffect2D;
    assert.equal(inner.options.type, "inner", "FFDec onTop does not override innerShadow");
    assert.throws(() => createFlashAuthoredBevelFilter({ sourceType: "GRADIENTBEVELFILTER" } as any), /BEVELFILTER/);
    assert.throws(() => createFlashAuthoredBevelFilter({
        sourceType: "BEVELFILTER", distance: 0, angleRadians: 0,
        highlightColor: 0, highlightAlpha: 1, shadowColor: 0, shadowAlpha: 1,
        blurX: 0, blurY: 0, strength: 1, passes: 16,
        innerShadow: true, onTop: false, knockout: false, compositeSource: true,
    }), /passes/);
});

test("DisplayObject.filters owns detached arrays and detached filter values", () => {
    const owner = new DetachedFilterDisplayObject();
    const original = new BlurFilter(4, 6, 2);
    owner.filters = [original];
    original.blurX = 99;
    assert.equal((owner.filters[0] as BlurFilter).blurX, 4, "setter clones caller-owned values");
    const first = owner.filters;
    const second = owner.filters;
    assert.notEqual(first, second); assert.notEqual(first[0], second[0]);
    (first[0] as BlurFilter).blurX = 12;
    assert.equal((owner.filters[0] as BlurFilter).blurX, 4, "getter mutation is detached");
    owner.filters = first;
    assert.equal((owner.filters[0] as BlurFilter).blurX, 12, "reattaching the detached copy applies it");
    first.length = 0;
    assert.equal(owner.filters.length, 1, "later array mutation is detached");
    for (const hole of [0, 1, 2]) {
        const sparse = new Array<BitmapFilter>(3);
        for (let index = 0; index < sparse.length; index++) {
            if (index !== hole) sparse[index] = new GlowFilter(index + 1);
        }
        assert.throws(() => { owner.filters = sparse; }, new RegExp(`filters\\[${hole}\\].*BitmapFilter`));
        assert.equal(owner.filters.length, 1, `sparse hole ${hole} cannot partially publish a staged collection`);
        assert.equal((owner.filters[0] as BlurFilter).blurX, 12);
    }
    const sparseInternal = new Array<BitmapFilter>(2);
    sparseInternal[1] = new BlurFilter();
    owner.injectRawFilters(sparseInternal);
    assert.throws(() => owner.filters, /non-Flash filter/, "getter must reject rather than preserve internal holes");
    owner.filters = [new BlurFilter(12, 6, 2)];
    owner.filters = [];
    assert.deepEqual(owner.filters, []);
    owner.filters = [new GlowFilter()];
    owner.filters = null;
    assert.deepEqual(owner.filters, [], "null clears the Flash filter collection");
    assert.throws(() => owner.filters = [null as unknown as BitmapFilter], /BitmapFilter/);
});

test("FilterProxy is sealed and forwards only explicit properties with structural equality", async () => {
    const owner = new DetachedFilterDisplayObject();
    const proxy = new FilterProxy(new BlurFilter(0, 0), true, false);
    assert.equal(Object.isSealed(proxy), true);
    assert.throws(() => Object.assign(proxy, { dynamic: 1 }), TypeError);
    proxy.applyFilter(owner);
    assert.equal(proxy.index, 0);
    assert.equal(bitmapFilterEquals(owner.filters[0], proxy.filter), true);
    proxy.setProperty("blurX", 35); proxy.blurY = 7;
    assert.deepEqual([(owner.filters[0] as BlurFilter).blurX, (owner.filters[0] as BlurFilter).blurY], [35, 7]);
    owner.filters = [new GlowFilter(), new BlurFilter(35, 7)];
    assert.equal(proxy.updateIndex(), 1, "detached clone is found structurally without AMF");
    proxy.removeFilter(); assert.equal(owner.filters.length, 1);
    const delayed = new FilterProxy(new BlurFilter(1, 1), false, true);
    delayed.applyFilter(owner); delayed.blurX = 9; delayed.blurY = 11;
    assert.notEqual((owner.filters[1] as BlurFilter).blurX, 9);
    await Promise.resolve();
    assert.deepEqual([(owner.filters[1] as BlurFilter).blurX, (owner.filters[1] as BlurFilter).blurY], [9, 11]);
    const gradientProxy = new FilterProxy(new GradientBevelFilter(4, 45, [0, 0xffffff], [1, 1], [0, 255]), false, false);
    gradientProxy.applyFilter(owner);
    gradientProxy.setProperty("distance", 12);
    gradientProxy.setProperty("angle", 810);
    gradientProxy.setProperty("strength", 3.5);
    gradientProxy.setProperty("type", "outer");
    const attachedGradient = owner.filters[2] as GradientBevelFilter;
    assert.deepEqual([attachedGradient.distance, attachedGradient.angle, attachedGradient.strength, attachedGradient.type],
        [12, 90, 3.5, "outer"]);
});

test("filter and display brands reject prototype, Proxy, and Symbol.hasInstance spoofing without traps", () => {
    const owner = new DetachedFilterDisplayObject();
    const blur = new BlurFilter(4, 6, 2);
    const prototypeSpoof = Object.create(BlurFilter.prototype);
    let trapCount = 0;
    const hostile = new Proxy(prototypeSpoof, {
        get() { trapCount++; throw new Error("untrusted get trap executed"); },
        getPrototypeOf() { trapCount++; throw new Error("untrusted prototype trap executed"); },
    });
    const wrappedReal = new Proxy(blur, {
        get() { trapCount++; throw new Error("wrapped filter trap executed"); },
        getPrototypeOf() { trapCount++; throw new Error("wrapped filter prototype trap executed"); },
    });

    assert.equal(isBlurFilter(blur), true);
    assert.equal(isGlowFilter(new GlowFilter()), true);
    assert.equal(isDropShadowFilter(new DropShadowFilter()), true);
    assert.equal(isColorMatrixFilter(new ColorMatrixFilter()), true);
    assert.equal(isGradientBevelFilter(new GradientBevelFilter()), true);
    for (const value of [prototypeSpoof, hostile, wrappedReal]) {
        assert.equal(isBitmapFilter(value), false);
        assert.equal(bitmapFilterEquals(blur, value as BitmapFilter), false);
        assert.throws(() => owner.filters = [value as BitmapFilter], /concrete native BitmapFilter/);
        assert.throws(() => new FilterProxy(value as BitmapFilter), /concrete native BitmapFilter/);
    }

    const displayPrototypeSpoof = Object.create(DisplayObject.prototype);
    const wrappedOwner = new Proxy(owner, {
        get() { trapCount++; throw new Error("wrapped display trap executed"); },
        getPrototypeOf() { trapCount++; throw new Error("wrapped display prototype trap executed"); },
    });
    const proxy = new FilterProxy(blur);
    assert.throws(() => proxy.applyFilter(displayPrototypeSpoof), /native flash\.display\.DisplayObject/);
    assert.throws(() => proxy.applyFilter(wrappedOwner), /native flash\.display\.DisplayObject/);

    Object.defineProperty(BlurFilter, Symbol.hasInstance, {
        configurable: true,
        value() { trapCount++; throw new Error("Symbol.hasInstance trap executed"); },
    });
    try {
        assert.equal(isBitmapFilter(blur), true);
        owner.filters = [blur];
        assert.equal(bitmapFilterEquals(owner.filters[0], blur), true);
        proxy.applyFilter(owner);
    } finally {
        delete (BlurFilter as unknown as Record<PropertyKey, unknown>)[Symbol.hasInstance];
    }
    assert.equal(trapCount, 0);
    assert.throws(() => Reflect.construct(BitmapFilter as any, []), /not constructible/);
});

test("filter nominal authority exposes no generic or deep-importable mint seam", () => {
    const root = process.cwd();
    assert.equal(existsSync(join(root, "src/layaAir/laya/display/effect2d/FlashFilterBrands.ts")), false);
    for (const file of ["BlurFilter.ts", "ColorMatrixFilter.ts", "DropShadowFilter.ts", "GlowFilter.ts", "GradientBevelFilter.ts"]) {
        const source = readFileSync(join(root, "src/layaAir/flash/filters", file), "utf8");
        assert.doesNotMatch(source, /export\s+function\s+(?:brand|register)/i, `${file} must expose only a read-only predicate`);
        assert.match(source, /new WeakMap<object,/, `${file} must own private nominal state`);
        assert.match(source, /Object\.seal\(this\)/, `${file} must reject own-property method and state shadowing`);
        assert.match(source, /Object\.freeze\([^\n]+\.prototype\)/, `${file} must reject prototype method mutation`);
    }
    const registry = readFileSync(join(root, "src/layaAir/flash/filters/FilterRegistry.ts"), "utf8");
    assert.doesNotMatch(registry, /Weak(?:Map|Set)|brand|register/i, "aggregate registry cannot mint nominal values");
});

test("sealed concrete filters reject method and private-state shadowing without partial publication", () => {
    const owner = new DetachedFilterDisplayObject();
    owner.filters = [new GlowFilter()];
    const filter = new BlurFilter(7, 5, 2);
    let trapCount = 0;
    const hostileClone = (): BlurFilter => { trapCount++; return new BlurFilter(99, 99, 15); };
    assert.equal(Object.isSealed(filter), true);
    assert.equal(Object.isFrozen(BlurFilter.prototype), true);
    assert.equal(Reflect.defineProperty(filter, "clone", { get() { trapCount++; return hostileClone; } }), false);
    assert.equal(Reflect.set(filter, "clone", hostileClone), false);
    assert.equal(Reflect.defineProperty(filter, "_blurX", { value: 255 }), false);
    assert.equal(Reflect.set(filter, "_quality", 15), false);
    assert.equal(Reflect.deleteProperty(filter, "_events"), false);
    assert.equal(Reflect.defineProperty(BlurFilter.prototype, "clone", { value: hostileClone }), false);
    assert.equal(trapCount, 0);
    assert.deepEqual([filter.blurX, filter.blurY, filter.quality], [7, 5, 2]);
    const matrixFilter = new ColorMatrixFilter();
    assert.equal(Reflect.set(matrixFilter, "_matrix", new Array(20).fill(99)), false);
    assert.equal(Reflect.defineProperty(matrixFilter, "_matrix", { value: [] }), false);
    assert.deepEqual(matrixFilter.matrix, FLASH_IDENTITY_COLOR_MATRIX);
    const glowFilter = new GlowFilter(0x123456, 0.5, 3, 4, 2, 1);
    assert.equal(Reflect.set(glowFilter, "_strength", 255), false);
    assert.equal(glowFilter.strength, 2);
    const shadowFilter = new DropShadowFilter(8, 30);
    assert.equal(Reflect.set(shadowFilter, "_distance", 999), false);
    assert.equal(shadowFilter.distance, 8);
    owner.filters = [filter];
    assert.deepEqual([(owner.filters[0] as BlurFilter).blurX, (owner.filters[0] as BlurFilter).quality], [7, 2]);
    assert.equal(trapCount, 0);
});

test("concrete filter constructors reject branded hostile subclasses before virtual dispatch", () => {
    let hostileCalls = 0;
    class HostileBlurFilter extends BlurFilter {
        override clone(): BlurFilter { hostileCalls++; return this; }
        override equals(_other: BitmapFilter | null): boolean { hostileCalls++; return true; }
        override getEffect(): ReturnType<BlurFilter["getEffect"]> { hostileCalls++; return super.getEffect(); }
    }
    class HostileColorMatrixFilter extends ColorMatrixFilter {}
    class HostileGlowFilter extends GlowFilter {}
    class HostileDropShadowFilter extends DropShadowFilter {}
    class HostileGradientBevelFilter extends GradientBevelFilter {}
    assert.throws(() => new HostileBlurFilter(), /not extensible/);
    assert.throws(() => new HostileColorMatrixFilter(), /not extensible/);
    assert.throws(() => new HostileGlowFilter(), /not extensible/);
    assert.throws(() => new HostileDropShadowFilter(), /not extensible/);
    assert.throws(() => new HostileGradientBevelFilter(), /not extensible/);
    assert.equal(hostileCalls, 0);
    for (const [value, prototype] of [
        [new BlurFilter(), BlurFilter.prototype],
        [new ColorMatrixFilter(), ColorMatrixFilter.prototype],
        [new GlowFilter(), GlowFilter.prototype],
        [new DropShadowFilter(), DropShadowFilter.prototype],
        [new GradientBevelFilter(), GradientBevelFilter.prototype],
    ] as const) {
        assert.equal(Object.getPrototypeOf(value), prototype);
        assert.equal(Object.isSealed(value), true);
        assert.equal(Object.isFrozen(prototype), true);
    }
});

test("native effects retain anisotropy, alpha, strength, quality, and full matrix rows", () => {
    const blur = new BlurFilter(9, 4, 3).getEffect();
    assert.ok(blur instanceof FlashBlurEffect2D);
    assert.deepEqual(blur.options, { blurX: 9, blurY: 4, quality: 3 });
    const glow = new GlowFilter(0x123456, 0.5, 8, 3, 2.25, 4, true, true).getEffect();
    assert.ok(glow instanceof FlashShadowEffect2D);
    assert.deepEqual({ ...glow.options, alpha: Math.round(glow.options.alpha * 255) }, {
        distance: 0, angleRadians: Math.PI / 4, color: 0x123456, alpha: 127,
        blurX: 8, blurY: 3, strength: 2.25, quality: 4, inner: true, knockout: true, hideObject: false,
    });
    const matrix = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const matrixEffect = new ColorMatrixFilter(matrix).getEffect();
    assert.ok(matrixEffect instanceof FlashColorMatrixEffect2D);
    assert.deepEqual(matrixEffect.matrix, matrix);
    assert.equal(matrixEffect.ownsOwnerAlpha, true, "alpha-offset matrices own local-alpha application exactly once");
});

test("A12 records distinct DisplayObject.filters getter and nullable setter types", () => {
    const ledger = JSON.parse(readFileSync(join(process.cwd(), "docTool/architecture/authored-content-capabilities.json"), "utf8"));
    const display = ledger.capabilities.flatMap((capability: any) => capability.obligations ?? [])
        .find((obligation: any) => obligation.export === "DisplayObject");
    const filters = display?.members?.find((member: any) => member.name === "filters" && member.scope === "instance");
    assert.equal(filters?.signature, "get BitmapFilter[]; set BitmapFilter[] | null");
});

test("ColorMatrixFilter rejects non-Array matrix lookalikes", () => {
    assert.throws(() => new ColorMatrixFilter({ length: 0 } as unknown as number[]), /must be an Array/);
    assert.throws(() => new ColorMatrixFilter(new Float32Array(20) as unknown as number[]), /must be an Array/);
    const filter = new ColorMatrixFilter();
    assert.throws(() => { filter.matrix = { length: 20 } as unknown as number[]; }, /must be an Array/);
});

test("renderer effective values contain public NaN and infinity without invalid shaders", () => {
    const publicBlur = new BlurFilter(Number.NaN, Number.NaN, 1);
    assert.ok(Number.isNaN(publicBlur.blurX) && Number.isNaN(publicBlur.blurY));
    const blurEffect = publicBlur.getEffect() as FlashBlurEffect2D;
    assert.deepEqual(blurEffect.options, { blurX: 0, blurY: 0, quality: 1 });

    const publicGlow = new GlowFilter(0xff0000, 1, Number.NaN, Number.NaN, 1, 1);
    assert.ok(Number.isNaN(publicGlow.blurX) && Number.isNaN(publicGlow.blurY));
    const glowEffect = publicGlow.getEffect() as FlashShadowEffect2D;
    assert.equal(glowEffect.options.blurX, 0);
    assert.equal(glowEffect.options.blurY, 0);

    const publicShadow = new DropShadowFilter(Number.POSITIVE_INFINITY, Number.NaN, 0, 1, Number.NaN, Number.NaN);
    assert.equal(publicShadow.distance, Number.POSITIVE_INFINITY);
    assert.ok(Number.isNaN(publicShadow.angle));
    const shadowEffect = publicShadow.getEffect() as FlashShadowEffect2D;
    assert.equal(shadowEffect.options.distance, 0);
    assert.equal(shadowEffect.options.angleRadians, 0);
    assert.equal(shadowEffect.options.blurX, 0);
    assert.equal(shadowEffect.options.blurY, 0);
});

test("CPU pixel oracle covers alpha cross-terms, offsets, premultiply inputs, and even kernels", () => {
    const matrix = [
        1, 0, 0, 0.5, 25.5,
        0, 1, 0, 0, 0,
        0, 0, 1, 0, 0,
        0.25, 0, 0, 0.5, 51,
    ];
    const result = applyFlashColorMatrixPixel({ r: 0.2, g: 0.4, b: 0.6, a: 0.5 }, matrix);
    assert.deepEqual(result, { r: 0.55, g: 0.4, b: 0.6, a: 0.5 });
    assert.deepEqual(flashBoxKernelOffsets(4), [-2, -1, 0, 1]);
    assert.deepEqual(flashBoxKernelOffsets(5), [-2, -1, 0, 1, 2]);
    assert.deepEqual(flashBoxKernelMargins(4, 1), { before: 1, after: 2 });
    assert.deepEqual(flashBoxKernelMargins(12, 3), { before: 15, after: 18 });
});
