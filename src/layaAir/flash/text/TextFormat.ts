const TEXT_FORMAT_VALUES = new WeakSet<object>();
const CSM_SETTINGS_VALUES = new WeakSet<object>();

/** @internal Nominal guard for authenticated runtime `is` checks. */
export function isFlashTextFormat(value: unknown): value is TextFormat {
    return typeof value === "object" && value !== null && TEXT_FORMAT_VALUES.has(value);
}

/** @internal Nominal guard for authenticated runtime `is` checks. */
export function isFlashCSMSettings(value: unknown): value is CSMSettings {
    return typeof value === "object" && value !== null && CSM_SETTINGS_VALUES.has(value);
}

/** Flash-compatible nullable text-format value object. */
export class TextFormat {
    blockIndent: number | null = null;
    bullet: boolean | null = null;
    kerning: boolean | null = null;
    letterSpacing: number | null = null;
    tabStops: number[] | null = null;

    constructor(
        public font: string | null = null,
        public size: number | null = null,
        public color: number | null = null,
        public bold: boolean | null = null,
        public italic: boolean | null = null,
        public underline: boolean | null = null,
        public url: string | null = null,
        public target: string | null = null,
        public align: string | null = null,
        public leftMargin: number | null = null,
        public rightMargin: number | null = null,
        public indent: number | null = null,
        public leading: number | null = null,
    ) { TEXT_FORMAT_VALUES.add(this); }
}

export class AntiAliasType {
    static readonly ADVANCED = "advanced";
    static readonly NORMAL = "normal";
}

export class GridFitType {
    static readonly NONE = "none";
    static readonly PIXEL = "pixel";
    static readonly SUBPIXEL = "subpixel";
}

export class TextFieldAutoSize {
    static readonly CENTER = "center";
    static readonly LEFT = "left";
    static readonly NONE = "none";
    static readonly RIGHT = "right";
}

export class TextFieldType {
    static readonly DYNAMIC = "dynamic";
    static readonly INPUT = "input";
}

export class TextFormatAlign {
    static readonly CENTER = "center";
    static readonly JUSTIFY = "justify";
    static readonly LEFT = "left";
    static readonly RIGHT = "right";
    static readonly START = "start";
    static readonly END = "end";
}

export class FontStyle {
    static readonly BOLD = "bold";
    static readonly BOLD_ITALIC = "boldItalic";
    static readonly ITALIC = "italic";
    static readonly REGULAR = "regular";
}

export class TextColorType {
    static readonly DARK_COLOR = "dark";
    static readonly LIGHT_COLOR = "light";
}

export class TextDisplayMode {
    static readonly CRT = "crt";
    static readonly DEFAULT = "default";
    static readonly LCD = "lcd";
}

export class CSMSettings {
    constructor(
        public fontSize = 0,
        public insideCutoff = 0,
        public outsideCutoff = 0,
    ) { CSM_SETTINGS_VALUES.add(this); }
}

export class TextLineMetrics {
    constructor(
        public x = 0,
        public width = 0,
        public height = 0,
        public ascent = 0,
        public descent = 0,
        public leading = 0,
    ) { }
}

/**
 * Native table store used by embedded Flash text. It keeps only authored CSM
 * values and resolves them deterministically; it never interprets SWF data.
 */
export class TextRenderer {
    static maxLevel = 4;
    static displayMode = TextDisplayMode.DEFAULT;
    private static readonly tables = new Map<string, readonly CSMSettings[]>();

    static setAdvancedAntiAliasingTable(
        fontName: string,
        fontStyle: string,
        colorType: string,
        advancedAntiAliasingTable: CSMSettings[],
    ): void {
        if (!fontName || ![FontStyle.REGULAR, FontStyle.BOLD, FontStyle.ITALIC, FontStyle.BOLD_ITALIC].includes(fontStyle))
            throw new TypeError("TextRenderer requires a font name and a valid FontStyle");
        if (![TextColorType.DARK_COLOR, TextColorType.LIGHT_COLOR].includes(colorType))
            throw new TypeError(`Invalid TextColorType '${colorType}'`);
        if (!Array.isArray(advancedAntiAliasingTable) || advancedAntiAliasingTable.length === 0)
            throw new TypeError("The advanced anti-aliasing table must contain at least one CSMSettings entry");

        const table = advancedAntiAliasingTable.map(value => {
            if (!isFlashCSMSettings(value) || !Number.isFinite(value.fontSize)
                || !Number.isFinite(value.insideCutoff) || !Number.isFinite(value.outsideCutoff)
                || value.outsideCutoff > value.insideCutoff)
                throw new TypeError("Invalid CSMSettings entry");
            return new CSMSettings(value.fontSize, value.insideCutoff, value.outsideCutoff);
        }).sort((left, right) => left.fontSize - right.fontSize);
        this.tables.set(this.key(fontName, fontStyle, colorType), Object.freeze(table));
    }

    /** @internal */
    static resolveAdvancedAntiAliasing(
        fontName: string,
        fontStyle: string,
        colorType: string,
        fontSize: number,
    ): CSMSettings | null {
        const table = this.tables.get(this.key(fontName, fontStyle, colorType));
        if (!table?.length) return null;
        if (fontSize <= table[0].fontSize) return copyCSM(table[0]);
        const last = table[table.length - 1];
        if (fontSize >= last.fontSize) return copyCSM(last);
        for (let index = 1; index < table.length; index++) {
            const right = table[index];
            if (fontSize > right.fontSize) continue;
            const left = table[index - 1];
            const ratio = (fontSize - left.fontSize) / (right.fontSize - left.fontSize);
            return new CSMSettings(
                fontSize,
                left.insideCutoff + (right.insideCutoff - left.insideCutoff) * ratio,
                left.outsideCutoff + (right.outsideCutoff - left.outsideCutoff) * ratio,
            );
        }
        return copyCSM(last);
    }

    private static key(fontName: string, fontStyle: string, colorType: string): string {
        return `${fontName.toLowerCase()}\u0000${fontStyle}\u0000${colorType}`;
    }
}

function copyCSM(value: CSMSettings): CSMSettings {
    return new CSMSettings(value.fontSize, value.insideCutoff, value.outsideCutoff);
}
