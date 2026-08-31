/**
 * Controls how platform text coverage is converted into a glyph texture.
 * Imported runtimes can use this hook to reproduce an authored text renderer
 * without replacing text with pre-rasterized images.
 */
export interface TextRasterizationSettings {
    /** Keep the platform coverage, or remap it through two linear cutoffs. */
    coverageMode: "platform" | "linear-cutoff";
    /** Coverage at or below this value becomes transparent. */
    outsideCutoff?: number;
    /** Coverage at or above this value becomes fully opaque. */
    insideCutoff?: number;
    /** Device-space grid used when positioning glyph alignment zones. */
    gridFit?: TextGridFitMode;
    /** Optional EM-square alignment zones keyed by Unicode code point. */
    alignmentZones?: Readonly<Record<string, TextGlyphAlignmentZone>>;
}

export type TextGridFitMode = "none" | "pixel" | "subpixel";

/** @internal */
export function textRasterizationScale(settings: TextRasterizationSettings, configuredScale: number): number {
    const scale = Number.isFinite(configuredScale) ? configuredScale : 1;
    // Flash CSM samples an outline distance field before applying its cutoffs.
    // Oversampling the native outline mask preserves that ordering at small sizes.
    return settings?.coverageMode === "linear-cutoff" ? Math.max(scale, 2) : scale;
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
    return `rc_${numberKey(outside)}_${numberKey(inside)}_${settings.gridFit ?? "none"}_`;
}

/** @internal */
export function textAlignmentZoneCacheKey(zone: TextGlyphAlignmentZone): string {
    if (!zone)
        return "z0_";
    return `zx_${axisKey(zone.x)}_zy_${axisKey(zone.y)}_`;
}

/** @internal */
export function remapTextCoverage(image: ImageData, settings: TextRasterizationSettings): void {
    if (!settings || settings.coverageMode !== "linear-cutoff")
        return;

    let outside = clamp01(finite(settings.outsideCutoff, 0));
    let inside = clamp01(finite(settings.insideCutoff, 1));
    if (inside < outside)
        [outside, inside] = [inside, outside];

    const span = inside - outside;
    const data = image.data;
    for (let pos = 3; pos < data.length; pos += 4) {
        const coverage = data[pos] / 255;
        const mapped = span <= 1e-6
            ? (coverage >= inside ? 1 : 0)
            : clamp01((coverage - outside) / span);
        data[pos] = Math.round(mapped * 255);
    }
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
