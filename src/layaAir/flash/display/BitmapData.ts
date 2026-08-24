import { isFlashPoint, Point } from "../geom/Point";
import { isFlashColorTransform, ColorTransform } from "../geom/ColorTransform";
import { isFlashMatrix, Matrix } from "../geom/Matrix";
import { isFlashRectangle, Rectangle } from "../geom/Rectangle";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { isFlashDisplayObject } from "./DisplayObject";
import { flashGraphicsRasterCommands, sampleFlashGraphicsFill } from "./Graphics";
import type { IBitmapDrawable } from "./IBitmapDrawable";
import { BitmapDataChannel } from "./BitmapDataChannel";
import { FilterMode } from "../../laya/RenderEngine/RenderEnum/FilterMode";
import { TextureFormat } from "../../laya/RenderEngine/RenderEnum/TextureFormat";
import { WrapMode } from "../../laya/RenderEngine/RenderEnum/WrapMode";
import { LayaGL } from "../../laya/layagl/LayaGL";
import { Texture } from "../../laya/resource/Texture";
import { Texture2D } from "../../laya/resource/Texture2D";
import { BitmapFilter } from "../filters/BitmapFilter";
import { isBlurFilter } from "../filters/BlurFilter";
import { isColorMatrixFilter } from "../filters/ColorMatrixFilter";
import { isDropShadowFilter } from "../filters/DropShadowFilter";
import { isGlowFilter } from "../filters/GlowFilter";
import { isGradientBevelFilter } from "../filters/GradientBevelFilter";
import { ConcreteBitmapFilter, isBitmapFilter } from "../filters/FilterRegistry";

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

