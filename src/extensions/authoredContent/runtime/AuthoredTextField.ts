import {
    AntiAliasType, GlowFilter, GradientBevelFilter, GridFitType, TextField, TextFieldAutoSize, TextFieldType, TextFormat, TextFormatAlign,
} from "../../../layaAir/flash";
import { AuthoredFontRegistry, type AuthoredFontBinding } from "../../../layaAir/laya/platform/AuthoredFontRegistry";
import { parseRestrictedFlashHtmlText } from "../core/RestrictedFlashHtmlText";

export interface AuthoredGlowFilterConfiguration {
    readonly kind: "glow";
    readonly color: number;
    readonly alpha: number;
    readonly blurX: number;
    readonly blurY: number;
    readonly strength: number;
    readonly quality: number;
    readonly inner: boolean;
    readonly knockout: boolean;
}

export interface AuthoredGradientBevelFilterConfiguration {
    readonly kind: "gradient-bevel";
    readonly distance: number;
    readonly angle: number;
    readonly colors: ReadonlyArray<number>;
    readonly alphas: ReadonlyArray<number>;
    readonly ratios: ReadonlyArray<number>;
    readonly blurX: number;
    readonly blurY: number;
    readonly strength: number;
    readonly quality: number;
    readonly type: "inner" | "outer" | "full";
    readonly knockout: boolean;
}

export type AuthoredFilterConfiguration = AuthoredGlowFilterConfiguration | AuthoredGradientBevelFilterConfiguration;

export interface AuthoredTextFormatConfiguration {
    readonly fontMode: "device" | "embedded";
    readonly font: string;
    readonly size: number;
    readonly color: number;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly underline: boolean;
    readonly align: "left" | "center" | "right" | "justify";
    readonly leftMargin: number;
    readonly rightMargin: number;
    readonly indent: number;
    readonly leading: number;
    /** Omitted by native bundles emitted before translatable Flash text admission. */
    readonly letterSpacing?: number;
    /** Omitted by native bundles emitted before translatable Flash text admission. */
    readonly kerning?: boolean;
    readonly embeddedFont?: AuthoredEmbeddedFontConfiguration;
}

export interface AuthoredEmbeddedFontConfiguration {
    readonly documentId: string;
    readonly resourceId: string;
    readonly sourceSha256: string;
    readonly fontId: number;
    readonly fontType: "embedded";
    readonly fontStyle: "regular" | "bold" | "italic" | "boldItalic";
    readonly unitsPerEm: number;
    readonly ascent: number;
    readonly descent: number;
    readonly leading: number;
    readonly glyphs: ReadonlyArray<{
        readonly index: number;
        readonly codePoint: number;
        readonly advance: number;
        readonly bounds: { readonly xmin: number; readonly xmax: number; readonly ymin: number; readonly ymax: number };
    }>;
    readonly kerning: ReadonlyArray<{ readonly leftCodePoint: number; readonly rightCodePoint: number; readonly adjustment: number }>;
    readonly alignZones: AuthoredFontAlignZonesConfiguration;
}

export interface AuthoredFontAlignZonesConfiguration {
    readonly tableHint: 1;
    readonly tableHintName: "medium";
    readonly zones: ReadonlyArray<{
        readonly data: ReadonlyArray<{
            readonly alignmentCoordinate: number;
            readonly alignmentCoordinateBits: number;
            readonly range: number;
            readonly rangeBits: number;
        }>;
        readonly maskX: boolean;
        readonly maskY: boolean;
    }>;
}

export interface AuthoredAdvancedTextRasterizationConfiguration {
    readonly antiAliasType: "advanced";
    readonly gridFitType: "pixel" | "subpixel";
    readonly sharpness: number;
    readonly thickness: number;
}

export interface AuthoredTextFieldConfiguration {
    readonly sourceId: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly type: "dynamic" | "input";
    readonly multiline: boolean;
    readonly wordWrap: boolean;
    readonly selectable: boolean;
    readonly displayAsPassword: boolean;
    readonly autoSize: "none";
    readonly html: boolean;
    /** Omitted by bundles emitted before source useOutlines retention. */
    readonly useOutlines?: boolean;
    readonly gutter: 2;
    readonly overflow: "hidden";
    readonly initialText: string;
    readonly format: AuthoredTextFormatConfiguration;
    /** Omitted by native bundles emitted before authored filter admission. */
    readonly filters?: ReadonlyArray<AuthoredFilterConfiguration>;
    readonly rasterization?: AuthoredAdvancedTextRasterizationConfiguration;
}

