import { GlowFilter, TextField, TextFieldAutoSize, TextFieldType, TextFormat, TextFormatAlign } from "../../../layaAir/flash";

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

export interface AuthoredTextFormatConfiguration {
    readonly fontMode: "device";
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
    readonly html: false;
    readonly gutter: 2;
    readonly overflow: "hidden";
    readonly initialText: string;
    readonly format: AuthoredTextFormatConfiguration;
    /** Omitted by native bundles emitted before authored filter admission. */
    readonly filters?: ReadonlyArray<AuthoredGlowFilterConfiguration>;
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
const GLOW_FILTER_KEYS = Object.freeze([
    "alpha", "blurX", "blurY", "color", "inner", "kind", "knockout", "quality", "strength",
]);

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
    field.embedFonts = false;
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
    field.text = value.initialText;
    return field;
}

export function createAuthoredGlowFilters(value: unknown): GlowFilter[] {
    if (!Array.isArray(value)) throw new TypeError("Authored glow filters must be an array");
    return value.map((candidate, index) => validateGlowFilter(candidate, `filters[${index}]`)).map(filter => new GlowFilter(
        filter.color, filter.alpha, filter.blurX, filter.blurY, filter.strength,
        filter.quality, filter.inner, filter.knockout,
    ));
}

function validateConfiguration(value: AuthoredTextFieldConfiguration): AuthoredTextFieldConfiguration {
    const hasFilters = value !== null && typeof value === "object"
        && Object.prototype.hasOwnProperty.call(value, "filters");
    const record = exactDataObject(
        value,
        hasFilters ? [...FIELD_KEYS, "filters"] : FIELD_KEYS,
        "Authored TextField configuration",
    );
    const rawFormat = record.format;
    const hasLetterSpacing = hasOwnDataProperty(rawFormat, "letterSpacing");
    const hasKerning = hasOwnDataProperty(rawFormat, "kerning");
    if (hasLetterSpacing !== hasKerning)
        throw new TypeError("Authored TextField format must provide letterSpacing and kerning together");
    const format = exactDataObject(rawFormat, hasLetterSpacing ? EXTENDED_FORMAT_KEYS : FORMAT_KEYS, "Authored TextField format");
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
    equal(record.html, false, "html");
    equal(record.gutter, 2, "gutter");
    equal(record.overflow, "hidden", "overflow");
    string(record.initialText, "initialText");
    if (record.filters !== undefined && !Array.isArray(record.filters)) throw new TypeError("filters must be an array");
    const filters = (record.filters === undefined ? [] : record.filters as unknown[])
        .map((filter, index) => validateGlowFilter(filter, `filters[${index}]`));

    equal(format.fontMode, "device", "format.fontMode");
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
    const normalizedFormat: AuthoredTextFormatConfiguration = Object.freeze({
        fontMode: exactValue(format.fontMode, "device", "format.fontMode"),
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
        html: exactValue(record.html, false, "html"),
        gutter: exactValue(record.gutter, 2, "gutter"),
        overflow: exactValue(record.overflow, "hidden", "overflow"),
        initialText: record.initialText,
        format: normalizedFormat,
        filters: Object.freeze(filters),
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
