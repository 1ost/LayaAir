import {
    AntiAliasType, BitmapFilter, BlurFilter, ColorMatrixFilter, DropShadowFilter, GlowFilter, GradientBevelFilter, GradientGlowFilter, GridFitType, TextField, TextFieldAutoSize, TextFieldType, TextFormat, TextFormatAlign,
} from "../../../layaAir/flash";
import { isBitmapFilter } from "../../../layaAir/flash/filters/FilterRegistry";
import { setDisplayObjectNativeFilters } from "../../../layaAir/flash/geom/Transform";
import { Filter } from "../../../layaAir/laya/filters/Filter";
import { AuthoredFontRegistry, type AuthoredTextFontBinding } from "../../../layaAir/laya/platform/AuthoredFontRegistry";
import {
    createFlashAuthoredBevelFilter, type FlashAuthoredBevelFilterOptions,
} from "../../../layaAir/laya/display/effect2d/FlashBevelEffects";
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

export interface AuthoredDropShadowFilterConfiguration {
    readonly kind: "drop-shadow";
    readonly distance: number;
    readonly angleRadians: number;
    readonly color: number;
    readonly alpha: number;
    readonly blurX: number;
    readonly blurY: number;
    readonly strength: number;
    readonly quality: number;
    readonly inner: boolean;
    readonly knockout: boolean;
    readonly hideObject: boolean;
}

export interface AuthoredBevelFilterConfiguration extends FlashAuthoredBevelFilterOptions {
    readonly kind: "bevel";
}

export interface AuthoredBlurFilterConfiguration {
    readonly kind: "blur";
    readonly blurX: number;
    readonly blurY: number;
    readonly quality: number;
}

export interface AuthoredGradientBevelFilterConfiguration {
    readonly kind: "gradient-bevel";
    readonly distance: number;
    readonly angleRadians: number;
    readonly colors: ReadonlyArray<number>;
    readonly alphas: ReadonlyArray<number>;
    readonly ratios: ReadonlyArray<number>;
    readonly blurX: number;
    readonly blurY: number;
    readonly strength: number;
    readonly quality: number;
    readonly type: "inner" | "outer" | "full";
    readonly knockout: boolean;
    readonly compositeSource: true;
}

export interface AuthoredGradientGlowFilterConfiguration extends Omit<AuthoredGradientBevelFilterConfiguration, "kind"> {
    readonly kind: "gradient-glow";
}

export type AuthoredFilterConfiguration = AuthoredBlurFilterConfiguration | AuthoredGlowFilterConfiguration | AuthoredDropShadowFilterConfiguration
    | AuthoredBevelFilterConfiguration | AuthoredGradientBevelFilterConfiguration | AuthoredGradientGlowFilterConfiguration
    | AuthoredColorMatrixFilterConfiguration;

export interface AuthoredColorMatrixFilterConfiguration {
    readonly kind: "color-matrix";
    readonly matrix: ReadonlyArray<number>;
}


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

/** Compact native-prefab reference to the full active font-manifest record. */
export interface AuthoredEmbeddedFontReference {
    readonly kind: "published-font-reference@1";
    readonly documentId: string;
    readonly resourceId: string;
    readonly sourceSha256: string;
    readonly fontId: number;
    readonly fontStyle: "regular" | "bold" | "italic" | "boldItalic";
}

