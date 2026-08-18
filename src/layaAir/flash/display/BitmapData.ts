import { isFlashPoint, Point } from "../geom/Point";
import { isFlashRectangle, Rectangle } from "../geom/Rectangle";
import { BitmapDataChannel } from "./BitmapDataChannel";
import { FilterMode } from "../../laya/RenderEngine/RenderEnum/FilterMode";
import { TextureFormat } from "../../laya/RenderEngine/RenderEnum/TextureFormat";
import { WrapMode } from "../../laya/RenderEngine/RenderEnum/WrapMode";
import { LayaGL } from "../../laya/layagl/LayaGL";
import { Texture } from "../../laya/resource/Texture";
import { Texture2D } from "../../laya/resource/Texture2D";

type InvalidationListener = () => void;

interface BitmapDataState {
    width: number;
    height: number;
    transparent: boolean;
    pixels: Uint32Array | null;
    locked: boolean;
    lockedPixels: Uint32Array | null;
    dirty: boolean;
    publishedVersion: number;
    listeners: Set<InvalidationListener>;
    backings: Map<boolean, BitmapDataBacking>;
}

interface BitmapDataBacking {
    texture2D: Texture2D;
    texture: Texture;
    version: number;
}

const BITMAP_DATA_VALUES = new WeakMap<object, BitmapDataState>();
const BITMAP_DATA_BRANDS = new WeakSet<object>();
const MAX_BITMAP_DIMENSION = 8191;
const MAX_BITMAP_PIXELS = 16777215;

/** @internal Nominal guard for authenticated runtime `is` checks. */
export function isFlashBitmapData(value: unknown): value is BitmapData {
    return typeof value === "object" && value !== null && BITMAP_DATA_BRANDS.has(value);
}

function intValue(value: number): number { return Number(value) | 0; }
function uintValue(value: number): number { return Number(value) >>> 0; }
function booleanValue(value: boolean): boolean { return Boolean(value); }

const FLASH_PREMUL_FACTOR = new Uint32Array([
    0, 16678912, 8339456, 5559638, 4169728, 3335783, 2779819, 2386603, 2086230, 1855488,
    1667892, 1518251, 1391151, 1285234, 1193302, 1111928, 1043895, 981113, 927744, 879275,
    834621, 795535, 759126, 726358, 695839, 668183, 642538, 618737, 596651, 576171, 555964,
    538706, 522104, 506319, 490557, 477321, 464038, 451353, 439544, 428244, 417582, 407500,
    397768, 388535, 379630, 371117, 363179, 355235, 348050, 340965, 334052, 327038, 321269,
    315077, 309159, 303586, 298189, 293092, 287981, 283080, 278251, 273892, 269268, 265179,
    261087, 256971, 253160, 249322, 245508, 242164, 238575, 235245, 231859, 228848, 225785,
    222712, 219616, 216827, 213985, 211432, 208835, 206075, 203750, 201196, 198895, 196223,
    194301, 191987, 189686, 187636, 185559, 183426, 181453, 179444, 177638, 175855, 174054,
    171948, 170489, 168695, 166889, 165365, 163519, 162045, 160508, 158970, 157429, 156150,
    154610, 153081, 151803, 150511, 148986, 147709, 146420, 145116, 143868, 142586, 141545,
    140277, 139194, 137957, 136954, 135676, 134652, 133621, 132604, 131577, 130552, 129527,
    128508, 127476, 126451, 125432, 124670, 123645, 122818, 121847, 121082, 120060, 119288,
    118263, 117502, 116720, 115967, 115195, 114424, 113655, 112893, 112125, 111356, 110563,
    109811, 109048, 108287, 107766, 107004, 106236, 105724, 104953, 104434, 103676, 102904,
    102375, 101879, 101119, 100604, 99834, 99321, 98813, 98112, 97533, 97019, 96509, 95994,
    95486, 94713, 94185, 93689, 93179, 92667, 92149, 91643, 91129, 90621, 90068, 89597,
    89342, 88829, 88318, 87804, 87294, 87034, 86523, 85994, 85499, 85245, 84732, 84222,
    83956, 83450, 82937, 82685, 82173, 81840, 81405, 80889, 80638, 80127, 79862, 79354,
    79103, 78590, 78332, 78077, 77565, 77308, 76795, 76541, 76284, 75766, 75518, 75262,
    74748, 74493, 74238, 73691, 73470, 73214, 72959, 72447, 72189, 71935, 71671, 71166,
    70911, 70651, 70399, 70140, 69886, 69615, 69116, 68861, 68603, 68350, 68093, 67839,
    67576, 67326, 67070, 66813, 66556, 66302, 66046, 65791, 65408,
]);