function setVectorCoordinate(value: number, minimum: number, maximum: number): number {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return 0;
    return Math.trunc(Math.min(maximum, Math.max(minimum, numeric)));
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

interface FilterMargins { left: number; top: number; right: number; bottom: number; }
interface FilterRaster {
    pixels: Uint32Array;
    width: number;
    height: number;
    writeX: number;
    writeY: number;
    writeWidth: number;
    writeHeight: number;
    destinationX: number;
    destinationY: number;
}

const EMPTY_FILTER_MARGINS: Readonly<FilterMargins> = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

function blurMargin(value: number, quality: number): number {
    if (!Number.isFinite(value) || value <= 1 || quality <= 0) return 0;
    return Math.ceil((value - 1) * quality / 2);
}

function blurMargins(blurX: number, blurY: number, quality: number): FilterMargins {
    const x = blurMargin(blurX, quality), y = blurMargin(blurY, quality);
    return { left: x, top: y, right: x, bottom: y };
}

function addFilterOffset(margins: FilterMargins, dx: number, dy: number): void {
    const epsilon = 1e-6;
    if (dx > epsilon) margins.right += Math.ceil(dx - epsilon);
    else if (dx < -epsilon) margins.left += Math.ceil(-dx - epsilon);
    if (dy > epsilon) margins.bottom += Math.ceil(dy - epsilon);
    else if (dy < -epsilon) margins.top += Math.ceil(-dy - epsilon);
}

function filterMargins(filter: ConcreteBitmapFilter): FilterMargins {
    if (isBlurFilter(filter)) return blurMargins(filter.blurX, filter.blurY, filter.quality);
    if (isColorMatrixFilter(filter)) return { ...EMPTY_FILTER_MARGINS };
    if (isGlowFilter(filter)) return filter.inner
        ? { ...EMPTY_FILTER_MARGINS }
        : blurMargins(filter.blurX, filter.blurY, filter.quality);
    if (isDropShadowFilter(filter)) {
        if (filter.inner) return { ...EMPTY_FILTER_MARGINS };
        const margins = blurMargins(filter.blurX, filter.blurY, filter.quality);
        const radians = filter.angle * Math.PI / 180;
        addFilterOffset(margins, filter.distance * Math.cos(radians), filter.distance * Math.sin(radians));
        return margins;
    }
    const margins = blurMargins(filter.blurX, filter.blurY, filter.quality);
    const radians = filter.angle * Math.PI / 180;
    const dx = filter.distance * Math.cos(radians), dy = filter.distance * Math.sin(radians);
    addFilterOffset(margins, dx, dy);
    addFilterOffset(margins, -dx, -dy);
    return margins;
}

function sourceRectangle(rect: Rectangle): { x: number; y: number; width: number; height: number } {
    const finite = (value: number): number => Number.isFinite(Number(value)) ? Number(value) : 0;
    return {
        x: Math.floor(finite(rect.x)),
        y: Math.floor(finite(rect.y)),
        width: Math.max(0, Math.ceil(finite(rect.width))),
        height: Math.max(0, Math.ceil(finite(rect.height))),
    };
}

function packChannels(red: number, green: number, blue: number, alpha: number): number {
    const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
    return ((byte(alpha) << 24) | (byte(red) << 16) | (byte(green) << 8) | byte(blue)) >>> 0;
}

function boxBlurAxis(input: Uint32Array, width: number, height: number, taps: number, horizontal: boolean): Uint32Array {
    if (taps <= 1) return input.slice();
    const output = new Uint32Array(input.length);
    const first = -Math.floor(taps / 2), last = first + taps - 1;
    const lines = horizontal ? height : width, length = horizontal ? width : height;
    const index = (line: number, position: number): number => horizontal
        ? line * width + position
        : position * width + line;
    for (let line = 0; line < lines; line++) {
        let red = 0, green = 0, blue = 0, alpha = 0;
        for (let sample = first; sample <= last; sample++) if (sample >= 0 && sample < length) {
            const pixel = input[index(line, sample)];
            alpha += pixel >>> 24; red += pixel >>> 16 & 0xff;
            green += pixel >>> 8 & 0xff; blue += pixel & 0xff;
        }
        for (let position = 0; position < length; position++) {
            output[index(line, position)] = packChannels(red / taps, green / taps, blue / taps, alpha / taps);
            const removed = position + first;
            if (removed >= 0 && removed < length) {
                const pixel = input[index(line, removed)];
                alpha -= pixel >>> 24; red -= pixel >>> 16 & 0xff;
                green -= pixel >>> 8 & 0xff; blue -= pixel & 0xff;
            }
            const added = position + last + 1;
            if (added >= 0 && added < length) {
                const pixel = input[index(line, added)];
                alpha += pixel >>> 24; red += pixel >>> 16 & 0xff;
                green += pixel >>> 8 & 0xff; blue += pixel & 0xff;
            }
        }
    }
    return output;
}

function boxBlur(input: Uint32Array, width: number, height: number,
    blurX: number, blurY: number, quality: number): Uint32Array {
    let output = input.slice();
    const horizontalTaps = Math.max(1, Math.round(Number.isFinite(blurX) ? blurX : 0));
    const verticalTaps = Math.max(1, Math.round(Number.isFinite(blurY) ? blurY : 0));
    for (let pass = 0; pass < quality; pass++) {
        output = boxBlurAxis(output, width, height, horizontalTaps, true);
        output = boxBlurAxis(output, width, height, verticalTaps, false);
    }
    return output;
}

function sampleAlpha(pixels: Uint32Array, width: number, height: number, x: number, y: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y), amountX = x - x0, amountY = y - y0;
    const channel = (sampleX: number, sampleY: number): number =>
        sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height
            ? 0 : pixels[sampleY * width + sampleX] >>> 24;
    const top = channel(x0, y0) * (1 - amountX) + channel(x0 + 1, y0) * amountX;
    const bottom = channel(x0, y0 + 1) * (1 - amountX) + channel(x0 + 1, y0 + 1) * amountX;
    return (top * (1 - amountY) + bottom * amountY) / 255;
}

function multiplyPremultiplied(pixel: number, factor: number): number {
    return packChannels((pixel >>> 16 & 0xff) * factor, (pixel >>> 8 & 0xff) * factor,
        (pixel & 0xff) * factor, (pixel >>> 24) * factor);
}

function addPremultiplied(source: number, destination: number, destinationFactor: number): number {
    return packChannels(
        (source >>> 16 & 0xff) + (destination >>> 16 & 0xff) * destinationFactor,
        (source >>> 8 & 0xff) + (destination >>> 8 & 0xff) * destinationFactor,
        (source & 0xff) + (destination & 0xff) * destinationFactor,
        (source >>> 24) + (destination >>> 24) * destinationFactor,
    );
}