const FIELD_KEYS = Object.freeze([
    "autoSize", "displayAsPassword", "format", "gutter", "height", "html", "initialText",
    "multiline", "overflow", "selectable", "sourceId", "type", "width", "wordWrap", "x", "y",
]);
const FORMAT_KEYS = Object.freeze([
    "align", "bold", "color", "font", "fontMode", "indent", "italic", "leading", "leftMargin",
    "rightMargin", "size", "underline",
]);
const EXTENDED_FORMAT_KEYS = Object.freeze([...FORMAT_KEYS, "kerning", "letterSpacing"]);
const EMBEDDED_FONT_KEYS = Object.freeze([
    "alignZones", "ascent", "descent", "documentId", "fontId", "fontStyle", "fontType", "glyphs", "kerning", "leading",
    "resourceId", "sourceSha256", "unitsPerEm",
]);
const EMBEDDED_GLYPH_KEYS = Object.freeze(["advance", "bounds", "codePoint", "index"]);
const EMBEDDED_GLYPH_BOUNDS_KEYS = Object.freeze(["xmax", "xmin", "ymax", "ymin"]);
const EMBEDDED_KERNING_KEYS = Object.freeze(["adjustment", "leftCodePoint", "rightCodePoint"]);
const RASTERIZATION_KEYS = Object.freeze(["antiAliasType", "gridFitType", "sharpness", "thickness"]);
const GLOW_FILTER_KEYS = Object.freeze([
    "alpha", "blurX", "blurY", "color", "inner", "kind", "knockout", "quality", "strength",
]);
const GRADIENT_BEVEL_FILTER_KEYS = Object.freeze([
    "alphas", "angle", "blurX", "blurY", "colors", "distance", "kind", "knockout", "quality", "ratios", "strength", "type",
]);
const authoredFontBindings = new WeakMap<TextField, AuthoredFontBinding>();

/**
 * Validates neutral authored metadata completely before constructing the public
 * Flash-shaped field. A caller therefore observes either a fully configured
 * TextField or an exception, never a partially configured display object.
 */
export function createAuthoredTextField(configuration: AuthoredTextFieldConfiguration): TextField {
    const field = new TextField();
    return configureAuthoredTextField(field, configuration);
}

export function configureAuthoredTextField(
    field: TextField,
    configuration: AuthoredTextFieldConfiguration
): TextField {
    if (!(field instanceof TextField) || field.destroyed)
        throw new TypeError("Authored TextField target must be a live TextField");
    const value = validateConfiguration(configuration);
    const previousBinding = authoredFontBindings.get(field);
    let fontBinding: AuthoredFontBinding | undefined;
    if (value.format.fontMode === "embedded") {
        const font = value.format.embeddedFont!;
        fontBinding = AuthoredFontRegistry.bindPublishedText(field, {
            documentId: font.documentId,
            fontId: font.fontId,
            fontName: value.format.font,
            fontStyle: font.fontStyle,
            sourceSha256: font.sourceSha256,
        });
    }
    previousBinding?.cancel();
    if (fontBinding) authoredFontBindings.set(field, fontBinding);
    else authoredFontBindings.delete(field);
    const instanceName = field.name;
    field.name = instanceName || `symbol${value.sourceId}`;
    field.pos(value.x, value.y);
    field.size(value.width, value.height);
    field.type = value.type;
    field.multiline = value.multiline;
    field.wordWrap = value.wordWrap;
    field.selectable = value.selectable;
    field.displayAsPassword = value.displayAsPassword;
    field.flashAutoSize = value.autoSize;
    field.embedFonts = value.useOutlines ?? value.format.fontMode === "embedded";
    if (value.rasterization !== undefined) {
        field.antiAliasType = value.rasterization.antiAliasType;
        field.gridFitType = value.rasterization.gridFitType;
        field.sharpness = value.rasterization.sharpness;
        field.thickness = value.rasterization.thickness;
    }
    const textFormat = new TextFormat(
        value.format.font,
        value.format.size,
        value.format.color,
        value.format.bold,
        value.format.italic,
        value.format.underline,
        null,
        null,
        value.format.align,
        value.format.leftMargin,
        value.format.rightMargin,
        value.format.indent,
        value.format.leading,
    );
    textFormat.letterSpacing = value.format.letterSpacing ?? 0;
    textFormat.kerning = value.format.kerning ?? false;
    field.defaultTextFormat = textFormat;
    field.filters = createAuthoredGlowFilters(value.filters ?? []);
    if (value.html) field.htmlText = value.initialText;
    else field.text = value.initialText;
    return field;
}