function bitmapDataValue(value: BitmapData, parameter: string, usable = true): BitmapDataState {
    if (!isFlashBitmapData(value)) throw new TypeError(`${parameter} must be a BitmapData`);
    const state = BITMAP_DATA_VALUES.get(value)!;
    if (usable && state.pixels === null) throw new Error(`${parameter} has been disposed`);
    return state;
}

function rectangleValue(value: Rectangle, parameter: string): Rectangle {
    if (!isFlashRectangle(value)) throw new TypeError(`${parameter} must be a Rectangle`);
    return value;
}

function pointValue(value: Point, parameter: string): Point {
    if (!isFlashPoint(value)) throw new TypeError(`${parameter} must be a Point`);
    return value;
}

function premultiplyPixel(value: number, transparent: boolean): number {
    const pixel = uintValue(value);
    const alpha = transparent ? pixel >>> 24 : 255;
    const multiply = (shift: number): number => Math.floor((((pixel >>> shift) & 0xff) * alpha + 127) / 255);
    return ((alpha << 24) | (multiply(16) << 16) | (multiply(8) << 8) | multiply(0)) >>> 0;
}

function unpremultiplyPixel(pixel: number): number {
    const alpha = pixel >>> 24;
    const factor = FLASH_PREMUL_FACTOR[alpha];
    const unmultiply = (shift: number): number => ((((pixel >>> shift) & 0xff) * factor + 0x8000) >>> 16) & 0xff;
    return ((alpha << 24) | (unmultiply(16) << 16) | (unmultiply(8) << 8) | unmultiply(0)) >>> 0;
}

function markDirty(state: BitmapDataState): void {
    state.dirty = true;
    if (!state.locked) flushInvalidation(state);
}

function flushInvalidation(state: BitmapDataState): void {
    if (!state.dirty) return;
    state.dirty = false;
    state.publishedVersion++;
    for (const listener of [...state.listeners]) listener();
}

function premultipliedRgba(state: BitmapDataState): Uint8Array {
    const pixels = state.lockedPixels ?? state.pixels!;
    const rgba = new Uint8Array(pixels.length * 4);
    for (let index = 0; index < pixels.length; index++) {
        const pixel = pixels[index];
        const offset = index * 4;
        rgba[offset] = pixel >>> 16 & 0xff;
        rgba[offset + 1] = pixel >>> 8 & 0xff;
        rgba[offset + 2] = pixel & 0xff;
        rgba[offset + 3] = pixel >>> 24;
    }
    return rgba;
}

function destroyBackings(state: BitmapDataState): void {
    for (const backing of state.backings.values()) {
        backing.texture.destroy();
        backing.texture2D.destroy();
    }
    state.backings.clear();
}

function roundEven(value: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    const floor = Math.floor(numeric);
    const fraction = numeric - floor;
    if (fraction < 0.5) return floor;
    if (fraction > 0.5) return floor + 1;
    return floor % 2 === 0 ? floor : floor + 1;
}

function clippedRange(rect: Rectangle, width: number, height: number): [number, number, number, number] {
    const x0 = Math.max(0, roundEven(rect.x));
    const y0 = Math.max(0, roundEven(rect.y));
    const x1 = Math.min(width, roundEven(rect.x + rect.width));
    const y1 = Math.min(height, roundEven(rect.y + rect.height));
    return [x0, y0, Math.max(x0, x1), Math.max(y0, y1)];
}

