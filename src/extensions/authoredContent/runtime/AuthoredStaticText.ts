import { StaticText, type NativeStaticTextGlyph } from "../../../layaAir/flash/text/StaticText";
import { Texture } from "../../../layaAir/laya/resource/Texture";

export interface AuthoredStaticGlyphConfiguration {
    readonly texture: Texture | null;
    readonly character: string | null;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface AuthoredStaticGlyphRunConfiguration {
    readonly color: string;
    readonly alpha: number;
    readonly glyphs: readonly AuthoredStaticGlyphConfiguration[];
}

export interface AuthoredStaticTextConfiguration {
    readonly sourceId: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly runs: readonly AuthoredStaticGlyphRunConfiguration[];
}

const CONFIGURATION_KEYS = Object.freeze(["height", "runs", "sourceId", "width", "x", "y"]);
const RUN_KEYS = Object.freeze(["alpha", "color", "glyphs"]);
const GLYPH_KEYS = Object.freeze(["character", "height", "texture", "width", "x", "y"]);
const COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;

/**
 * Publishes one texture-backed authored StaticText atomically. This is a narrow
 * runtime seam, not a SWF/font converter and not a generic glyph registry.
 */
export function createAuthoredStaticText(configuration: AuthoredStaticTextConfiguration): StaticText {
    const value = validateConfiguration(configuration);
    const glyphs: NativeStaticTextGlyph[] = [];
    for (const run of value.runs) {
        for (const glyph of run.glyphs) {
            glyphs.push(Object.freeze({
                texture: glyph.texture,
                character: glyph.character,
                x: glyph.x,
                y: glyph.y,
                width: glyph.width,
                height: glyph.height,
                alpha: run.alpha,
                color: run.color,
            }));
        }
    }
    const result = StaticText._$fromAuthoredTextureGlyphs(value.width, value.height, Object.freeze(glyphs));
    result.name = `symbol${value.sourceId}`;
    result.pos(value.x, value.y);
    return result;
}

function validateConfiguration(value: AuthoredStaticTextConfiguration): AuthoredStaticTextConfiguration {
    const record = exactDataObject(value, CONFIGURATION_KEYS, "Authored StaticText configuration");
    positiveInteger(record.sourceId, "sourceId");
    finite(record.x, "x");
    finite(record.y, "y");
    nonnegative(record.width, "width");
    nonnegative(record.height, "height");
    if (!Array.isArray(record.runs)) throw new TypeError("runs must be an array");
    const runs = record.runs.map((candidate, runIndex) => {
        const run = exactDataObject(candidate, RUN_KEYS, `runs[${runIndex}]`);
        if (typeof run.color !== "string" || !COLOR.test(run.color))
            throw new TypeError(`runs[${runIndex}].color must be #RRGGBB or #RRGGBBAA`);
        finite(run.alpha, `runs[${runIndex}].alpha`);
        if (run.alpha < 0 || run.alpha > 1) throw new RangeError(`runs[${runIndex}].alpha must be from 0 through 1`);
        if (!Array.isArray(run.glyphs)) throw new TypeError(`runs[${runIndex}].glyphs must be an array`);
        const glyphs = run.glyphs.map((candidateGlyph, glyphIndex) => {
            const label = `runs[${runIndex}].glyphs[${glyphIndex}]`;
            const glyph = exactDataObject(candidateGlyph, GLYPH_KEYS, label);
            if (glyph.texture !== null && !(glyph.texture instanceof Texture))
                throw new TypeError(`${label}.texture must be a native Laya Texture or null`);
            if (glyph.character !== null) validateCharacter(glyph.character, `${label}.character`);
            finite(glyph.x, `${label}.x`);
            finite(glyph.y, `${label}.y`);
            nonnegative(glyph.width, `${label}.width`);
            nonnegative(glyph.height, `${label}.height`);
            if (glyph.texture !== null && (glyph.width === 0 || glyph.height === 0))
                throw new RangeError(`${label} textured dimensions must be positive`);
            return Object.freeze({
                texture: glyph.texture as Texture | null,
                character: glyph.character as string | null,
                x: glyph.x,
                y: glyph.y,
                width: glyph.width,
                height: glyph.height,
            });
        });
        return Object.freeze({ color: run.color, alpha: run.alpha, glyphs: Object.freeze(glyphs) });
    });
    return Object.freeze({
        sourceId: record.sourceId,
        x: record.x,
        y: record.y,
        width: record.width,
        height: record.height,
        runs: Object.freeze(runs),
    });
}

function exactDataObject(value: unknown, expectedKeys: readonly string[], label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype)
        throw new TypeError(`${label} must be a plain data object`);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string")
        || JSON.stringify([...keys].sort()) !== JSON.stringify([...expectedKeys].sort()))
        throw new TypeError(`${label} must contain exactly ${expectedKeys.join(", ")}`);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of expectedKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor))
            throw new TypeError(`${label}.${key} must be an own data property`);
        result[key] = descriptor.value;
    }
    return result;
}

function validateCharacter(value: unknown, label: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0 || Array.from(value).length !== 1)
        throw new TypeError(`${label} must be one Unicode scalar or null`);
    const codePoint = value.codePointAt(0)!;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff)
        throw new TypeError(`${label} must not be an unpaired surrogate`);
}

function finite(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function nonnegative(value: unknown, label: string): asserts value is number {
    finite(value, label);
    if (value < 0) throw new RangeError(`${label} must be nonnegative`);
}

function positiveInteger(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
        throw new RangeError(`${label} must be a positive integer`);
}