export function releaseAuthoredTextFieldFontBinding(field: TextField): void {
    authoredFontBindings.get(field)?.cancel();
    authoredFontBindings.delete(field);
}

export function createAuthoredGlowFilters(value: unknown): Array<GlowFilter | GradientBevelFilter> {
    if (!Array.isArray(value)) throw new TypeError("Authored glow filters must be an array");
    return value.map((candidate, index) => validateAuthoredFilter(candidate, `filters[${index}]`)).map(filter =>
        filter.kind === "glow"
            ? new GlowFilter(filter.color, filter.alpha, filter.blurX, filter.blurY, filter.strength,
                filter.quality, filter.inner, filter.knockout)
            : new GradientBevelFilter(filter.distance, filter.angle, filter.colors, filter.alphas, filter.ratios,
                filter.blurX, filter.blurY, filter.strength, filter.quality, filter.type, filter.knockout));
}

function validateConfiguration(value: AuthoredTextFieldConfiguration): AuthoredTextFieldConfiguration {
    const hasFilters = value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "filters");
    const hasRasterization = value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "rasterization");
    const hasUseOutlines = value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "useOutlines");
    const record = exactDataObject(
        value,
        [...FIELD_KEYS, ...(hasFilters ? ["filters"] : []), ...(hasRasterization ? ["rasterization"] : []), ...(hasUseOutlines ? ["useOutlines"] : [])],
        "Authored TextField configuration",
    );
    const rawFormat = record.format;
    const hasLetterSpacing = hasOwnDataProperty(rawFormat, "letterSpacing");
    const hasKerning = hasOwnDataProperty(rawFormat, "kerning");
    if (hasLetterSpacing !== hasKerning)
        throw new TypeError("Authored TextField format must provide letterSpacing and kerning together");
    const hasEmbeddedFont = hasOwnDataProperty(rawFormat, "embeddedFont");
    const formatKeys = hasLetterSpacing ? EXTENDED_FORMAT_KEYS : FORMAT_KEYS;
    const format = exactDataObject(rawFormat, hasEmbeddedFont ? [...formatKeys, "embeddedFont"] : formatKeys, "Authored TextField format");
    positiveInteger(record.sourceId, "sourceId");
    finite(record.x, "x");
    finite(record.y, "y");
    positive(record.width, "width");
    positive(record.height, "height");
    oneOf(record.type, [TextFieldType.DYNAMIC, TextFieldType.INPUT], "type");
    boolean(record.multiline, "multiline");
    boolean(record.wordWrap, "wordWrap");
    boolean(record.selectable, "selectable");
    boolean(record.displayAsPassword, "displayAsPassword");
    equal(record.autoSize, TextFieldAutoSize.NONE, "autoSize");
    boolean(record.html, "html");
    if (hasUseOutlines) boolean(record.useOutlines, "useOutlines");
    equal(record.gutter, 2, "gutter");
    equal(record.overflow, "hidden", "overflow");
    string(record.initialText, "initialText");
    if (record.filters !== undefined && !Array.isArray(record.filters)) throw new TypeError("filters must be an array");
    const filters = (record.filters === undefined ? [] : record.filters as unknown[])
        .map((filter, index) => validateAuthoredFilter(filter, `filters[${index}]`));

    oneOf(format.fontMode, ["device", "embedded"], "format.fontMode");
    nonemptyString(format.font, "format.font");
    positive(format.size, "format.size");
    integerRange(format.color, 0, 0xffffff, "format.color");
    boolean(format.bold, "format.bold");
    boolean(format.italic, "format.italic");
    boolean(format.underline, "format.underline");
    oneOf(format.align, [TextFormatAlign.LEFT, TextFormatAlign.CENTER, TextFormatAlign.RIGHT, TextFormatAlign.JUSTIFY],
        "format.align");
    finite(format.leftMargin, "format.leftMargin");
    finite(format.rightMargin, "format.rightMargin");
    finite(format.indent, "format.indent");
    finite(format.leading, "format.leading");
    if (hasLetterSpacing) finite(format.letterSpacing, "format.letterSpacing");
    if (hasKerning) boolean(format.kerning, "format.kerning");
    const embeddedFont = format.embeddedFont === undefined ? undefined : validateEmbeddedFont(format.embeddedFont);
    const rasterization = record.rasterization === undefined ? undefined : validateRasterization(record.rasterization);
    const useOutlines = hasUseOutlines ? record.useOutlines as boolean : format.fontMode === "embedded";
    if (format.fontMode === "device" && (embeddedFont !== undefined || rasterization !== undefined || useOutlines))
        throw new TypeError("device text cannot declare embedded font or rasterization state");
    if (format.fontMode === "embedded" && embeddedFont === undefined)
        throw new TypeError("embedded text requires exact font state");
    const expectedStyle = format.bold && format.italic ? "boldItalic" : format.bold ? "bold" : format.italic ? "italic" : "regular";
    if (embeddedFont !== undefined && embeddedFont.fontStyle !== expectedStyle)
        throw new TypeError("embedded font style does not match authored bold/italic state");
    if (record.html) {
        if (record.type !== TextFieldType.DYNAMIC)
            throw new TypeError("authored HTML is admitted only for dynamic fields");
        const layout = parseRestrictedFlashHtmlText(record.initialText);
        if (layout.font !== format.font || layout.size !== format.size || layout.color !== format.color
            || layout.align !== format.align || layout.bold !== format.bold
            || layout.letterSpacing !== (hasLetterSpacing ? format.letterSpacing : 0)
            || layout.kerning !== (hasKerning ? format.kerning : false))
            throw new TypeError("authored HTML markup must match its exact format");
    }
    const normalizedFormat: AuthoredTextFormatConfiguration = Object.freeze({
        fontMode: oneOfValue(format.fontMode, ["device", "embedded"] as const, "format.fontMode"),
        font: format.font,
        size: format.size,
        color: format.color,
        bold: format.bold,
        italic: format.italic,
        underline: format.underline,
        align: oneOfValue(format.align,
            [TextFormatAlign.LEFT, TextFormatAlign.CENTER, TextFormatAlign.RIGHT, TextFormatAlign.JUSTIFY] as const,
            "format.align"),
        leftMargin: format.leftMargin,
        rightMargin: format.rightMargin,
        indent: format.indent,
        leading: format.leading,
        ...(hasLetterSpacing ? { letterSpacing: format.letterSpacing as number } : {}),
        ...(hasKerning ? { kerning: format.kerning as boolean } : {}),
        ...(embeddedFont === undefined ? {} : { embeddedFont }),
    });
    return Object.freeze({
        sourceId: record.sourceId,
        x: record.x,
        y: record.y,
        width: record.width,
        height: record.height,
        type: oneOfValue(record.type, [TextFieldType.DYNAMIC, TextFieldType.INPUT] as const, "type"),
        multiline: record.multiline,
        wordWrap: record.wordWrap,
        selectable: record.selectable,
        displayAsPassword: record.displayAsPassword,
        autoSize: exactValue(record.autoSize, TextFieldAutoSize.NONE, "autoSize"),
        html: record.html,
        useOutlines,
        gutter: exactValue(record.gutter, 2, "gutter"),
        overflow: exactValue(record.overflow, "hidden", "overflow"),
        initialText: record.initialText,
        format: normalizedFormat,
        filters: Object.freeze(filters),
        ...(rasterization === undefined ? {} : { rasterization }),
    });
}