function applyShadowRaster(original: Uint32Array, width: number, height: number,
    filter: import("../filters/DropShadowFilter").DropShadowFilter | import("../filters/GlowFilter").GlowFilter): Uint32Array {
    const isGlow = isGlowFilter(filter);
    const radians = isGlow ? 0 : filter.angle * Math.PI / 180;
    const distance = isGlow ? 0 : filter.distance;
    const offsetX = distance * Math.cos(radians), offsetY = distance * Math.sin(radians);
    const seed = new Uint32Array(original.length);
    const colorRed = filter.color >>> 16 & 0xff, colorGreen = filter.color >>> 8 & 0xff, colorBlue = filter.color & 0xff;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let alpha = sampleAlpha(original, width, height, x - offsetX, y - offsetY);
        if (filter.inner) alpha = 1 - alpha;
        alpha *= filter.alpha;
        seed[y * width + x] = packChannels(colorRed * alpha, colorGreen * alpha, colorBlue * alpha, 255 * alpha);
    }
    const field = boxBlur(seed, width, height, filter.blurX, filter.blurY, filter.quality);
    const output = new Uint32Array(original.length);
    for (let index = 0; index < output.length; index++) {
        const source = original[index], sourceAlpha = (source >>> 24) / 255;
        const shadow = packChannels(
            Math.min(255, (field[index] >>> 16 & 0xff) * filter.strength),
            Math.min(255, (field[index] >>> 8 & 0xff) * filter.strength),
            Math.min(255, (field[index] & 0xff) * filter.strength),
            Math.min(255, (field[index] >>> 24) * filter.strength),
        );
        const shadowAlpha = (shadow >>> 24) / 255;
        if (filter.inner) output[index] = filter.knockout || (!isGlow && filter.hideObject)
            ? multiplyPremultiplied(shadow, sourceAlpha)
            : addPremultiplied(multiplyPremultiplied(shadow, sourceAlpha), source, 1 - shadowAlpha);
        else if (filter.knockout) output[index] = multiplyPremultiplied(shadow, 1 - sourceAlpha);
        else output[index] = !isGlow && filter.hideObject
            ? shadow
            : addPremultiplied(source, shadow, 1 - sourceAlpha);
    }
    return output;
}

function normalizedGradient(filter: import("../filters/GradientBevelFilter").GradientBevelFilter):
    ReadonlyArray<{ color: number; alpha: number; ratio: number }> {
    const colors = filter.colors, alphas = filter.alphas, ratios = filter.ratios;
    if (!colors || !alphas || !ratios) return [{ color: 0, alpha: 0, ratio: 0 }];
    const count = Math.min(15, colors.length, alphas.length, ratios.length);
    if (count === 0) return [{ color: 0, alpha: 0, ratio: 0 }];
    return Array.from({ length: count }, (_, index) => ({
        color: colors[index] >>> 0 & 0xffffff,
        alpha: Math.max(0, Math.min(1, Number.isFinite(alphas[index]) ? alphas[index] : 0)),
        ratio: Math.max(0, Math.min(255, Number.isFinite(ratios[index]) ? ratios[index] : 0)) / 255,
        index,
    })).sort((left, right) => left.ratio - right.ratio || left.index - right.index);
}

function gradientPixel(stops: ReadonlyArray<{ color: number; alpha: number; ratio: number }>, position: number): number {
    let previous = stops[0];
    if (position <= previous.ratio) return premultiplyPixel(((Math.round(previous.alpha * 255) << 24) | previous.color) >>> 0, true);
    for (let index = 1; index < stops.length; index++) {
        const next = stops[index];
        if (position <= next.ratio) {
            const span = next.ratio - previous.ratio;
            const amount = span <= 0 ? 1 : Math.max(0, Math.min(1, (position - previous.ratio) / span));
            const channel = (shift: number): number => ((previous.color >>> shift) & 0xff) * (1 - amount)
                + ((next.color >>> shift) & 0xff) * amount;
            const alpha = previous.alpha * (1 - amount) + next.alpha * amount;
            return premultiplyPixel(packChannels(channel(16), channel(8), channel(0), alpha * 255), true);
        }
        previous = next;
    }
    return premultiplyPixel(((Math.round(previous.alpha * 255) << 24) | previous.color) >>> 0, true);
}

