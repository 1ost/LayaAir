import { Texture } from "../../laya/resource/Texture";
import { DisplayObject } from "../display/DisplayObject";

const STATIC_TEXT_VALUES = new WeakSet<object>();
const STATIC_TEXT_CONTENT = new WeakMap<StaticText, string>();

/** @internal Read-only nominal proof for canonical Flash static text. */
export function isFlashStaticText(value: unknown): value is StaticText {
    return typeof value === "object" && value !== null && STATIC_TEXT_VALUES.has(value);
}

/**
 * One already-resolved native texture placement used by LayaAir's authored
 * content runtime. This is deliberately below the public Flash surface.
 *
 * A null character means the source font did not provide an authenticated
 * Unicode mapping. The texture is still rendered, but StaticText.text does not
 * invent a replacement character for it.
 *
 * @internal
 */
export interface NativeStaticTextGlyph {
    readonly texture: Texture | null;
    readonly character: string | null;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly alpha: number;
    readonly color: string;
}

/**
 * Source-shaped flash.text.StaticText backed by native Laya graphics.
 * Static text is authored content: callers can read its text but cannot edit it.
 */
export class StaticText extends DisplayObject {
    /** Native serialization identity consumed by the authored-content emitter. @internal */
    static readonly _$authoredSourceType = "StaticText" as const;
    /** Native Laya hierarchy nodes serialize this display value as a Sprite. @internal */
    static readonly _$authoredSerializedType = "Sprite" as const;

    constructor() {
        super();
        STATIC_TEXT_VALUES.add(this);
        STATIC_TEXT_CONTENT.set(this, "");
        this.mouseEnabled = false;
    }

    /** Concatenation of authenticated source glyph mappings in display order. */
    get text(): string { return STATIC_TEXT_CONTENT.get(this) ?? ""; }

    /**
     * LayaAir-authored runtime entry point. Conversion and font extraction stay
     * outside this class; this method only publishes immutable native placements.
     * @internal
     */
    static _$fromAuthoredTextureGlyphs(
        width: number,
        height: number,
        glyphs: readonly NativeStaticTextGlyph[],
    ): StaticText {
        const value = new StaticText();
        value.size(width, height);
        let text = "";
        for (const glyph of glyphs) {
            if (glyph.character !== null) text += glyph.character;
            if (glyph.texture !== null)
                value.graphics.drawTexture(glyph.texture, glyph.x, glyph.y, glyph.width, glyph.height,
                    null, glyph.alpha, glyph.color);
        }
        STATIC_TEXT_CONTENT.set(value, text);
        return value;
    }
}

const _staticTextHeritage: (value: StaticText) => DisplayObject = value => value;
void _staticTextHeritage;