function validateEmbeddedFont(value: unknown): AuthoredEmbeddedFontConfiguration {
    const record = exactDataObject(value, EMBEDDED_FONT_KEYS, "Authored embedded font");
    nonemptyString(record.documentId, "embeddedFont.documentId");
    nonemptyString(record.resourceId, "embeddedFont.resourceId");
    sha256(record.sourceSha256, "embeddedFont.sourceSha256");
    positiveInteger(record.fontId, "embeddedFont.fontId");
    equal(record.fontType, "embedded", "embeddedFont.fontType");
    oneOf(record.fontStyle, ["regular", "bold", "italic", "boldItalic"], "embeddedFont.fontStyle");
    positive(record.unitsPerEm, "embeddedFont.unitsPerEm");
    nonnegative(record.ascent, "embeddedFont.ascent");
    nonnegative(record.descent, "embeddedFont.descent");
    finite(record.leading, "embeddedFont.leading");
    if (!Array.isArray(record.glyphs) || record.glyphs.length === 0)
        throw new TypeError("embeddedFont.glyphs must be a non-empty array");
    let previous = -1;
    const glyphs = record.glyphs.map((value, index) => {
        const glyph = exactDataObject(value, EMBEDDED_GLYPH_KEYS, `embeddedFont.glyphs[${index}]`);
        if (glyph.index !== index) throw new TypeError("embeddedFont.glyphs indices must be contiguous");
        unicodeScalar(glyph.codePoint, `embeddedFont.glyphs[${index}].codePoint`);
        if (glyph.codePoint <= previous) throw new TypeError("embeddedFont.glyphs must be strictly ordered by code point");
        previous = glyph.codePoint;
        nonnegative(glyph.advance, `embeddedFont.glyphs[${index}].advance`);
        const bounds = exactDataObject(glyph.bounds, EMBEDDED_GLYPH_BOUNDS_KEYS, `embeddedFont.glyphs[${index}].bounds`);
        for (const key of EMBEDDED_GLYPH_BOUNDS_KEYS) finite(bounds[key], `embeddedFont.glyphs[${index}].bounds.${key}`);
        return Object.freeze({
            index,
            codePoint: glyph.codePoint,
            advance: glyph.advance,
            bounds: Object.freeze({ xmin: bounds.xmin as number, xmax: bounds.xmax as number, ymin: bounds.ymin as number, ymax: bounds.ymax as number }),
        });
    });
    let previousPair = -1;
    if (!Array.isArray(record.kerning)) throw new TypeError("embeddedFont.kerning must be an array");
    const kerning = record.kerning.map((value, index) => {
        const pair = exactDataObject(value, EMBEDDED_KERNING_KEYS, `embeddedFont.kerning[${index}]`);
        unicodeScalar(pair.leftCodePoint, `embeddedFont.kerning[${index}].leftCodePoint`);
        unicodeScalar(pair.rightCodePoint, `embeddedFont.kerning[${index}].rightCodePoint`);
        finite(pair.adjustment, `embeddedFont.kerning[${index}].adjustment`);
        const key = pair.leftCodePoint * 0x110000 + pair.rightCodePoint;
        if (key <= previousPair) throw new TypeError("embeddedFont.kerning must be unique and source-sorted");
        previousPair = key;
        return Object.freeze({ leftCodePoint: pair.leftCodePoint, rightCodePoint: pair.rightCodePoint, adjustment: pair.adjustment });
    });
    const alignZones = validateFontAlignZones(record.alignZones, glyphs.length);
    return Object.freeze({
        documentId: record.documentId,
        resourceId: record.resourceId,
        sourceSha256: record.sourceSha256,
        fontId: record.fontId,
        fontType: "embedded",
        fontStyle: oneOfValue(record.fontStyle, ["regular", "bold", "italic", "boldItalic"] as const, "embeddedFont.fontStyle"),
        unitsPerEm: record.unitsPerEm,
        ascent: record.ascent,
        descent: record.descent,
        leading: record.leading,
        glyphs: Object.freeze(glyphs),
        kerning: Object.freeze(kerning),
        alignZones,
    });
}