export interface AuthoredFontAlignZonesConfiguration {
    readonly tableHint: 0 | 1 | 2;
    readonly tableHintName: "thin" | "medium" | "thick";
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
    readonly gridFitType: "none" | "pixel" | "subpixel";
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
const EMBEDDED_FONT_REFERENCE_KEYS = Object.freeze([
    "documentId", "fontId", "fontStyle", "kind", "resourceId", "sourceSha256",
]);
const LEGACY_EMBEDDED_FONT_REFERENCE_KEYS = Object.freeze([
    "documentId", "fontId", "fontStyle", "sourceSha256",
]);
const EMBEDDED_GLYPH_KEYS = Object.freeze(["advance", "bounds", "codePoint", "index"]);
const EMBEDDED_GLYPH_BOUNDS_KEYS = Object.freeze(["xmax", "xmin", "ymax", "ymin"]);
const EMBEDDED_KERNING_KEYS = Object.freeze(["adjustment", "leftCodePoint", "rightCodePoint"]);
const RASTERIZATION_KEYS = Object.freeze(["antiAliasType", "gridFitType", "sharpness", "thickness"]);
const GLOW_FILTER_KEYS = Object.freeze([
    "alpha", "blurX", "blurY", "color", "inner", "kind", "knockout", "quality", "strength",
]);
const DROP_SHADOW_FILTER_KEYS = Object.freeze([
    "alpha", "angleRadians", "blurX", "blurY", "color", "distance", "hideObject", "inner",
    "kind", "knockout", "quality", "strength",
]);
const BEVEL_FILTER_KEYS = Object.freeze([
    "angleRadians", "blurX", "blurY", "compositeSource", "distance", "highlightAlpha",
    "highlightColor", "innerShadow", "kind", "knockout", "onTop", "passes", "shadowAlpha",
    "shadowColor", "sourceType", "strength",
]);
const COLOR_MATRIX_FILTER_KEYS = Object.freeze(["kind", "matrix"]);
const authoredFontBindings = new WeakMap<TextField, AuthoredTextFontBinding>();
const authoredHtmlFields = new WeakSet<TextField>();
const normalizedAuthoredTextConfigurations = new WeakSet<object>();

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
    const value = normalizeAuthoredTextFieldConfiguration(configuration);
    if (value.html) authoredHtmlFields.add(field);
    else authoredHtmlFields.delete(field);
    const previousBinding = authoredFontBindings.get(field);
    let fontBinding: AuthoredTextFontBinding | undefined;
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
    applyAuthoredFilters(field, createAuthoredFilters(value.filters ?? []));
    // Initial authored text obeys the same subset-font boundary as a locale
    // update. A non-outlined DefineEditText can retain embedded metrics for
    // covered glyphs while relying on the device/browser face for a missing
    // glyph already present in its source markup.
    applyAuthoredLocaleText(field, value.initialText);
    return field;
}

export function releaseAuthoredTextFieldFontBinding(field: TextField): void {
    authoredFontBindings.get(field)?.cancel();
    authoredFontBindings.delete(field);
    authoredHtmlFields.delete(field);
}

/**
 * Applies a locale sidecar string without making an English embedded font a
 * false full-Unicode authority. Fields whose selected authored face covers
 * the localized text keep their exact metrics; only a field with a missing
 * visible glyph returns to the device/browser font providers.
 */
export function applyAuthoredLocaleText(field: TextField, text: string): void {
    if (!(field instanceof TextField) || field.destroyed)
        throw new TypeError("Authored locale text target must be a live TextField");
    if (typeof text !== "string") throw new TypeError("Authored locale text must be a string");
    const html = authoredHtmlFields.has(field);
    const visibleText = html ? parseRestrictedFlashHtmlText(text).plainText : text;
    const binding = authoredFontBindings.get(field);
    if (binding?.active) {
        const format = field.defaultTextFormat;
        if (!binding.hasGlyphs(visibleText, format.font ?? "", format.bold === true, format.italic === true)) {
            binding.cancel();
            authoredFontBindings.delete(field);
            field.embedFonts = false;
        }
    }
    if (html) field.htmlText = text;
    else field.text = text;
}

export function createAuthoredGlowFilters(value: unknown): GlowFilter[] {
    if (!Array.isArray(value)) throw new TypeError("Authored glow filters must be an array");
    return value.map((candidate, index) => validateGlowFilter(candidate, `filters[${index}]`)).map(filter => new GlowFilter(
        filter.color, filter.alpha, filter.blurX, filter.blurY, filter.strength,
        filter.quality, filter.inner, filter.knockout,
    ));
}

export function createAuthoredFilters(value: unknown): Filter[] {
    if (!Array.isArray(value)) throw new TypeError("Authored filters must be an array");
    return value.map((candidate, index) => validateAuthoredFilter(candidate, `filters[${index}]`)).map(filter =>
        filter.kind === "blur"
            ? new BlurFilter(filter.blurX, filter.blurY, filter.quality)
            : filter.kind === "color-matrix"
            ? new ColorMatrixFilter(filter.matrix)
            : filter.kind === "glow"
            ? new GlowFilter(filter.color, filter.alpha, filter.blurX, filter.blurY, filter.strength,
                filter.quality, filter.inner, filter.knockout)
            : filter.kind === "drop-shadow"
            ? new DropShadowFilter(filter.distance, filter.angleRadians * 180 / Math.PI,
                filter.color, filter.alpha, filter.blurX, filter.blurY, filter.strength,
                filter.quality, filter.inner, filter.knockout, filter.hideObject)
            : filter.kind === "bevel"
            ? createFlashAuthoredBevelFilter(filter)
            : filter.kind === "gradient-bevel"
            ? new GradientBevelFilter(filter.distance, filter.angleRadians * 180 / Math.PI,
                filter.colors, filter.alphas, filter.ratios, filter.blurX, filter.blurY,
                filter.strength, filter.quality, filter.type, filter.knockout)
            : new GradientGlowFilter(filter.distance, filter.angleRadians * 180 / Math.PI,
                filter.colors, filter.alphas, filter.ratios, filter.blurX, filter.blurY,
                filter.strength, filter.quality, filter.type, filter.knockout));
}

