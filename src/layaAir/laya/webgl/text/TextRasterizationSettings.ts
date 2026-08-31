import type { TrueTypeGlyphOutline } from "./TrueTypeOutline";

/**
 * Controls how platform text coverage is converted into a glyph texture.
 * Imported runtimes can use this hook to reproduce an authored text renderer
 * without replacing text with pre-rasterized images.
 */
export interface TextRasterizationSettings {
    /** Keep platform coverage, remap coverage, or derive signed outline distance before applying cutoffs. */
    coverageMode: "platform" | "linear-cutoff" | "signed-distance-cutoff";
    /** Coverage or signed distance at or below this value becomes transparent. */
    outsideCutoff?: number;
    /** Coverage or signed distance at or above this value becomes fully opaque. */
    insideCutoff?: number;
    /** Device-space grid used when positioning glyph alignment zones. */
    gridFit?: TextGridFitMode;
    /** Optional EM-square alignment zones keyed by Unicode code point. */
    alignmentZones?: Readonly<Record<string, TextGlyphAlignmentZone>>;
    /** Authenticated native outline lookup. A null result keeps the platform renderer. */
    outlineProvider?: (codePoint: number) => TrueTypeGlyphOutline | null;
}

export type TextGridFitMode = "none" | "pixel" | "subpixel";

/** @internal */
export function textRasterizationScale(settings: TextRasterizationSettings, configuredScale: number): number {
    const scale = Number.isFinite(configuredScale) ? configuredScale : 1;
    // Flash CSM samples an outline distance field before applying its cutoffs.
    // Oversampling the native outline mask preserves that ordering at small sizes.
    return settings?.coverageMode === "linear-cutoff" || settings?.coverageMode === "signed-distance-cutoff"
        ? Math.max(scale, 2) : scale;
}

export interface TextAlignmentZoneAxis {
    /** Start of the strong feature in EM-square units. */
    coordinate: number;
    /** Width or height of the strong feature in EM-square units. */
    range: number;
}

export interface TextGlyphAlignmentZone {
    x?: TextAlignmentZoneAxis;
    y?: TextAlignmentZoneAxis;
}

/** @internal */
export function textRasterizationCacheKey(settings: TextRasterizationSettings): string {
    if (!settings || settings.coverageMode === "platform")
        return "";

    const outside = finite(settings.outsideCutoff, 0);
    const inside = finite(settings.insideCutoff, 1);
    const outline = settings.outlineProvider ? "outline_" : "";
    return `rc_${settings.coverageMode}_${numberKey(outside)}_${numberKey(inside)}_${settings.gridFit ?? "none"}_${outline}`;
}

/** @internal */
export function textAlignmentZoneCacheKey(zone: TextGlyphAlignmentZone): string {
    if (!zone)
        return "z0_";
    return `zx_${axisKey(zone.x)}_zy_${axisKey(zone.y)}_`;
}

/** @internal */
export function remapTextCoverage(image: ImageData, settings: TextRasterizationSettings, sampleScale = 1): void {
    if (!settings || settings.coverageMode === "platform")
        return;

    let outside = finite(settings.outsideCutoff, 0);
    let inside = finite(settings.insideCutoff, 1);
    if (settings.coverageMode === "linear-cutoff") {
        outside = clamp01(outside);
        inside = clamp01(inside);
    }
    if (inside < outside)
        [outside, inside] = [inside, outside];

    const span = inside - outside;
    const data = image.data;
    const signedDistances = settings.coverageMode === "signed-distance-cutoff"
        ? signedTextDistances(data, image.width, image.height, sampleScale, outside, inside) : null;
    let pixel = 0;
    for (let pos = 3; pos < data.length; pos += 4) {
        const coverage = signedDistances ? signedDistances[pixel++] : data[pos] / 255;
        const mapped = span <= 1e-6
            ? (coverage >= inside ? 1 : 0)
            : clamp01((coverage - outside) / span);
        data[pos] = Math.round(mapped * 255);
    }
}

/**
 * Approximate Flash's ADF sampling from an oversampled native outline mask.
 * Fractional coverage locates the boundary inside a sample; fully covered or
 * empty samples search only as far as either cutoff can affect the result.
 */
function signedTextDistances(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    sampleScale: number,
    outsideCutoff: number,
    insideCutoff: number,
): Float32Array {
    const scale = Number.isFinite(sampleScale) && sampleScale > 0 ? sampleScale : 1;
    const radius = Math.max(1, Math.min(8,
        Math.ceil(Math.max(Math.abs(outsideCutoff), Math.abs(insideCutoff)) * scale + 1)));
    const result = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixel = y * width + x;
            const alpha = rgba[pixel * 4 + 3] / 255;
            if (alpha > 0 && alpha < 1) {
                result[pixel] = (alpha - 0.5) / scale;
                continue;
            }
            const inside = alpha >= 0.5;
            let nearest = radius;
            for (let dy = -radius; dy <= radius; dy++) {
                const sampleY = y + dy;
                if (sampleY < 0 || sampleY >= height) continue;
                for (let dx = -radius; dx <= radius; dx++) {
                    const sampleX = x + dx;
                    if (sampleX < 0 || sampleX >= width || (dx === 0 && dy === 0)) continue;
                    const sampleAlpha = rgba[(sampleY * width + sampleX) * 4 + 3] / 255;
                    const boundary = sampleAlpha > 0 && sampleAlpha < 1;
                    if (!boundary && (sampleAlpha >= 0.5) === inside) continue;
                    const centerDistance = Math.sqrt(dx * dx + dy * dy);
                    const edgeAdjustment = boundary ? Math.abs(sampleAlpha - 0.5) : -0.5;
                    nearest = Math.min(nearest, Math.max(0, centerDistance + edgeAdjustment));
                }
            }
            result[pixel] = (inside ? nearest : -nearest) / scale;
        }
    }
    return result;
}

/** @internal */
export function gridFitTextPosition(
    position: number,
    axis: TextAlignmentZoneAxis,
    mode: TextGridFitMode,
    fontSize: number,
): number {
    if (mode === "none" || !Number.isFinite(position))
        return position;

    const divisions = mode === "subpixel" ? 3 : 1;
    const coordinate = finite(axis?.coordinate, 0) * fontSize;
    const deviceCoordinate = position + coordinate;
    return Math.round(deviceCoordinate * divisions) / divisions - coordinate;
}

function axisKey(axis: TextAlignmentZoneAxis): string {
    return axis ? `${numberKey(axis.coordinate)}_${numberKey(axis.range)}` : "0";
}

function numberKey(value: number): string {
    return finite(value, 0).toFixed(6);
}

function finite(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}
