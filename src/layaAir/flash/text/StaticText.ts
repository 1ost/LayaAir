import { Texture } from "../../laya/resource/Texture";
import { runAdmittedNodeMutation } from "../../laya/display/NodeMutationTransaction";
import { DisplayObject } from "../display/DisplayObject";

const STATIC_TEXT_TOKEN = Symbol("LayaAir.authored.StaticText");
const STATIC_TEXT_VALUES = new WeakSet<object>();
const STATIC_TEXT_CONTENT = new WeakMap<StaticText, string>();
const destroyCanonicalStaticText = DisplayObject.prototype.destroy;

/** @internal Read-only nominal proof for canonical Flash static text. */
export function isFlashStaticText(value: unknown): value is StaticText {
    return typeof value === "object" && value !== null && STATIC_TEXT_VALUES.has(value);
}

/**
 * Source-shaped flash.text.StaticText backed by native Laya graphics.
 * Static text is authored content: callers can read its text but cannot edit it.
 */
export class StaticText extends DisplayObject {
    constructor(token: typeof STATIC_TEXT_TOKEN) {
        if (token !== STATIC_TEXT_TOKEN) throw new TypeError("StaticText is created only by LayaAir authored content");
        super();
        STATIC_TEXT_VALUES.add(this);
        STATIC_TEXT_CONTENT.set(this, "");
        this.mouseEnabled = false;
        Object.defineProperty(this, "text", {
            configurable: false,
            enumerable: false,
            get(this: unknown) { return readStaticText(this); },
            set() { throw new TypeError("StaticText.text is read-only"); },
        });
    }

    /** Concatenation of authenticated source glyph mappings in display order. */
    get text(): string { return readStaticText(this); }

    override destroy(destroyChild = true): void {
        if (this.destroyed) return;
        runAdmittedNodeMutation(this, "destroyFlashDisplayObject", () => {
            STATIC_TEXT_CONTENT.delete(this);
            destroyCanonicalStaticText.call(this, destroyChild);
        });
    }
}

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

interface NativeStaticTextGlyph {
    readonly texture: Texture | null;
    readonly character: string | null;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly alpha: number;
    readonly color: string;
}

const CONFIGURATION_KEYS = Object.freeze(["height", "runs", "sourceId", "width", "x", "y"]);
const RUN_KEYS = Object.freeze(["alpha", "color", "glyphs"]);
const GLYPH_KEYS = Object.freeze(["character", "height", "texture", "width", "x", "y"]);
const COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;

/**
 * LayaAir-authored runtime entry point. It validates and detaches the complete
 * texture-backed placement batch before the private StaticText authority mints
 * an instance. This is not a SWF/font converter or generic glyph registry.
 * @internal
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
    const result = new StaticText(STATIC_TEXT_TOKEN);
    result.size(value.width, value.height);
    let text = "";
    for (const glyph of glyphs) {
        if (glyph.character !== null) text += glyph.character;
        if (glyph.texture !== null)
            result.graphics.drawTexture(glyph.texture, glyph.x, glyph.y, glyph.width, glyph.height,
                null, glyph.alpha, glyph.color);
    }
    STATIC_TEXT_CONTENT.set(result, text);
    result.name = `symbol${value.sourceId}`;
    result.pos(value.x, value.y);
    return result;
}

function readStaticText(receiver: unknown): string {
    if (typeof receiver !== "object" || receiver === null || !STATIC_TEXT_VALUES.has(receiver))
        throw new TypeError("StaticText.text requires a canonical StaticText receiver");
    const value = STATIC_TEXT_CONTENT.get(receiver as StaticText);
    if (value === undefined) throw new TypeError("StaticText.text is unavailable after destroy");
    return value;
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

const _staticTextHeritage: (value: StaticText) => DisplayObject = value => value;
void _staticTextHeritage;