export function applyAuthoredFilters(target: import("../../../layaAir/flash").DisplayObject, filters: Filter[]): void {
    if (filters.every((filter): filter is BitmapFilter => isBitmapFilter(filter))) {
        target.filters = filters;
        return;
    }
    setDisplayObjectNativeFilters(target, filters);
}

export function normalizeAuthoredTextFieldConfiguration(
    value: AuthoredTextFieldConfiguration,
): AuthoredTextFieldConfiguration {
    if (typeof value === "object" && value !== null && normalizedAuthoredTextConfigurations.has(value))
        return value;
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
    const embeddedFont = format.embeddedFont === undefined
        ? undefined
        : validateEmbeddedFont(format.embeddedFont, format.font);
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
        const layout = parseRestrictedFlashHtmlText(record.initialText, {
            align: oneOfValue(format.align,
                [TextFormatAlign.LEFT, TextFormatAlign.CENTER, TextFormatAlign.RIGHT, TextFormatAlign.JUSTIFY] as const,
                "format.align"),
            font: format.font,
            size: format.size,
            color: format.color,
            letterSpacing: hasLetterSpacing ? format.letterSpacing as number : 0,
            kerning: hasKerning ? format.kerning as boolean : false,
            bold: format.bold,
        });
        if (layout.font !== format.font || layout.size !== format.size || layout.color !== format.color
            || layout.align !== format.align
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
    const normalized = Object.freeze({
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
    normalizedAuthoredTextConfigurations.add(normalized);
    return normalized;
}

function validateEmbeddedFont(value: unknown, fontName: unknown): AuthoredEmbeddedFontConfiguration {
    if (hasOwnDataProperty(value, "kind")) {
        const reference = exactDataObject(value, EMBEDDED_FONT_REFERENCE_KEYS, "Authored embedded font reference");
        equal(reference.kind, "published-font-reference@1", "embeddedFont.kind");
        nonemptyString(reference.documentId, "embeddedFont.documentId");
        nonemptyString(reference.resourceId, "embeddedFont.resourceId");
        sha256(reference.sourceSha256, "embeddedFont.sourceSha256");
        positiveInteger(reference.fontId, "embeddedFont.fontId");
        const fontStyle = oneOfValue(
            reference.fontStyle,
            ["regular", "bold", "italic", "boldItalic"] as const,
            "embeddedFont.fontStyle",
        );
        nonemptyString(fontName, "format.font");
        const authority = AuthoredFontRegistry.resolvePublishedFont({
            documentId: reference.documentId,
            fontId: reference.fontId,
            fontName,
            fontStyle,
            sourceSha256: reference.sourceSha256,
        });
        return Object.freeze({
            documentId: authority.documentId,
            resourceId: reference.resourceId,
            sourceSha256: authority.sourceSha256,
            fontId: authority.fontId,
            fontType: "embedded",
            fontStyle: authority.fontStyle,
            unitsPerEm: authority.unitsPerEm,
            ascent: authority.ascent,
            descent: authority.descent,
            leading: authority.leading,
            glyphs: authority.glyphs,
            kerning: authority.kerning,
            alignZones: authority.alignZones,
        });
    }
    if (hasOwnDataProperty(value, "documentId") && !hasOwnDataProperty(value, "fontType")) {
        const reference = exactDataObject(value, LEGACY_EMBEDDED_FONT_REFERENCE_KEYS, "Legacy authored embedded font reference");
        nonemptyString(reference.documentId, "embeddedFont.documentId");
        sha256(reference.sourceSha256, "embeddedFont.sourceSha256");
        positiveInteger(reference.fontId, "embeddedFont.fontId");
        const fontStyle = oneOfValue(
            reference.fontStyle,
            ["regular", "bold", "italic", "boldItalic"] as const,
            "embeddedFont.fontStyle",
        );
        nonemptyString(fontName, "format.font");
        const authority = AuthoredFontRegistry.resolvePublishedFont({
            documentId: reference.documentId,
            fontId: reference.fontId,
            fontName,
            fontStyle,
            sourceSha256: reference.sourceSha256,
        });
        return Object.freeze({
            documentId: authority.documentId,
            resourceId: authority.sourceUrl,
            sourceSha256: authority.sourceSha256,
            fontId: authority.fontId,
            fontType: "embedded",
            fontStyle: authority.fontStyle,
            unitsPerEm: authority.unitsPerEm,
            ascent: authority.ascent,
            descent: authority.descent,
            leading: authority.leading,
            glyphs: authority.glyphs,
            kerning: authority.kerning,
            alignZones: authority.alignZones,
        });
    }
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
    const table = validateFontAlignZoneTableHint(record.tableHint, record.tableHintName);
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
    return Object.freeze({ ...table, zones: Object.freeze(zones) });
}

function validateFontAlignZoneTableHint(
    value: unknown, name: unknown,
): Pick<AuthoredFontAlignZonesConfiguration, "tableHint" | "tableHintName"> {
    if (value === 0 && name === "thin") return { tableHint: 0, tableHintName: "thin" };
    if (value === 1 && name === "medium") return { tableHint: 1, tableHintName: "medium" };
    if (value === 2 && name === "thick") return { tableHint: 2, tableHintName: "thick" };
    throw new TypeError("embeddedFont.alignZones must retain a matching thin, medium, or thick table hint");
}

function validateRasterization(value: unknown): AuthoredAdvancedTextRasterizationConfiguration {
    const record = exactDataObject(value, RASTERIZATION_KEYS, "Authored advanced rasterization");
    equal(record.antiAliasType, AntiAliasType.ADVANCED, "rasterization.antiAliasType");
    const gridFitType = oneOfValue(
        record.gridFitType,
        [GridFitType.NONE, GridFitType.PIXEL, GridFitType.SUBPIXEL] as const,
        "rasterization.gridFitType",
    );
    range(record.sharpness, -400, 400, "rasterization.sharpness");
    range(record.thickness, -200, 200, "rasterization.thickness");
    return Object.freeze({
        antiAliasType: "advanced", gridFitType,
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
    const kind = value !== null && typeof value === "object" ? Reflect.get(value, "kind") : undefined;
    if (kind === "blur") {
        const record = exactDataObject(value, ["blurX", "blurY", "kind", "quality"], label);
        equal(record.kind, "blur", `${label}.kind`);
        range(record.blurX, 0, 255, `${label}.blurX`);
        range(record.blurY, 0, 255, `${label}.blurY`);
        integerRange(record.quality, 1, 15, `${label}.quality`);
        return Object.freeze({ kind: "blur", blurX: record.blurX, blurY: record.blurY, quality: record.quality });
    }
    if (kind === "color-matrix")
        return validateColorMatrixFilter(value, label);
    if (kind === "bevel") return validateBevelFilter(value, label);
    if (kind === "gradient-bevel" || kind === "gradient-glow")
        return validateGradientFilter(value, label, kind);
    if (kind === "drop-shadow") return validateDropShadowFilter(value, label);
    return validateGlowFilter(value, label);
}

function validateBevelFilter(value: unknown, label: string): AuthoredBevelFilterConfiguration {
    const record = exactDataObject(value, BEVEL_FILTER_KEYS, label);
    equal(record.kind, "bevel", `${label}.kind`);
    equal(record.sourceType, "BEVELFILTER", `${label}.sourceType`);
    range(record.distance, -32768, 32767.99998474121, `${label}.distance`);
    range(record.angleRadians, -32768, 32767.99998474121, `${label}.angleRadians`);
    integerRange(record.highlightColor, 0, 0xffffff, `${label}.highlightColor`);
    range(record.highlightAlpha, 0, 1, `${label}.highlightAlpha`);
    integerRange(record.shadowColor, 0, 0xffffff, `${label}.shadowColor`);
    range(record.shadowAlpha, 0, 1, `${label}.shadowAlpha`);
    range(record.blurX, 0, 255, `${label}.blurX`);
    range(record.blurY, 0, 255, `${label}.blurY`);
    range(record.strength, 0, 255.99609375, `${label}.strength`);
    integerRange(record.passes, 0, 15, `${label}.passes`);
    boolean(record.innerShadow, `${label}.innerShadow`);
    boolean(record.onTop, `${label}.onTop`);
    boolean(record.knockout, `${label}.knockout`);
    boolean(record.compositeSource, `${label}.compositeSource`);
    return Object.freeze({
        kind: "bevel", sourceType: "BEVELFILTER", distance: record.distance,
        angleRadians: record.angleRadians, highlightColor: record.highlightColor,
        highlightAlpha: record.highlightAlpha, shadowColor: record.shadowColor,
        shadowAlpha: record.shadowAlpha, blurX: record.blurX, blurY: record.blurY,
        strength: record.strength, passes: record.passes, innerShadow: record.innerShadow,
        onTop: record.onTop, knockout: record.knockout, compositeSource: record.compositeSource,
    });
}

function validateDropShadowFilter(value: unknown, label: string): AuthoredDropShadowFilterConfiguration {
    const record = exactDataObject(value, DROP_SHADOW_FILTER_KEYS, label);
    equal(record.kind, "drop-shadow", `${label}.kind`);
    finite(record.distance, `${label}.distance`);
    finite(record.angleRadians, `${label}.angleRadians`);
    integerRange(record.color, 0, 0xffffff, `${label}.color`);
    range(record.alpha, 0, 1, `${label}.alpha`);
    range(record.blurX, 0, 255, `${label}.blurX`);
    range(record.blurY, 0, 255, `${label}.blurY`);
    range(record.strength, 0, 255, `${label}.strength`);
    integerRange(record.quality, 1, 15, `${label}.quality`);
    boolean(record.inner, `${label}.inner`);
    boolean(record.knockout, `${label}.knockout`);
    boolean(record.hideObject, `${label}.hideObject`);
    return Object.freeze({
        kind: "drop-shadow", distance: record.distance, angleRadians: record.angleRadians,
        color: record.color, alpha: record.alpha, blurX: record.blurX, blurY: record.blurY,
        strength: record.strength, quality: record.quality, inner: record.inner,
        knockout: record.knockout, hideObject: record.hideObject,
    });
}

function validateColorMatrixFilter(value: unknown, label: string): AuthoredColorMatrixFilterConfiguration {
    const record = exactDataObject(value, COLOR_MATRIX_FILTER_KEYS, label);
    equal(record.kind, "color-matrix", `${label}.kind`);
    if (!Array.isArray(record.matrix) || record.matrix.length !== 20)
        throw new TypeError(`${label}.matrix must contain exactly 20 values`);
    const matrix = record.matrix.map((candidate, index) => {
        finite(candidate, `${label}.matrix[${index}]`);
        return candidate;
    });
    return Object.freeze({ kind: "color-matrix", matrix: Object.freeze(matrix) });
}
function validateGradientFilter(
    value: unknown,
    label: string,
    kind: "gradient-bevel" | "gradient-glow",
): AuthoredGradientBevelFilterConfiguration | AuthoredGradientGlowFilterConfiguration {
    const record = exactDataObject(value, [
        "alphas", "angleRadians", "blurX", "blurY", "colors", "compositeSource", "distance", "kind",
        "knockout", "quality", "ratios", "strength", "type",
    ], label);
    equal(record.kind, kind, `${label}.kind`);
    const colors = numberArray(record.colors, `${label}.colors`, 0, 0xffffff, true);
    const alphas = numberArray(record.alphas, `${label}.alphas`, 0, 1, false);
    const ratios = numberArray(record.ratios, `${label}.ratios`, 0, 255, true);
    if (colors.length < 2 || colors.length !== alphas.length || colors.length !== ratios.length)
        throw new TypeError(`${label} requires matching color, alpha, and ratio arrays with at least two stops`);
    finite(record.distance, `${label}.distance`);
    finite(record.angleRadians, `${label}.angleRadians`);
    range(record.blurX, 0, 255, `${label}.blurX`);
    range(record.blurY, 0, 255, `${label}.blurY`);
    range(record.strength, 0, 255.99609375, `${label}.strength`);
    integerRange(record.quality, 0, 15, `${label}.quality`);
    const type = record.type;
    if (type !== "inner" && type !== "outer" && type !== "full")
        throw new TypeError(`${label}.type has an unsupported value`);
    boolean(record.knockout, `${label}.knockout`);
    equal(record.compositeSource, true, `${label}.compositeSource`);
    return Object.freeze({
        kind,
        distance: record.distance,
        angleRadians: record.angleRadians,
        colors: Object.freeze(colors),
        alphas: Object.freeze(alphas),
        ratios: Object.freeze(ratios),
        blurX: record.blurX,
        blurY: record.blurY,
        strength: record.strength,
        quality: record.quality,
        type,
        knockout: record.knockout,
        compositeSource: true,
    });
}

function numberArray(value: unknown, label: string, minimum: number, maximum: number, integer: boolean): number[] {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value.map((candidate, index) => {
        finite(candidate, `${label}[${index}]`);
        if (candidate < minimum || candidate > maximum || integer && !Number.isInteger(candidate))
            throw new RangeError(`${label}[${index}] is outside its serialized range`);
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