function channelShift(channel: number): number | null {
    switch (uintValue(channel)) {
        case BitmapDataChannel.RED: return 16;
        case BitmapDataChannel.GREEN: return 8;
        case BitmapDataChannel.BLUE: return 0;
        case BitmapDataChannel.ALPHA: return 24;
        default: return null;
    }
}

function composite(source: number, destination: number): number {
    const sourceAlpha = source >>> 24;
    const blend = (shift: number): number =>
        ((source >>> shift) & 0xff) + Math.floor(((destination >>> shift) & 0xff) * (255 - sourceAlpha) / 255);
    return ((blend(24) << 24) | (blend(16) << 16) | (blend(8) << 8) | blend(0)) >>> 0;
}

/**
 * CPU-backed source-visible `flash.display.BitmapData`.
 *
 * The authoritative pixels are Flash-premultiplied ARGB values. Native textures
 * are owned by this BitmapData in point/bilinear sampling variants and are
 * published only after an unlocked mutation, so shared Bitmaps can preserve
 * independent smoothing without duplicating a variant per view.
 */
export class BitmapData {
    constructor(width: number, height: number, transparent?: boolean, fillColor?: number) {
        const bitmapWidth = intValue(width);
        const bitmapHeight = intValue(height);
        if (bitmapWidth <= 0 || bitmapHeight <= 0 || bitmapWidth > MAX_BITMAP_DIMENSION ||
            bitmapHeight > MAX_BITMAP_DIMENSION || bitmapWidth * bitmapHeight > MAX_BITMAP_PIXELS)
            throw new RangeError("BitmapData dimensions exceed the Flash allocation limit");
        const state: BitmapDataState = {
            width: bitmapWidth,
            height: bitmapHeight,
            transparent: arguments.length < 3 ? true : booleanValue(transparent!),
            pixels: new Uint32Array(bitmapWidth * bitmapHeight),
            locked: false,
            lockedPixels: null,
            dirty: false,
            publishedVersion: 1,
            listeners: new Set(),
            backings: new Map(),
        };
        BITMAP_DATA_BRANDS.add(this);
        BITMAP_DATA_VALUES.set(this, state);
        const initialColor = arguments.length < 4 ? 0xffffffff : fillColor!;
        state.pixels.fill(premultiplyPixel(initialColor, state.transparent));
    }

    get width(): number { return bitmapDataValue(this, "BitmapData").width; }
    get height(): number { return bitmapDataValue(this, "BitmapData").height; }
    get transparent(): boolean { return bitmapDataValue(this, "BitmapData").transparent; }
    get rect(): Rectangle {
        const state = bitmapDataValue(this, "BitmapData");
        return new Rectangle(0, 0, state.width, state.height);
    }

    clone(): BitmapData {
        const state = bitmapDataValue(this, "BitmapData");
        const clone = new BitmapData(state.width, state.height, state.transparent, 0);
        BITMAP_DATA_VALUES.get(clone)!.pixels!.set(state.pixels!);
        return clone;
    }

    dispose(): void {
        const state = bitmapDataValue(this, "BitmapData", false);
        if (state.pixels === null) return;
        state.pixels = null;
        state.width = 0;
        state.height = 0;
        state.locked = false;
        state.lockedPixels = null;
        state.dirty = true;
        flushInvalidation(state);
        destroyBackings(state);
    }

    lock(): void {
        const state = bitmapDataValue(this, "BitmapData");
        if (!state.locked) state.lockedPixels = state.pixels!.slice();
        state.locked = true;
    }

    unlock(changeRect: Rectangle | null = null): void {
        const state = bitmapDataValue(this, "BitmapData");
        if (changeRect !== null) rectangleValue(changeRect, "changeRect");
        state.locked = false;
        state.lockedPixels = null;
        flushInvalidation(state);
    }

    getPixel(x: number, y: number): number {
        return this.getPixel32(x, y) & 0x00ffffff;
    }

