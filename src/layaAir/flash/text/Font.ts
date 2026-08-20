import { flashFontRecordSnapshot } from "../../laya/platform/AuthoredFontRegistry";

export interface FlashFontRegistration {
    readonly documentId: string;
    readonly fontId: number;
    readonly fontStyle: "regular" | "bold" | "italic" | "boldItalic";
    readonly sourceSha256: string;
}

export interface FlashFontClass {
    readonly authoredFont: FlashFontRegistration;
}

/** Source-visible immutable Flash font backed only by authenticated Laya records. */
export class Font {
    readonly #glyphCodePoints: ReadonlySet<number>;

    private constructor(
        public readonly fontName: string,
        public readonly fontStyle: "regular" | "bold" | "italic" | "boldItalic",
        public readonly fontType: "device" | "embedded" | "embeddedCFF",
        glyphCodePoints: readonly number[],
    ) {
        this.#glyphCodePoints = new Set(glyphCodePoints);
    }

    static enumerateFonts(enumerateDeviceFonts = false): Font[] {
        Boolean(enumerateDeviceFonts);
        return flashFontRecordSnapshot().map(record => Object.freeze(new Font(
            record.fontName, record.fontStyle, record.fontType, record.glyphCodePoints,
        )) as Font);
    }

    static registerFont(fontClass: FlashFontClass): void {
        if (typeof fontClass !== "function") throw new TypeError("Font.registerFont requires a font class");
        const property = Object.getOwnPropertyDescriptor(fontClass, "authoredFont");
        if (!property || !("value" in property) || !property.value || typeof property.value !== "object")
            throw new TypeError("Font class authoredFont must be an own data property");
        const registration = property.value as FlashFontRegistration;
        const matches = flashFontRecordSnapshot().some(record =>
            record.documentId === registration.documentId
            && record.fontId === registration.fontId
            && record.fontStyle === registration.fontStyle
            && record.sourceSha256 === registration.sourceSha256);
        if (!matches) throw new Error("Font.registerFont requires an active authored font registry");
    }

    hasGlyphs(str: string): boolean {
        if (typeof str !== "string") throw new TypeError("Font.hasGlyphs requires a string");
        for (const character of str)
            if (!this.#glyphCodePoints.has(character.codePointAt(0)!)) return false;
        return true;
    }
}