function validateFontAlignZones(value: unknown, glyphCount: number): AuthoredFontAlignZonesConfiguration {
    const record = exactDataObject(value, ["tableHint", "tableHintName", "zones"], "embeddedFont.alignZones");
    equal(record.tableHint, 1, "embeddedFont.alignZones.tableHint");
    equal(record.tableHintName, "medium", "embeddedFont.alignZones.tableHintName");
    if (!Array.isArray(record.zones) || record.zones.length !== glyphCount)
        throw new TypeError("embeddedFont.alignZones.zones must match the glyph count");
    const zones = record.zones.map((value2, index) => {
        const zone = exactDataObject(value2, ["data", "maskX", "maskY"], `embeddedFont.alignZones.zones[${index}]`);
        if (!Array.isArray(zone.data) || zone.data.length !== 2)
            throw new TypeError(`embeddedFont.alignZones.zones[${index}].data must contain two records`);
        const data = zone.data.map((value3, dataIndex) => {
            const datum = exactDataObject(value3, ["alignmentCoordinate", "alignmentCoordinateBits", "range", "rangeBits"], `embeddedFont.alignZones.zones[${index}].data[${dataIndex}]`);
            nonnegative(datum.alignmentCoordinate, `embeddedFont.alignZones.zones[${index}].data[${dataIndex}].alignmentCoordinate`);
            nonnegative(datum.range, `embeddedFont.alignZones.zones[${index}].data[${dataIndex}].range`);
            integerRange(datum.alignmentCoordinateBits, 0, 0xffff, `embeddedFont.alignZones.zones[${index}].data[${dataIndex}].alignmentCoordinateBits`);
            integerRange(datum.rangeBits, 0, 0xffff, `embeddedFont.alignZones.zones[${index}].data[${dataIndex}].rangeBits`);
            return Object.freeze({
                alignmentCoordinate: datum.alignmentCoordinate,
                alignmentCoordinateBits: datum.alignmentCoordinateBits,
                range: datum.range,
                rangeBits: datum.rangeBits,
            });
        });
        boolean(zone.maskX, `embeddedFont.alignZones.zones[${index}].maskX`);
        boolean(zone.maskY, `embeddedFont.alignZones.zones[${index}].maskY`);
        return Object.freeze({ data: Object.freeze(data), maskX: zone.maskX, maskY: zone.maskY });
    });
    return Object.freeze({ tableHint: 1, tableHintName: "medium", zones: Object.freeze(zones) });
}