function applyGradientBevelRaster(original: Uint32Array, width: number, height: number,
    filter: import("../filters/GradientBevelFilter").GradientBevelFilter): Uint32Array {
    const radians = filter.angle * Math.PI / 180;
    const offsetX = filter.distance * Math.cos(radians), offsetY = filter.distance * Math.sin(radians);
    const seed = new Uint32Array(original.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const center = (original[y * width + x] >>> 24) / 255;
        const positive = sampleAlpha(original, width, height, x - offsetX, y - offsetY);
        const negative = sampleAlpha(original, width, height, x + offsetX, y + offsetY);
        const highlightInnerBase = Math.min(1, (1 - positive) * filter.strength) * center;
        const shadowInnerBase = Math.min(1, (1 - negative) * filter.strength) * center;
        const highlightInner = highlightInnerBase * (1 - shadowInnerBase);
        const shadowInner = shadowInnerBase * (1 - highlightInnerBase);
        const highlightOuterBase = Math.min(1, negative * filter.strength) * (1 - center);
        const shadowOuterBase = Math.min(1, positive * filter.strength) * (1 - center);
        const highlightOuter = highlightOuterBase * (1 - shadowOuterBase);
        const shadowOuter = shadowOuterBase * (1 - highlightOuterBase);
        const highlight = highlightInner + highlightOuter * (1 - highlightInner);
        const shadow = shadowInner + shadowOuter * (1 - shadowInner);
        seed[y * width + x] = packChannels(highlight * 255, 0, shadow * (1 - highlight) * 255, 255);
    }
    const field = boxBlur(seed, width, height, filter.blurX, filter.blurY, filter.quality);
    const stops = normalizedGradient(filter), output = new Uint32Array(original.length);
    for (let index = 0; index < output.length; index++) {
        const source = original[index], sourceAlpha = (source >>> 24) / 255;
        const signedLevel = Math.max(-1, Math.min(1,
            ((field[index] >>> 16 & 0xff) - (field[index] & 0xff)) / 255 * filter.strength));
        const bevel = gradientPixel(stops, (255 + signedLevel * 255) / 511);
        const bevelAlpha = (bevel >>> 24) / 255;
        if (filter.type === "inner") output[index] = filter.knockout
            ? multiplyPremultiplied(bevel, sourceAlpha)
            : addPremultiplied(multiplyPremultiplied(bevel, sourceAlpha), source, 1 - bevelAlpha);
        else if (filter.type === "outer") output[index] = filter.knockout
            ? multiplyPremultiplied(bevel, 1 - sourceAlpha)
            : addPremultiplied(source, bevel, 1 - sourceAlpha);
        else output[index] = filter.knockout ? bevel : addPremultiplied(bevel, source, 1 - bevelAlpha);
    }
    return output;
}

function applyColorMatrixRaster(original: Uint32Array, matrix: readonly number[]): Uint32Array {
    const output = new Uint32Array(original.length);
    const clamp = (value: number): number => Math.max(0, Math.min(255, value));
    for (let index = 0; index < original.length; index++) {
        const pixel = unpremultiplyPixel(original[index]);
        const input = [pixel >>> 16 & 0xff, pixel >>> 8 & 0xff, pixel & 0xff, pixel >>> 24];
        const channel = (row: number): number => clamp(matrix[row * 5] * input[0] + matrix[row * 5 + 1] * input[1]
            + matrix[row * 5 + 2] * input[2] + matrix[row * 5 + 3] * input[3] + matrix[row * 5 + 4]);
        output[index] = premultiplyPixel(packChannels(channel(0), channel(1), channel(2), channel(3)), true);
    }
    return output;
}

