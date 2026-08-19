import { FontStyle } from "./TextFormat";
import { FontType } from "./FontType";

export interface FlashFontRegistration {
    readonly documentId: string;
    readonly fontId: number;
    readonly fontStyle: "regular" | "bold" | "italic" | "boldItalic";
    readonly sourceSha256: string;
}

export interface FlashFontClass {
    readonly authoredFont: FlashFontRegistration;
}

export interface FlashFontDescriptor {
    readonly fontName: string;
    readonly fontStyle: "regular" | "bold" | "italic" | "boldItalic";
    readonly fontType: "device" | "embedded" | "embeddedCFF";
}

export interface FlashFontRegistryPort {
    enumerateFonts(includeDeviceFonts: boolean): readonly Font[];
    registerFontClass(fontClass: FlashFontClass): void;
}

let activeRegistry: FlashFontRegistryPort | null = null;

/**
 * Source-used Flash font description backed by the engine-owned authored font
 * registry. Browsers do not expose a complete installed-font census, so device
 * fonts are returned only when an engine platform supplies an explicit snapshot.
 */
export class Font {
    private constructor(
        public readonly fontName: string,
        public readonly fontStyle: "regular" | "bold" | "italic" | "boldItalic",
        public readonly fontType: "device" | "embedded" | "embeddedCFF",
    ) { }

    static enumerateFonts(enumerateDeviceFonts = false): Font[] {
        return activeRegistry ? [...activeRegistry.enumerateFonts(Boolean(enumerateDeviceFonts))] : [];
    }

    static registerFont(fontClass: FlashFontClass): void {
        if (!activeRegistry)
            throw new Error("Font.registerFont requires an active authored font registry");
        activeRegistry.registerFontClass(fontClass);
    }

    /** @internal Creates an immutable source-visible font record. */
    static _fromEngine(descriptor: FlashFontDescriptor): Font {
        if (!descriptor || typeof descriptor !== "object")
            throw new TypeError("Font engine descriptor must be an object");
        if (typeof descriptor.fontName !== "string" || descriptor.fontName.length === 0)
            throw new TypeError("Font engine descriptor requires a fontName");
        if (![FontStyle.REGULAR, FontStyle.BOLD, FontStyle.ITALIC, FontStyle.BOLD_ITALIC].includes(descriptor.fontStyle))
            throw new TypeError("Font engine descriptor has an unsupported fontStyle");
        if (![FontType.DEVICE, FontType.EMBEDDED, FontType.EMBEDDED_CFF].includes(descriptor.fontType))
            throw new TypeError("Font engine descriptor has an unsupported fontType");
        return Object.freeze(new Font(descriptor.fontName, descriptor.fontStyle, descriptor.fontType));
    }

    /** @internal Installs one engine registry until the returned lease is released. */
    static _installEngineRegistry(registry: FlashFontRegistryPort): () => void {
        if (!registry || typeof registry.enumerateFonts !== "function" || typeof registry.registerFontClass !== "function")
            throw new TypeError("Font engine registry has an invalid contract");
        if (activeRegistry && activeRegistry !== registry)
            throw new Error("A different authored font registry is already active");
        activeRegistry = registry;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            if (activeRegistry === registry) activeRegistry = null;
        };
    }
}