function validateRasterization(value: unknown): AuthoredAdvancedTextRasterizationConfiguration {
    const record = exactDataObject(value, RASTERIZATION_KEYS, "Authored advanced rasterization");
    equal(record.antiAliasType, AntiAliasType.ADVANCED, "rasterization.antiAliasType");
    oneOf(record.gridFitType, [GridFitType.PIXEL, GridFitType.SUBPIXEL], "rasterization.gridFitType");
    range(record.sharpness, -400, 400, "rasterization.sharpness");
    range(record.thickness, -200, 200, "rasterization.thickness");
    return Object.freeze({
        antiAliasType: "advanced", gridFitType: record.gridFitType,
        sharpness: record.sharpness, thickness: record.thickness,
    });
}

function hasOwnDataProperty(value: unknown, key: string): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
}

function validateGlowFilter(value: unknown, label: string): AuthoredGlowFilterConfiguration {
    const record = exactDataObject(value, GLOW_FILTER_KEYS, label);
    equal(record.kind, "glow", `${label}.kind`);
    integerRange(record.color, 0, 0xffffff, `${label}.color`);
    range(record.alpha, 0, 1, `${label}.alpha`);
    range(record.blurX, 0, 255, `${label}.blurX`);
    range(record.blurY, 0, 255, `${label}.blurY`);
    range(record.strength, 0, 255, `${label}.strength`);
    integerRange(record.quality, 1, 15, `${label}.quality`);
    boolean(record.inner, `${label}.inner`);
    boolean(record.knockout, `${label}.knockout`);
    return Object.freeze({
        kind: "glow", color: record.color, alpha: record.alpha, blurX: record.blurX, blurY: record.blurY,
        strength: record.strength, quality: record.quality, inner: record.inner, knockout: record.knockout,
    });
}