    getPixel32(x: number, y: number): number {
        const state = bitmapDataValue(this, "BitmapData");
        const pixelX = intValue(x);
        const pixelY = intValue(y);
        if (pixelX < 0 || pixelY < 0 || pixelX >= state.width || pixelY >= state.height) return 0;
        const pixel = state.pixels![pixelY * state.width + pixelX] >>> 0;
        return state.transparent ? unpremultiplyPixel(pixel) : pixel;
    }

    setPixel(x: number, y: number, color: number): void {
        const state = bitmapDataValue(this, "BitmapData");
        const pixelX = intValue(x);
        const pixelY = intValue(y);
        if (pixelX < 0 || pixelY < 0 || pixelX >= state.width || pixelY >= state.height) return;
        const index = pixelY * state.width + pixelX;
        const alpha = state.transparent ? state.pixels![index] >>> 24 : 255;
        state.pixels![index] = premultiplyPixel(((alpha << 24) | (uintValue(color) & 0x00ffffff)) >>> 0, true);
        markDirty(state);
    }

    setPixel32(x: number, y: number, color: number): void {
        const state = bitmapDataValue(this, "BitmapData");
        const pixelX = intValue(x);
        const pixelY = intValue(y);
        if (pixelX < 0 || pixelY < 0 || pixelX >= state.width || pixelY >= state.height) return;
        state.pixels![pixelY * state.width + pixelX] = premultiplyPixel(color, state.transparent);
        markDirty(state);
    }

    fillRect(rect: Rectangle, color: number): void {
        const state = bitmapDataValue(this, "BitmapData");
        const target = rectangleValue(rect, "rect");
        const [x0, y0, x1, y1] = clippedRange(target, state.width, state.height);
        if (x1 <= x0 || y1 <= y0) return;
        const pixel = premultiplyPixel(color, state.transparent);
        for (let y = y0; y < y1; y++) state.pixels!.fill(pixel, y * state.width + x0, y * state.width + x1);
        markDirty(state);
    }