function filterRaster(source: BitmapDataState, rect: { x: number; y: number; width: number; height: number },
    destinationX: number, destinationY: number, filter: ConcreteBitmapFilter, destinationTransparent: boolean): FilterRaster {
    const margins = filterMargins(filter);
    const sampleRing = isBlurFilter(filter) ? margins : EMPTY_FILTER_MARGINS;
    const pad = {
        left: margins.left + sampleRing.left, top: margins.top + sampleRing.top,
        right: margins.right + sampleRing.right, bottom: margins.bottom + sampleRing.bottom,
    };
    const width = rect.width + pad.left + pad.right, height = rect.height + pad.top + pad.bottom;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_BITMAP_PIXELS)
        throw new RangeError("BitmapData filter temporary exceeds the Flash allocation limit");
    const original = new Uint32Array(width * height);
    const grow = isBlurFilter(filter) ? pad : EMPTY_FILTER_MARGINS;
    const copyX0 = Math.max(0, rect.x - grow.left), copyY0 = Math.max(0, rect.y - grow.top);
    const copyX1 = Math.min(source.width, rect.x + rect.width + grow.right);
    const copyY1 = Math.min(source.height, rect.y + rect.height + grow.bottom);
    const originX = rect.x - pad.left, originY = rect.y - pad.top;
    for (let y = copyY0; y < copyY1; y++) for (let x = copyX0; x < copyX1; x++) {
        let pixel = source.pixels![y * source.width + x];
        if (!destinationTransparent && isBlurFilter(filter))
            pixel = premultiplyPixel(unpremultiplyPixel(pixel) | 0xff000000, false);
        original[(y - originY) * width + x - originX] = pixel;
    }
    let pixels: Uint32Array;
    if (isBlurFilter(filter)) pixels = boxBlur(original, width, height, filter.blurX, filter.blurY, filter.quality);
    else if (isColorMatrixFilter(filter)) pixels = applyColorMatrixRaster(original, filter.matrix);
    else if (isGradientBevelFilter(filter)) pixels = applyGradientBevelRaster(original, width, height, filter);
    else pixels = applyShadowRaster(original, width, height, filter);
    return {
        pixels, width, height,
        writeX: sampleRing.left, writeY: sampleRing.top,
        writeWidth: rect.width + margins.left + margins.right,
        writeHeight: rect.height + margins.top + margins.bottom,
        destinationX: destinationX - margins.left,
        destinationY: destinationY - margins.top,
    };
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

    /**
     * Replaces a rectangular run of pixels with unpremultiplied 32-bit ARGB
     * values, matching Flash's `BitmapData.setVector` contract. The target
     * rectangle is clipped before the required vector length is calculated;
     * an undersized vector fails atomically.
     */
    setVector(rect: Rectangle, inputVector: ArrayLike<number>): void {
        const state = bitmapDataValue(this, "BitmapData");
        const target = rectangleValue(rect, "rect");
        if (typeof inputVector !== "object" || inputVector === null) {
            throw new TypeError("inputVector must be an Array-like vector of uint values");
        }

        const length = Number(inputVector.length);
        if (!Number.isSafeInteger(length) || length < 0) {
            throw new TypeError("inputVector must have a valid length");
        }

        const x0 = setVectorCoordinate(target.x, 0, state.width);
        const y0 = setVectorCoordinate(target.y, 0, state.height);
        const x1 = setVectorCoordinate(target.x + target.width, x0, state.width);
        const y1 = setVectorCoordinate(target.y + target.height, y0, state.height);
        const requiredLength = (x1 - x0) * (y1 - y0);
        if (length < requiredLength) {
            throw new RangeError("inputVector does not contain enough pixel values");
        }
        if (requiredLength === 0) return;

        let vectorIndex = 0;
        for (let y = y0; y < y1; y++) {
            const rowOffset = y * state.width;
            for (let x = x0; x < x1; x++) {
                state.pixels![rowOffset + x] = premultiplyPixel(inputVector[vectorIndex++], state.transparent);
            }
        }
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

    generateFilterRect(sourceRect: Rectangle, filter: BitmapFilter): Rectangle {
        bitmapDataValue(this, "BitmapData");
        const rect = sourceRectangle(rectangleValue(sourceRect, "sourceRect"));
        if (!isBitmapFilter(filter)) throw new TypeError("filter must be a BitmapFilter");
        const margins = filterMargins(filter);
        return new Rectangle(
            rect.x - margins.left,
            rect.y - margins.top,
            rect.width + margins.left + margins.right,
            rect.height + margins.top + margins.bottom,
        );
    }

    /**
     * Synchronous CPU-backed Flash filter path. The temporary source is padded
     * by the same margins reported by generateFilterRect; BlurFilter receives
     * a second sampling ring so real pixels outside sourceRect contribute just
     * as they do in Flash Player. Same-bitmap calls are inherently staged in
     * the temporary raster before any destination pixel is replaced.
     */
    applyFilter(sourceBitmapData: BitmapData, sourceRect: Rectangle, destPoint: Point, filter: BitmapFilter): void {
        const destination = bitmapDataValue(this, "BitmapData");
        const source = bitmapDataValue(sourceBitmapData, "sourceBitmapData");
        const rect = sourceRectangle(rectangleValue(sourceRect, "sourceRect"));
        const point = pointValue(destPoint, "destPoint");
        if (!isBitmapFilter(filter)) throw new TypeError("filter must be a BitmapFilter");
        if (!destination.transparent && (isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter)))
            throw new TypeError("Glow, shadow, and bevel filters require a transparent destination BitmapData");
        const margins = filterMargins(filter);
        if (rect.width + margins.left + margins.right <= 0 || rect.height + margins.top + margins.bottom <= 0) return;
        const raster = filterRaster(source, rect, intValue(point.x), intValue(point.y), filter, destination.transparent);
        let changed = false;
        for (let row = 0; row < raster.writeHeight; row++) for (let column = 0; column < raster.writeWidth; column++) {
            const dx = raster.destinationX + column, dy = raster.destinationY + row;
            if (dx < 0 || dy < 0 || dx >= destination.width || dy >= destination.height) continue;
            let pixel = raster.pixels[(raster.writeY + row) * raster.width + raster.writeX + column];
            if (!destination.transparent) pixel = (pixel | 0xff000000) >>> 0;
            destination.pixels![dy * destination.width + dx] = pixel;
            changed = true;
        }
        if (changed) markDirty(destination);
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

    /**
     * Synchronous CPU-backed Flash draw path for retained BitmapData and
     * source-shaped rectangular Graphics fills. Unsupported renderer surfaces
     * fail visibly instead of being approximated by a Bleach-local shim.
     */
    draw(source: IBitmapDrawable, matrix: Matrix | null = null,
        colorTransform: ColorTransform | null = null, blendMode: string | null = null,
        clipRect: Rectangle | null = null, smoothing = false): void {
        const destination = bitmapDataValue(this, "BitmapData");
        if (matrix !== null && !isFlashMatrix(matrix)) throw new TypeError("matrix must be a Matrix or null");
        if (colorTransform !== null && !isFlashColorTransform(colorTransform))
            throw new TypeError("colorTransform must be a ColorTransform or null");
        if (blendMode !== null && blendMode !== "normal")
            throw new UnsupportedFlashFeatureError("flash.display.BitmapData.draw.blendMode",
                "the admitted synchronous raster path currently supports normal blending");
        const clip = clipRect === null ? null : rectangleValue(clipRect, "clipRect");
        const a = matrix?.a ?? 1, b = matrix?.b ?? 0, c = matrix?.c ?? 0,
            d = matrix?.d ?? 1, tx = matrix?.tx ?? 0, ty = matrix?.ty ?? 0;
        const determinant = a * d - b * c;
        if (!Number.isFinite(determinant) || determinant === 0) return;

        const sourceBitmap = isFlashBitmapData(source) ? bitmapDataValue(source, "source") : null;
        const sourcePixels = sourceBitmap
            ? (source === this ? sourceBitmap.pixels!.slice() : sourceBitmap.pixels!)
            : null;
        const rasterCommands = sourceBitmap ? null : isFlashDisplayObject(source)
            ? flashGraphicsRasterCommands(source.graphics as import("./Graphics").Graphics)
            : null;
        if (!sourceBitmap && !rasterCommands) throw new TypeError("source must be an IBitmapDrawable");

        const left = clip ? Math.max(0, Math.floor(clip.x)) : 0;
        const top = clip ? Math.max(0, Math.floor(clip.y)) : 0;
        const right = clip ? Math.min(destination.width, Math.ceil(clip.x + clip.width)) : destination.width;
        const bottom = clip ? Math.min(destination.height, Math.ceil(clip.y + clip.height)) : destination.height;
        let changed = false;
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
            const localX = x + 0.5 - tx, localY = y + 0.5 - ty;
            const sourceX = (d * localX - c * localY) / determinant;
            const sourceY = (-b * localX + a * localY) / determinant;
            let pixel: number | null = null;
            if (sourceBitmap) {
                if (sourceX >= 0 && sourceY >= 0 && sourceX < sourceBitmap.width && sourceY < sourceBitmap.height) {
                    if (!smoothing) {
                        const sx = Math.floor(sourceX), sy = Math.floor(sourceY);
                        pixel = unpremultiplyPixel(sourcePixels![sy * sourceBitmap.width + sx]);
                    } else {
                        const sampleX = Math.max(0, Math.min(sourceBitmap.width - 1, sourceX - 0.5));
                        const sampleY = Math.max(0, Math.min(sourceBitmap.height - 1, sourceY - 0.5));
                        const x0 = Math.floor(sampleX);
                        const y0 = Math.floor(sampleY);
                        const x1 = Math.max(0, Math.min(sourceBitmap.width - 1, x0 + 1));
                        const y1 = Math.max(0, Math.min(sourceBitmap.height - 1, y0 + 1));
                        const amountX = sampleX - x0;
                        const amountY = sampleY - y0;
                        const p00 = sourcePixels![y0 * sourceBitmap.width + x0];
                        const p10 = sourcePixels![y0 * sourceBitmap.width + x1];
                        const p01 = sourcePixels![y1 * sourceBitmap.width + x0];
                        const p11 = sourcePixels![y1 * sourceBitmap.width + x1];
                        const interpolate = (shift: number): number => {
                            const top = ((p00 >>> shift) & 0xff) * (1 - amountX) +
                                ((p10 >>> shift) & 0xff) * amountX;
                            const bottom = ((p01 >>> shift) & 0xff) * (1 - amountX) +
                                ((p11 >>> shift) & 0xff) * amountX;
                            return Math.round(top * (1 - amountY) + bottom * amountY);
                        };
                        pixel = unpremultiplyPixel(((interpolate(24) << 24) | (interpolate(16) << 16) |
                            (interpolate(8) << 8) | interpolate(0)) >>> 0);
                    }
                }
            } else {
                for (let index = rasterCommands!.length - 1; index >= 0; index--) {
                    const command = rasterCommands![index];
                    const minX = Math.min(command.x, command.x + command.width);
                    const maxX = Math.max(command.x, command.x + command.width);
                    const minY = Math.min(command.y, command.y + command.height);
                    const maxY = Math.max(command.y, command.y + command.height);
                    if (sourceX >= minX && sourceX < maxX && sourceY >= minY && sourceY < maxY) {
                        pixel = sampleFlashGraphicsFill(command.fill, sourceX, sourceY);
                        break;
                    }
                }
            }
            if (pixel === null) continue;
            if (colorTransform) {
                const channel = (shift: number, multiplier: number, offset: number): number =>
                    Math.max(0, Math.min(255, Math.round(((pixel! >>> shift) & 0xff) * multiplier + offset)));
                pixel = ((channel(24, colorTransform.alphaMultiplier, colorTransform.alphaOffset) << 24) |
                    (channel(16, colorTransform.redMultiplier, colorTransform.redOffset) << 16) |
                    (channel(8, colorTransform.greenMultiplier, colorTransform.greenOffset) << 8) |
                    channel(0, colorTransform.blueMultiplier, colorTransform.blueOffset)) >>> 0;
            }
            const index = y * destination.width + x;
            let output = composite(premultiplyPixel(pixel, true), destination.pixels![index]);
            if (!destination.transparent) output = (output | 0xff000000) >>> 0;
            destination.pixels![index] = output;
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

/** @internal Resolve intrinsic dimensions without exposing mutable pixel storage. */
export function bitmapDataDimensions(value: BitmapData): { width: number; height: number } | null {
    const state = bitmapDataValue(value, "bitmapData", false);
    return state.pixels === null ? null : { width: state.width, height: state.height };
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