function validateAuthoredFilter(value: unknown, label: string): AuthoredFilterConfiguration {
    const descriptor = typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.getOwnPropertyDescriptor(value, "kind") : undefined;
    return descriptor && "value" in descriptor && descriptor.value === "gradient-bevel"
        ? validateGradientBevelFilter(value, label) : validateGlowFilter(value, label);
}

function validateGradientBevelFilter(value: unknown, label: string): AuthoredGradientBevelFilterConfiguration {
    const record = exactDataObject(value, GRADIENT_BEVEL_FILTER_KEYS, label);
    const colors = numericFilterArray(record.colors, `${label}.colors`, 0, 0xffffff, true);
    const alphas = numericFilterArray(record.alphas, `${label}.alphas`, 0, 1, false);
    const ratios = numericFilterArray(record.ratios, `${label}.ratios`, 0, 255, true);
    if (colors.length < 2 || colors.length !== alphas.length || colors.length !== ratios.length)
        throw new TypeError(`${label} gradient arrays must have the same length of at least two`);
    finite(record.distance, `${label}.distance`);
    finite(record.angle, `${label}.angle`);
    range(record.blurX, 0, 255, `${label}.blurX`);
    range(record.blurY, 0, 255, `${label}.blurY`);
    range(record.strength, 0, 255, `${label}.strength`);
    integerRange(record.quality, 1, 15, `${label}.quality`);
    oneOf(record.type, ["inner", "outer", "full"], `${label}.type`);
    boolean(record.knockout, `${label}.knockout`);
    return Object.freeze({
        kind: "gradient-bevel", distance: record.distance, angle: record.angle,
        colors: Object.freeze(colors), alphas: Object.freeze(alphas), ratios: Object.freeze(ratios),
        blurX: record.blurX, blurY: record.blurY, strength: record.strength, quality: record.quality,
        type: oneOfValue(record.type, ["inner", "outer", "full"] as const, `${label}.type`), knockout: record.knockout,
    });
}

function numericFilterArray(value: unknown, label: string, minimum: number, maximum: number, integer: boolean): number[] {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value.map((candidate, index) => {
        range(candidate, minimum, maximum, `${label}[${index}]`);
        if (integer && !Number.isInteger(candidate)) throw new TypeError(`${label}[${index}] must be an integer`);
        return candidate;
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

function finite(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function positive(value: unknown, label: string): asserts value is number {
    finite(value, label);
    if (value <= 0) throw new RangeError(`${label} must be positive`);
}

function nonnegative(value: unknown, label: string): asserts value is number {
    finite(value, label);
    if (value < 0) throw new RangeError(`${label} must be nonnegative`);
}

function range(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
    finite(value, label);
    if (value < minimum || value > maximum)
        throw new RangeError(`${label} must be from ${minimum} through ${maximum}`);
}

function positiveInteger(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
        throw new RangeError(`${label} must be a positive integer`);
}

function integerRange(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum)
        throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}`);
}

function unicodeScalar(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0x10ffff
        || value >= 0xd800 && value <= 0xdfff)
        throw new RangeError(`${label} must be a Unicode scalar value`);
}

function sha256(value: unknown, label: string): asserts value is string {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
        throw new TypeError(`${label} must be lowercase SHA-256`);
}

function boolean(value: unknown, label: string): asserts value is boolean {
    if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
}

function string(value: unknown, label: string): asserts value is string {
    if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
}

function nonemptyString(value: unknown, label: string): asserts value is string {
    string(value, label);
    if (value.length === 0) throw new TypeError(`${label} must not be empty`);
}

function equal<T>(value: unknown, expected: T, label: string): asserts value is T {
    if (value !== expected) throw new TypeError(`${label} must be ${String(expected)}`);
}

function oneOf<T>(value: unknown, allowed: readonly T[], label: string): asserts value is T {
    if (!allowed.some(candidate => Object.is(candidate, value)))
        throw new TypeError(`${label} has an unsupported value`);
}

function exactValue<T>(value: unknown, expected: T, label: string): T {
    equal(value, expected, label);
    return expected;
}

function oneOfValue<T>(value: unknown, allowed: readonly T[], label: string): T {
    oneOf(value, allowed, label);
    return value;
}