    copyChannel(sourceBitmapData: BitmapData, sourceRect: Rectangle, destPoint: Point,
        sourceChannel: number, destChannel: number): void {
        const destination = bitmapDataValue(this, "BitmapData");
        const source = bitmapDataValue(sourceBitmapData, "sourceBitmapData");
        const rect = rectangleValue(sourceRect, "sourceRect");
        const point = pointValue(destPoint, "destPoint");
        const sourceShift = channelShift(sourceChannel);
        const destinationShift = channelShift(destChannel);
        if (destinationShift === null) return;
        const sourcePixels = sourceBitmapData === this ? source.pixels!.slice() : source.pixels!;
        const sourceX = roundEven(rect.x);
        const sourceY = roundEven(rect.y);
        const destinationX = intValue(point.x);
        const destinationY = intValue(point.y);
        const width = Math.max(0, roundEven(rect.x + rect.width) - sourceX);
        const height = Math.max(0, roundEven(rect.y + rect.height) - sourceY);
        let changed = false;
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
            const sx = sourceX + column, sy = sourceY + row;
            const dx = destinationX + column, dy = destinationY + row;
            if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height ||
                dx < 0 || dy < 0 || dx >= destination.width || dy >= destination.height) continue;
            const sourcePublic = unpremultiplyPixel(sourcePixels[sy * source.width + sx]);
            const sourceValue = sourceShift === null ? 0 : (sourcePublic >>> sourceShift) & 0xff;
            const destinationIndex = dy * destination.width + dx;
            const channelMask = (0xff << destinationShift) >>> 0;
            const destinationPublic = unpremultiplyPixel(destination.pixels![destinationIndex]);
            const pixel = ((destinationPublic & ~channelMask) | (sourceValue << destinationShift)) >>> 0;
            destination.pixels![destinationIndex] = premultiplyPixel(pixel, destination.transparent);
            changed = true;
        }
        if (changed) markDirty(destination);
    }

    copyPixels(sourceBitmapData: BitmapData, sourceRect: Rectangle, destPoint: Point,
        alphaBitmapData: BitmapData | null = null, alphaPoint: Point | null = null, mergeAlpha = false): void {
        const destination = bitmapDataValue(this, "BitmapData");
        const source = bitmapDataValue(sourceBitmapData, "sourceBitmapData");
        const rect = rectangleValue(sourceRect, "sourceRect");
        const point = pointValue(destPoint, "destPoint");
        const alpha = alphaBitmapData === null ? null : bitmapDataValue(alphaBitmapData, "alphaBitmapData");
        const alphaOrigin = alphaPoint === null ? new Point(0, 0) : pointValue(alphaPoint, "alphaPoint");
        const sourcePixels = sourceBitmapData === this ? source.pixels!.slice() : source.pixels!;
        const alphaPixels = alphaBitmapData === this ? destination.pixels!.slice() : alpha?.pixels;
        const sourceX = roundEven(rect.x), sourceY = roundEven(rect.y);
        const destinationX = intValue(point.x), destinationY = intValue(point.y);
        const alphaX = intValue(alphaOrigin.x), alphaY = intValue(alphaOrigin.y);
        const width = Math.max(0, roundEven(rect.x + rect.width) - sourceX);
        const height = Math.max(0, roundEven(rect.y + rect.height) - sourceY);
        let changed = false;
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
            const sx = sourceX + column, sy = sourceY + row;
            const dx = destinationX + column, dy = destinationY + row;
            if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height ||
                dx < 0 || dy < 0 || dx >= destination.width || dy >= destination.height) continue;
            let sourcePixel = sourcePixels[sy * source.width + sx] >>> 0;
            if (alpha) {
                const ax = alphaX + column, ay = alphaY + row;
                if (ax < 0 || ay < 0 || ax >= alpha.width || ay >= alpha.height) continue;
                const sameAlphaSource = alphaBitmapData === sourceBitmapData &&
                    alphaX === sourceX && alphaY === sourceY;
                if (!sameAlphaSource) {
                    const sourcePublic = unpremultiplyPixel(sourcePixel);
                    const effectiveAlpha = alpha.transparent
                        ? (source.transparent
                            ? ((sourcePixel >>> 24) * (alphaPixels![ay * alpha.width + ax] >>> 24)) >> 8
                            : alphaPixels![ay * alpha.width + ax] >>> 24)
                        : (source.transparent ? sourcePixel >>> 24 : 255);
                    sourcePixel = premultiplyPixel(((effectiveAlpha << 24) | (sourcePublic & 0x00ffffff)) >>> 0, true);
                }
            }
            const destinationIndex = dy * destination.width + dx;
            const shouldBlend = booleanValue(mergeAlpha) ||
                (alpha ? !destination.transparent : source.transparent && !destination.transparent);
            let output = shouldBlend ? composite(sourcePixel, destination.pixels![destinationIndex]) : sourcePixel;
            if (!destination.transparent) output = (output | 0xff000000) >>> 0;
            destination.pixels![destinationIndex] = output;
            changed = true;
        }
        if (changed) markDirty(destination);
    }

    getColorBoundsRect(mask: number, color: number, findColor?: boolean): Rectangle {
        const state = bitmapDataValue(this, "BitmapData");
        // Adobe Player fixture: ruffle avm1/bitmap_data_thorough/getColorBoundsRect.
        // Player compares premultiplied storage, including its opaque-mask quirk.
        let masked = uintValue(mask);
        if (!state.transparent) masked = (masked | 0xff000000) >>> 0;
        const expected = premultiplyPixel(color, state.transparent);
        const find = arguments.length < 3 ? true : booleanValue(findColor!);
        let minX = state.width, minY = state.height, maxX = -1, maxY = -1;
        for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
            const matches = ((state.pixels![y * state.width + x] & masked) >>> 0) === expected;
            if (matches !== find) continue;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        return maxX < minX || (maxX === 0 && maxY === 0)
            ? new Rectangle()
            : new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    threshold(sourceBitmapData: BitmapData, sourceRect: Rectangle, destPoint: Point, operation: string,
        threshold: number, color?: number, mask?: number, copySource?: boolean): number {
        const destination = bitmapDataValue(this, "BitmapData");
        const source = bitmapDataValue(sourceBitmapData, "sourceBitmapData");
        const rect = rectangleValue(sourceRect, "sourceRect");
        const point = pointValue(destPoint, "destPoint");
        const compare = ({
            "<": (a: number, b: number) => a < b,
            "<=": (a: number, b: number) => a <= b,
            ">": (a: number, b: number) => a > b,
            ">=": (a: number, b: number) => a >= b,
            "==": (a: number, b: number) => a === b,
            "!=": (a: number, b: number) => a !== b,
        } as Record<string, (a: number, b: number) => boolean>)[String(operation)];
        if (!compare) throw new TypeError("operation must be one of <, <=, >, >=, ==, !=");
        const sourcePixels = sourceBitmapData === this ? source.pixels!.slice() : source.pixels!;
        const sourceX = roundEven(rect.x), sourceY = roundEven(rect.y);
        const destinationX = intValue(point.x), destinationY = intValue(point.y);
        const width = Math.max(0, roundEven(rect.x + rect.width) - sourceX);
        const height = Math.max(0, roundEven(rect.y + rect.height) - sourceY);
        const maskValue = arguments.length < 7 ? 0xffffffff : uintValue(mask!);
        const maskedThreshold = (uintValue(threshold) & maskValue) >>> 0;
        const replacement = premultiplyPixel(arguments.length < 6 ? 0 : color!, true);
        const shouldCopy = arguments.length < 8 ? false : booleanValue(copySource!);
        let matches = 0, changed = false;
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
            const sx = sourceX + column, sy = sourceY + row;
            const dx = destinationX + column, dy = destinationY + row;
            if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height ||
                dx < 0 || dy < 0 || dx >= destination.width || dy >= destination.height) continue;
            const sourcePixel = sourcePixels[sy * source.width + sx] >>> 0;
            const passed = compare((sourcePixel & maskValue) >>> 0, maskedThreshold);
            if (passed) matches++;
            if (!passed && !shouldCopy) continue;
            // Adobe Player fixture: ruffle avm1/bitmap_data_thorough/threshold.
            // Even an opaque destination receives the raw PMA alpha here.
            destination.pixels![dy * destination.width + dx] = passed ? replacement : sourcePixel;
            changed = true;
        }
        if (changed) markDirty(destination);
        return matches >>> 0;
    }
}

/** @internal Observe unlocked pixel changes without exposing mutable storage. */
export function observeBitmapData(value: BitmapData, listener: InvalidationListener): () => void {
    const state = bitmapDataValue(value, "bitmapData", false);
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
}

/** @internal Resolve a shared native sampling variant for a Bitmap view. */
export function acquireBitmapDataTexture(value: BitmapData, smoothing: boolean): Texture | null {
    const state = bitmapDataValue(value, "bitmapData", false);
    if (state.pixels === null || !LayaGL.textureContext) return null;
    const key = Boolean(smoothing);
    let backing = state.backings.get(key);
    if (!backing || backing.texture2D.destroyed || backing.texture.destroyed) {
        const texture2D = new Texture2D(state.width, state.height, TextureFormat.R8G8B8A8,
            false, false, true, true);
        texture2D.unmanaged();
        texture2D.filterMode = key ? FilterMode.Bilinear : FilterMode.Point;
        texture2D.wrapModeU = WrapMode.Clamp;
        texture2D.wrapModeV = WrapMode.Clamp;
        backing = { texture2D, texture: new Texture(texture2D), version: 0 };
        state.backings.set(key, backing);
    }
    if (backing.version !== state.publishedVersion) {
        backing.texture2D.setPixelsData(premultipliedRgba(state), false, false);
        backing.version = state.publishedVersion;
    }
    return backing.texture;
}
