import { Input as LayaInput, setInputEventOwner, type InputSelectionDirection } from "../../laya/display/Input";
import { runAdmittedNodeMutation } from "../../laya/display/NodeMutationTransaction";
import {
    Text as LayaText,
    type ITextCmd,
    type ITextLine,
    type TextAdvanceProvider,
    type TextFontFamilyResolver,
    type TextFontMetricsProvider,
} from "../../laya/display/Text";
import { Event as LayaEvent } from "../../laya/events/Event";
import { HtmlParseOptions } from "../../laya/html/HtmlParseOptions";
import { Point as LayaPoint } from "../../laya/maths/Point";
import { PAL } from "../../laya/platform/PlatformAdapters";
import { readTextCompositionPayload } from "../../laya/platform/TextInputAdapter";
import { Browser } from "../../laya/utils/Browser";
import type { TextRasterizationSettings } from "../../laya/webgl/text/TextRasterizationSettings";
import { DisplayObject } from "../display/DisplayObject";
import { InteractiveObject } from "../display/InteractiveObject";
import { IMEEvent } from "../events/IMEEvent";
import { Event as FlashEvent } from "../events/Event";
import { Rectangle } from "../geom/Rectangle";
import {
    AntiAliasType,
    FontStyle,
    GridFitType,
    TextColorType,
    TextFieldAutoSize,
    TextFieldType,
    TextFormat,
    TextFormatAlign,
    TextLineMetrics,
    TextRenderer,
    isFlashTextFormat,
} from "./TextFormat";

const TEXT_FIELD_VALUES = new WeakSet<object>();
const destroyCanonicalTextField = InteractiveObject.prototype.destroy;

/** @internal Read-only nominal proof for canonical Flash text fields. */
export function isFlashTextField(value: unknown): value is TextField {
    return typeof value === "object" && value !== null && TEXT_FIELD_VALUES.has(value);
}

interface FlashLineRecord {
    line: ITextLine;
    offset: number;
    length: number;
    visibleLength: number;
    text: string;
}

/**
 * Renderer/input primitive hidden behind the genuine Flash display identity.
 * Protected Laya text state remains contained in this implementation detail.
 */
class NativeFlashTextInput extends LayaInput {
    private _flashPlainText = "";
    flashParagraphFormatProvider: ((sourceOffset: number) => TextFormat | null) | null = null;

    constructor() {
        super();
        this._onPostLayout = () => this.applyFlashParagraphLayout();
    }

    override get text(): string {
        if (this.focus) PAL.textInput.syncText();
        return this._flashPlainText;
    }

    override set text(value: string) {
        const plain = normalizeText(value);
        this._flashPlainText = plain;
        this.html = false;
        this.assignLayoutText(plain);
    }

    setFlashContent(plain: string, layout: string, html: boolean): void {
        this._flashPlainText = plain;
        if (this.focus) {
            PAL.textInput.setText(plain);
            return;
        }
        this.html = html;
        this.assignLayoutText(layout);
    }

    get flashKerning(): boolean { return this._textStyle.kerning; }
    set flashKerning(value: boolean) {
        if (this._textStyle.kerning === value) return;
        this._textStyle.kerning = value;
        this.markChanged();
    }

    /** Flash metric and scroll getters are synchronous even before the next frame. */
    ensureFlashLayout(): void {
        if (this._isChanged) this._typeset();
    }

    setFlashLineScroll(y: number): void {
        this.ensureFlashLayout();
        if (this.maxScrollY <= 0) return;
        this._scrollPos ??= new LayaPoint();
        this._scrollPos.y = Math.max(0, y);
        this.renderText();
    }

    protected override renderText(): void {
        let renderHeight: number | null = null;
        let expandedLineIndex = -1;
        if (!this.autoSize && this.overflow !== LayaText.VISIBLE) {
            const topPadding = this.padding[0] ?? 0;
            const bottomPadding = this.padding[2] ?? 0;
            const viewport = Math.max(0, this._height - topPadding - bottomPadding);
            const scrollY = this._scrollPos?.y ?? 0;
            for (let lineIndex = 0; lineIndex < this.lines.length; lineIndex++) {
                const line = this.lines[lineIndex];
                const lineTop = line.y - scrollY;
                if (lineTop + line.height <= 0) continue;
                if (lineTop >= viewport) break;
                let fontSize = this.fontSize;
                for (let command = line.cmd; command; command = command.next)
                    fontSize = Math.max(fontSize, command.fontSize || 0);
                const lineHeight = fontSize + 4;
                if (lineTop + lineHeight > viewport) {
                    // Flash counts its four-pixel gutter in the line extent. Laya's content viewport
                    // already removed that padding, so use the full authored height for admission.
                    const fitsFlashBounds = lineTop + lineHeight <= this._height;
                    renderHeight = fitsFlashBounds
                        ? topPadding + lineTop + lineHeight + bottomPadding
                        : topPadding + lineTop + bottomPadding;
                    if (fitsFlashBounds) expandedLineIndex = lineIndex;
                    break;
                }
            }
        }
        if (renderHeight == null) {
            super.renderText();
            return;
        }
        const authoredHeight = this._height;
        const firstHiddenLine = expandedLineIndex + 1;
        const hiddenLineY = expandedLineIndex < 0
            ? [] : this._lines.slice(firstHiddenLine).map(line => line.y);
        this._height = renderHeight;
        if (expandedLineIndex >= 0) {
            const hiddenY = renderHeight + (this._scrollPos?.y ?? 0);
            for (let index = firstHiddenLine; index < this._lines.length; index++)
                this._lines[index].y = hiddenY;
        }
        try { super.renderText(); }
        finally {
            this._height = authoredHeight;
            if (expandedLineIndex >= 0) {
                for (let index = firstHiddenLine; index < this._lines.length; index++)
                    this._lines[index].y = hiddenLineY[index - firstHiddenLine];
            }
        }
    }

    private assignLayoutText(value: string): void {
        const multiline = this._multiline;
        this._multiline = true;
        try { super.text = value; }
        finally { this._multiline = multiline; }
    }

    private applyFlashParagraphLayout(): void {
        const provider = this.flashParagraphFormatProvider;
        if (!provider || !this.lines.length) return;
        const firstFormat = provider(0);
        if (!firstFormat) return;
        const padding = this.padding;
        const contentWidth = Math.max(0, this._width - padding[1] - padding[3]);
        let sourceOffset = 0;
        let lineY = 0;
        let maximumRight = 0;
        for (let lineIndex = 0; lineIndex < this.lines.length; lineIndex++) {
            const line = this.lines[lineIndex];
            let visibleLength = 0;
            for (let command = line.cmd; command; command = command.next)
                visibleLength += command.text?.length ?? 0;
            const format = lineIndex === 0 ? firstFormat : provider(sourceOffset) ?? firstFormat;
            const paragraphStart = sourceOffset === 0 || this._flashPlainText.charAt(sourceOffset - 1) === "\r";
            const leftMargin = Math.max(0, format.leftMargin ?? 0);
            const rightMargin = Math.max(0, format.rightMargin ?? 0);
            const blockIndent = Math.max(0, format.blockIndent ?? 0);
            const indent = paragraphStart ? format.indent ?? 0 : 0;
            const left = Math.max(0, leftMargin + blockIndent + indent);
            const available = Math.max(0, contentWidth - left - rightMargin);
            const align = format.align ?? TextFormatAlign.LEFT;
            const aligned = align === TextFormatAlign.CENTER ? Math.max(0, (available - line.width) / 2)
                : align === TextFormatAlign.RIGHT || align === TextFormatAlign.END
                    ? Math.max(0, available - line.width) : 0;
            line.align = TextFormatAlign.LEFT;
            line.x = Math.floor(left + aligned);
            line.y = lineY;
            line.leading = format.leading ?? this.leading;
            lineY += line.height + line.leading;
            maximumRight = Math.max(maximumRight, line.x + line.width + rightMargin);
            sourceOffset += visibleLength;
            if (this._flashPlainText.charAt(sourceOffset) === "\r") sourceOffset++;
        }
        const last = this.lines[this.lines.length - 1];
        this._textWidth = maximumRight > 0 ? maximumRight + padding[1] + padding[3] : 0;
        this._textHeight = last ? last.y + last.height + padding[0] + padding[2] : 0;
    }
}

/**
 * Genuine Flash display hierarchy with a composed native Laya Input. The
 * outer object owns source-visible identity; the inner object owns layout,
 * browser input, selection, metrics, HTML parsing, and glyph rasterization.
 */
export class TextField extends InteractiveObject {
    private readonly _nativeInput = new NativeFlashTextInput();
    private _background = false;
    private _backgroundColor = 0xffffff;
    private _border = false;
    private _borderColor = 0x000000;
    private _flashType = TextFieldType.DYNAMIC;
    private _flashAutoSize = TextFieldAutoSize.NONE;
    private _embedFonts = false;
    private _antiAliasType = AntiAliasType.NORMAL;
    private _gridFitType = GridFitType.PIXEL;
    private _sharpness = 0;
    private _thickness = 0;
    private _displayAsPassword = false;
    private _focusRequested = false;
    private _programmaticTextWrite = false;
    private _condenseWhite = false;
    private _plainText = "";
    private _htmlText = "";
    private _contentHasHtmlLayout = false;
    private _characterFormats: TextFormat[] | null = null;
    private _defaultFormat = new TextFormat();
    private _defaultFormatInitialized = false;
    private _nativeInputSession: {
        lastText: string;
        dirtyGeneration: number;
        dispatchedGeneration: number;
    } | null = null;

    constructor() {
        super();
        TEXT_FIELD_VALUES.add(this);
        this._nativeInput.name = "__flashTextInput";
        this._nativeInput.mouseEnabled = true;
        this._nativeInput.type = LayaInput.TYPE_TEXT;
        this._nativeInput.editable = false;
        this._nativeInput.padding = [2, 2, 2, 2];
        this._nativeInput.overflow = LayaText.HIDDEN;
        this._nativeInput.valign = "top";
        this._nativeInput.flashParagraphFormatProvider = offset => {
            if (this._characterFormats) return cloneFormat(this._characterFormats[offset] ?? this._currentFormat());
            return this._htmlText === flashTextToHtml(this._plainText) ? cloneFormat(this._currentFormat()) : null;
        };
        this.addChild(this._nativeInput);
        super.size(100, 20);
        this._nativeInput.size(100, 20);
        setInputEventOwner(this._nativeInput, this);
        this._forwardNative(LayaEvent.FOCUS);
        this._forwardNative(LayaEvent.BLUR);
        this._forwardNative(LayaEvent.BEFORE_INPUT);
        this._nativeInput.on(LayaEvent.CHANGE, this, (value: unknown) => {
            if (this._programmaticTextWrite) return;
            const session = this._nativeInputSession;
            this._observeNativeTextMutation();
            queueMicrotask(() => {
                if (this._nativeInputSession === session) this._flushNativeTextChange(value);
            });
        });
        this._nativeInput.on(LayaEvent.INPUT, this, (value: unknown) => {
            this._observeNativeTextMutation();
            this._flushNativeTextChange(value);
        });
        this._nativeInput.on(LayaEvent.COMPOSITION_START, this,
            (value: unknown) => this._dispatchNativeIme("start", value));
        this._nativeInput.on(LayaEvent.COMPOSITION_UPDATE, this,
            (value: unknown) => this.event(LayaEvent.COMPOSITION_UPDATE, value));
        this._nativeInput.on(LayaEvent.COMPOSITION_END, this,
            (value: unknown) => this._dispatchNativeIme("end", value));
        this._syncChrome();
    }

    get text(): string {
        if (this.focus) this._observeNativeTextMutation();
        return this._plainText;
    }
    set text(value: string) {
        if (typeof value !== "string") throw new TypeError("TextField.text must be a string");
        this._captureDefaultFormat();
        const plain = normalizeText(value);
        this._plainText = plain;
        this._htmlText = flashTextToHtml(plain);
        this._characterFormats = null;
        this._applyFormat(this._defaultFormat);
        const linkedLayout = this._defaultFormat.url ? formatHtmlSegment(plain, this._defaultFormat) : plain;
        this._writeNativeContent(plain, linkedLayout, this._defaultFormat.url != null);
    }

    get htmlText(): string {
        if (this.focus) this._observeNativeTextMutation();
        return this._htmlText;
    }
    set htmlText(value: string) {
        if (typeof value !== "string") throw new TypeError("TextField.htmlText must be a string");
        this._captureDefaultFormat();
        this._htmlText = value;
        this._plainText = flashHtmlToText(value, this._condenseWhite);
        this._characterFormats = null;
        this._writeNativeContent(this._plainText, flashHtmlForLaya(value, this._condenseWhite), true);
    }

    get defaultTextFormat(): TextFormat { return cloneFormat(this._currentFormat()); }
    set defaultTextFormat(value: TextFormat) {
        requireTextFormat(value, "TextField.defaultTextFormat");
        this._defaultFormat = mergeFormat(this._currentFormat(), value);
        this._defaultFormatInitialized = true;
    }

    /** Flash TextField.textColor, applied to both existing and future text. */
    get textColor(): number { return this._currentFormat().color ?? 0; }
    set textColor(value: number) {
        const color = Number(value) >>> 0;
        const format = new TextFormat(null, null, color);
        this._captureDefaultFormat();
        this._defaultFormat.color = color;
        if (this.length) this.setTextFormat(format);
        else this._applyFormat(format);
    }

    /** Flash TextField background chrome, rendered by the composed native input. */
    get background(): boolean { return this._background; }
    set background(value: boolean) {
        this._background = !!value;
        this._syncChrome();
    }

    get backgroundColor(): number { return this._backgroundColor; }
    set backgroundColor(value: number) {
        this._backgroundColor = Number(value) >>> 0;
        if (this._background) this._syncChrome();
    }

    /** Flash TextField one-pixel border chrome, independent from background state. */
    get border(): boolean { return this._border; }
    set border(value: boolean) {
        this._border = !!value;
        this._syncChrome();
    }

    get borderColor(): number { return this._borderColor; }
    set borderColor(value: number) {
        this._borderColor = Number(value) >>> 0;
        if (this._border) this._syncChrome();
    }

    get displayAsPassword(): boolean { return this._displayAsPassword; }
    set displayAsPassword(value: boolean) {
        this._displayAsPassword = !!value;
        this._nativeInput.type = this._displayAsPassword ? LayaInput.TYPE_PASSWORD : LayaInput.TYPE_TEXT;
    }

    get embedFonts(): boolean { return this._embedFonts; }
    set embedFonts(value: boolean) { this._embedFonts = !!value; this._refreshAdvancedRasterization(); }

    get antiAliasType(): string { return this._antiAliasType; }
    set antiAliasType(value: string) {
        if (value !== AntiAliasType.NORMAL && value !== AntiAliasType.ADVANCED)
            throw new TypeError(`Invalid AntiAliasType '${value}'`);
        this._antiAliasType = value;
        this._refreshAdvancedRasterization();
    }

    get gridFitType(): string { return this._gridFitType; }
    set gridFitType(value: string) {
        if (![GridFitType.NONE, GridFitType.PIXEL, GridFitType.SUBPIXEL].includes(value))
            throw new TypeError(`Invalid GridFitType '${value}'`);
        this._gridFitType = value;
        this._refreshAdvancedRasterization();
    }

    get sharpness(): number { return this._sharpness; }
    set sharpness(value: number) {
        this._sharpness = Math.max(-400, Math.min(400, finiteNumber(value, 0)));
        this._refreshAdvancedRasterization();
    }

    get thickness(): number { return this._thickness; }
    set thickness(value: number) {
        this._thickness = Math.max(-200, Math.min(200, finiteNumber(value, 0)));
        this._refreshAdvancedRasterization();
    }

    /** Flash TextField.autoSize rewrite target; never use inherited Sprite.autoSize. */
    get flashAutoSize(): string { return this._flashAutoSize; }
    set flashAutoSize(value: string) {
        if (![TextFieldAutoSize.NONE, TextFieldAutoSize.LEFT, TextFieldAutoSize.CENTER, TextFieldAutoSize.RIGHT].includes(value))
            throw new TypeError(`Invalid TextFieldAutoSize '${value}'`);
        this._flashAutoSize = value;
        this._syncAutoSizeBounds();
    }

    get condenseWhite(): boolean { return this._condenseWhite; }
    set condenseWhite(value: boolean) {
        this._condenseWhite = !!value;
        const options = this._nativeInput.htmlParseOptions ?? new HtmlParseOptions();
        options.ignoreWhiteSpace = this._condenseWhite;
        this._nativeInput.htmlParseOptions = options;
    }

    get editable(): boolean { return this._nativeInput.editable; }
    set editable(value: boolean) { this._nativeInput.editable = !!value; }

    override get mouseEnabled(): boolean { return super.mouseEnabled; }
    override set mouseEnabled(value: boolean) {
        super.mouseEnabled = !!value;
        if (this._nativeInput) this._nativeInput.mouseEnabled = super.mouseEnabled;
    }

    get restrict(): string | null { return this._nativeInput.restrict ?? null; }
    set restrict(value: string | null) {
        if (value !== null && typeof value !== "string")
            throw new TypeError("TextField.restrict must be a string or null");
        this._nativeInput.restrict = value;
    }

    get maxChars(): number { return this._nativeInput.maxChars; }
    set maxChars(value: number) {
        if (!Number.isInteger(value) || value < 0)
            throw new TypeError("TextField.maxChars must be a nonnegative integer");
        this._nativeInput.maxChars = value;
    }

    get multiline(): boolean { return this._nativeInput.multiline; }
    set multiline(value: boolean) { this._nativeInput.multiline = !!value; this._nativeInput.valign = "top"; }

    get wordWrap(): boolean { return this._nativeInput.wordWrap; }
    set wordWrap(value: boolean) { this._nativeInput.wordWrap = !!value; }

    get selectable(): boolean { return this._nativeInput.selectable; }
    set selectable(value: boolean) { this._nativeInput.selectable = !!value; }

    /** @internal Canonical native authored-font metrics seam. */
    get fontMetricsProvider(): TextFontMetricsProvider { return this._nativeInput.fontMetricsProvider; }
    set fontMetricsProvider(value: TextFontMetricsProvider) { this._nativeInput.fontMetricsProvider = value; }

    /** @internal Canonical native authored-font family seam. */
    get fontFamilyResolver(): TextFontFamilyResolver { return this._nativeInput.fontFamilyResolver; }
    set fontFamilyResolver(value: TextFontFamilyResolver) { this._nativeInput.fontFamilyResolver = value; }

    /** @internal Canonical native authored-font advance seam. */
    get textAdvanceProvider(): TextAdvanceProvider { return this._nativeInput.textAdvanceProvider; }
    set textAdvanceProvider(value: TextAdvanceProvider) { this._nativeInput.textAdvanceProvider = value; }

    get focus(): boolean { return this._focusRequested || this._nativeInput.focus; }
    set focus(value: boolean) {
        this._focusRequested = !!value;
        this._nativeInput.focus = this._focusRequested;
    }

    get selectionStart(): number { return this._nativeInput.selectionStart; }
    get selectionEnd(): number { return this._nativeInput.selectionEnd; }
    get selectionDirection(): InputSelectionDirection { return this._nativeInput.selectionDirection; }
    get selectionBeginIndex(): number { return this.selectionStart; }
    get selectionEndIndex(): number { return this.selectionEnd; }
    get caretIndex(): number { return this.selectionDirection === "backward" ? this.selectionStart : this.selectionEnd; }

    setSelection(startIndex: number, endIndex: number): void {
        const length = this._plainText.length;
        let begin = Math.max(0, Math.min(length, finiteInteger(startIndex, 0)));
        let end = Math.max(0, Math.min(length, finiteInteger(endIndex, 0)));
        if (begin > end) [begin, end] = [end, begin];
        this._nativeInput._setSelectionState(begin, end, "none");
        if (this.focus) PAL.textInput.setSelection(begin, end, "none");
    }

    get type(): string { return this._flashType; }
    set type(value: string) {
        if (value !== TextFieldType.DYNAMIC && value !== TextFieldType.INPUT)
            throw new TypeError("TextField.type must be TextFieldType.DYNAMIC or TextFieldType.INPUT");
        this._flashType = value;
        this.editable = value === TextFieldType.INPUT;
        this._nativeInput.type = this._displayAsPassword ? LayaInput.TYPE_PASSWORD : LayaInput.TYPE_TEXT;
    }

    get length(): number { return this.text.length; }
    get numLines(): number { this._nativeInput.ensureFlashLayout(); return this._nativeInput.lines.length; }
    get textWidth(): number {
        this._nativeInput.ensureFlashLayout();
        const width = this._nativeInput.textWidth;
        this._syncAutoSizeBounds();
        if (width <= 0) return 0;
        return Math.max(0, width - this._nativeInput.padding[1] - this._nativeInput.padding[3]);
    }
    get textHeight(): number {
        if (!this._plainText) return 0;
        this._nativeInput.ensureFlashLayout();
        const lines = this._nativeInput.lines;
        if (!lines.length) return 0;
        const metrics = lines.map(line => {
            let fontSize = this._nativeInput.fontSize;
            for (let command = line.cmd; command; command = command.next)
                fontSize = Math.max(fontSize, command.fontSize || 0);
            return { fontSize, leading: line.leading ?? this._nativeInput.leading };
        });
        const height = metrics.reduce((total, line, index) =>
            total + line.fontSize + (index === metrics.length - 1 ? 4 : line.leading), 0);
        this._syncAutoSizeBounds();
        return height;
    }

    get scrollH(): number { return Math.trunc(this._nativeInput.scrollX); }
    set scrollH(value: number) {
        const before = this.scrollH;
        this._nativeInput.scrollX = finiteInteger(value, 0);
        if (this.scrollH !== before) this.event(FlashEvent.SCROLL);
    }
    get maxScrollH(): number { this._nativeInput.ensureFlashLayout(); return Math.ceil(this._nativeInput.maxScrollX); }
    get scrollV(): number {
        this._nativeInput.ensureFlashLayout();
        const lines = this._nativeInput.lines;
        if (!lines.length) return 1;
        const index = lines.findIndex(line => line.y + line.height > this._nativeInput.scrollY);
        return (index < 0 ? lines.length - 1 : index) + 1;
    }
    set scrollV(value: number) {
        const before = this.scrollV;
        const target = Math.max(1, Math.min(this.maxScrollV, finiteInteger(value, 1)));
        this._nativeInput.setFlashLineScroll(this._nativeInput.lines[target - 1]?.y ?? 0);
        if (this.scrollV !== before) this.event(FlashEvent.SCROLL);
    }
    get maxScrollV(): number {
        this._nativeInput.ensureFlashLayout();
        const lines = this._nativeInput.lines;
        if (lines.length < 2 || this._nativeInput.maxScrollY <= 0) return 1;
        const padding = this._nativeInput.padding;
        const viewport = Math.max(0, this.height - padding[0] - padding[2]);
        const bottom = lines[lines.length - 1].y + lines[lines.length - 1].height;
        let first = lines.length - 1;
        while (first > 0 && bottom - lines[first - 1].y <= viewport) first--;
        return first + 1;
    }
    get bottomScrollV(): number {
        this._nativeInput.ensureFlashLayout();
        const lines = this._nativeInput.lines;
        if (!lines.length) return 1;
        const padding = this._nativeInput.padding;
        const bottom = this._nativeInput.scrollY + Math.max(0, this.height - padding[0] - padding[2]);
        let result = this.scrollV;
        for (let index = result - 1; index < lines.length; index++) {
            if (lines[index].y >= bottom) break;
            result = index + 1;
        }
        return result;
    }

    appendText(value: string): void {
        if (typeof value !== "string") throw new TypeError("TextField.appendText requires a string");
        const appended = normalizeText(value);
        if (!appended) return;
        const formats = this._ensureCharacterFormats();
        const insertion = cloneFormat(this.defaultTextFormat);
        this._plainText += appended;
        formats.push(...Array.from({ length: appended.length }, () => cloneFormat(insertion)));
        this._renderCharacterFormats();
    }

    replaceText(beginIndex: number, endIndex: number, newText: string): void {
        if (typeof newText !== "string") throw new TypeError("TextField.replaceText requires a string");
        const begin = Math.max(0, Math.min(this.length, finiteInteger(beginIndex, 0)));
        const end = Math.max(begin, Math.min(this.length, finiteInteger(endIndex, begin)));
        const replacement = normalizeText(newText);
        const formats = this._ensureCharacterFormats();
        const insertion = cloneFormat(formats[begin] ?? formats[Math.max(0, begin - 1)] ?? this.defaultTextFormat);
        this._plainText = this._plainText.slice(0, begin) + replacement + this._plainText.slice(end);
        formats.splice(begin, end - begin,
            ...Array.from({ length: replacement.length }, () => cloneFormat(insertion)));
        this._renderCharacterFormats();
    }

    replaceSelectedText(value: string): void {
        if (typeof value !== "string") throw new TypeError("TextField.replaceSelectedText requires a string");
        const replacement = normalizeText(value);
        const begin = this.selectionBeginIndex;
        const selectedThroughEnd = this.selectionEndIndex === this.length;
        this.replaceText(begin, this.selectionEndIndex, replacement);
        if (selectedThroughEnd && replacement.length)
            this.setTextFormat(this.defaultTextFormat, begin, begin + replacement.length);
        this.setSelection(begin + replacement.length, begin + replacement.length);
    }

    getTextFormat(beginIndex = -1, endIndex = -1): TextFormat {
        if (!this.length) return this.defaultTextFormat;
        const formats = this._ensureCharacterFormats();
        let begin = beginIndex < 0 ? 0 : Math.max(0, Math.min(this.length, finiteInteger(beginIndex, 0)));
        let end = endIndex < 0 ? this.length : Math.max(0, Math.min(this.length, finiteInteger(endIndex, 0)));
        if (begin > end) [begin, end] = [end, begin];
        if (begin === end) end = Math.min(this.length, begin + 1);
        return commonFormat(formats.slice(begin, end), this.defaultTextFormat);
    }

    setTextFormat(format: TextFormat, beginIndex = -1, endIndex = -1): void {
        requireTextFormat(format, "TextField.setTextFormat");
        if (!this.length) return;
        const formats = this._ensureCharacterFormats();
        let begin = beginIndex < 0 ? 0 : Math.max(0, Math.min(this.length, finiteInteger(beginIndex, 0)));
        let end = endIndex < 0 ? this.length : Math.max(0, Math.min(this.length, finiteInteger(endIndex, 0)));
        if (begin > end) [begin, end] = [end, begin];
        for (let index = begin; index < end; index++) formats[index] = mergeFormat(formats[index], format);
        this._applyFormat(format);
        this._renderCharacterFormats();
    }

    getLineOffset(lineIndex: number): number { return this._flashLine(lineIndex).offset; }
    getLineLength(lineIndex: number): number { return this._flashLine(lineIndex).length; }
    getLineText(lineIndex: number): string { return this._flashLine(lineIndex).text; }
    getLineIndexOfChar(charIndex: number): number {
        this._requireCharIndex(charIndex);
        const index = this._flashLines().findIndex(record =>
            charIndex >= record.offset && charIndex < record.offset + record.length);
        if (index < 0) throw new RangeError(`Character index ${charIndex} is outside the laid-out text`);
        return index;
    }
    getLineIndexAtPoint(x: number, y: number): number {
        if (x < 0 || y < 0 || x > this.width || y > this.height) return -1;
        const top = this._nativeInput.padding[0] - this._nativeInput.scrollY;
        return this._nativeInput.lines.findIndex(line =>
            y >= top + line.y && y < top + line.y + line.height);
    }
    getLineMetrics(lineIndex: number): TextLineMetrics {
        const { line } = this._flashLine(lineIndex);
        let ascent = 0;
        let descent = 0;
        for (let command = line.cmd; command; command = command.next) {
            const commandAscent = command.baseline ?? command.fontSize * 0.8;
            ascent = Math.max(ascent, commandAscent);
            descent = Math.max(descent, Math.max(0, command.height - commandAscent));
        }
        if (!line.cmd) {
            ascent = this._nativeInput.fontSize * 0.8;
            descent = Math.max(0, line.height - ascent);
        }
        return new TextLineMetrics(
            this._nativeInput.padding[3] + line.x,
            line.width, line.height, ascent, descent, line.leading,
        );
    }
    getCharBoundaries(charIndex: number): Rectangle | null {
        if (charIndex < 0 || charIndex >= this.length || this._plainText.charAt(charIndex) === "\r") return null;
        const record = this._flashLine(this.getLineIndexOfChar(charIndex));
        let within = charIndex - record.offset;
        for (let command = record.line.cmd; command; command = command.next) {
            const commandText = command.text ?? "";
            if (within < commandText.length) {
                const metric = this._commandCharacterMetric(command, within);
                return new Rectangle(
                    this._nativeInput.padding[3] + record.line.x + command.x + metric.x - this._nativeInput.scrollX,
                    this._nativeInput.padding[0] + record.line.y + command.y - this._nativeInput.scrollY,
                    metric.width,
                    command.height,
                );
            }
            within -= commandText.length;
        }
        return null;
    }
    getCharIndexAtPoint(x: number, y: number): number {
        const lineIndex = this.getLineIndexAtPoint(x, y);
        if (lineIndex < 0) return -1;
        const record = this._flashLine(lineIndex);
        for (let index = 0; index < record.visibleLength; index++) {
            const bounds = this.getCharBoundaries(record.offset + index);
            if (bounds && x >= bounds.x && x < bounds.right && y >= bounds.y && y < bounds.bottom)
                return record.offset + index;
        }
        return -1;
    }
    getFirstCharInParagraph(charIndex: number): number {
        this._requireCharIndex(charIndex);
        return this._plainText.lastIndexOf("\r", charIndex - 1) + 1;
    }
    getParagraphLength(charIndex: number): number {
        const first = this.getFirstCharInParagraph(charIndex);
        const terminator = this._plainText.indexOf("\r", charIndex);
        return (terminator < 0 ? this.length : terminator + 1) - first;
    }

    override get width(): number { this._syncAutoSizeBounds(); return super.width; }
    override set width(value: number) { super.width = value; this._nativeInput.width = value; }
    override get height(): number { this._syncAutoSizeBounds(); return super.height; }
    override set height(value: number) { super.height = value; this._nativeInput.height = value; }
    override size(width: number, height: number): this {
        super.size(width, height);
        this._nativeInput.size(width, height);
        return this;
    }

    protected override _applyNativeFocus(value: boolean): void {
        this.focus = value;
        this._syncNativeFocusIndicator(value);
    }

    private _syncChrome(): void {
        this._nativeInput.bgColor = this._background ? cssColor(this._backgroundColor) : "";
        this._nativeInput.borderColor = this._border ? cssColor(this._borderColor) : "";
    }

    override destroy(destroyChild = true): void {
        if (this.destroyed) return;
        runAdmittedNodeMutation(this, "destroyFlashDisplayObject", () => {
            this._nativeInputSession = null;
            this._focusRequested = false;
            this._nativeInput.offAllCaller(this);
            setInputEventOwner(this._nativeInput, null);
            this._nativeInput.focus = false;
            this._nativeInput.destroy(true);
            destroyCanonicalTextField.call(this, destroyChild);
        });
    }

    /** @internal Runtime probe for the composed native control; not source API. */
    protected get _nativeTextInput(): LayaInput { return this._nativeInput; }

    private _forwardNative(type: string): void {
        this._nativeInput.on(type, this, (value: unknown) => {
            if (type === LayaEvent.FOCUS) {
                this._focusRequested = true;
                this._nativeInputSession = {
                    lastText: this._plainText,
                    dirtyGeneration: 0,
                    dispatchedGeneration: 0,
                };
                this._syncNativeFocusIndicator(true);
            } else if (type === LayaEvent.BLUR) {
                this._observeNativeTextMutation();
                this._flushNativeTextChange();
                this._nativeInputSession = null;
                this._focusRequested = false;
                this._restoreLayoutAfterFocus();
                this._syncNativeFocusIndicator(false);
            }
            this.event(type, value);
        });
    }

    private _writeNativeContent(plain: string, layout: string, html: boolean): void {
        this._programmaticTextWrite = true;
        try {
            this._contentHasHtmlLayout = html;
            this._nativeInput.setFlashContent(plain, layout, html);
            if (this._nativeInputSession) this._nativeInputSession.lastText = plain;
            this._syncAutoSizeBounds();
        } finally {
            this._programmaticTextWrite = false;
        }
    }

    private _observeNativeTextMutation(): void {
        const session = this._nativeInputSession;
        if (!session) return;
        const text = this._nativeInput.text;
        if (text === session.lastText) return;
        session.lastText = text;
        session.dirtyGeneration++;
        this._plainText = normalizeText(text);
        this._htmlText = flashTextToHtml(this._plainText);
        this._characterFormats = Array.from({ length: this._plainText.length }, () => cloneFormat(this.defaultTextFormat));
    }

    private _flushNativeTextChange(value?: unknown): void {
        const session = this._nativeInputSession;
        if (!session || session.dispatchedGeneration === session.dirtyGeneration) return;
        session.dispatchedGeneration = session.dirtyGeneration;
        this.event(LayaEvent.CHANGE, value);
    }

    private _restoreLayoutAfterFocus(): void {
        if (this._characterFormats) this._renderCharacterFormats();
        else if (this._htmlText !== flashTextToHtml(this._plainText))
            this._writeNativeContent(this._plainText, flashHtmlForLaya(this._htmlText, this._condenseWhite), true);
        else this._writeNativeContent(this._plainText, this._plainText, false);
    }

    private _dispatchNativeIme(phase: "start" | "end", value: unknown): void {
        const nativePhase = phase === "start" ? LayaEvent.COMPOSITION_START : LayaEvent.COMPOSITION_END;
        const data = readTextCompositionPayload(value, this._nativeInput, nativePhase);
        if (!data) throw new TypeError(`Native IME ${phase} requires authenticated composition payload`);
        this.dispatchEvent(new IMEEvent(IMEEvent.IME_COMPOSITION, true, false, data.text, null));
    }

    private _currentFormat(): TextFormat {
        return this._defaultFormatInitialized ? cloneFormat(this._defaultFormat) : this._hostFormat();
    }

    private _captureDefaultFormat(): void {
        if (this._defaultFormatInitialized) return;
        this._defaultFormat = this._hostFormat();
        this._defaultFormatInitialized = true;
    }

    private _hostFormat(): TextFormat {
        const input = this._nativeInput;
        const format = new TextFormat(
            input.font,
            input.fontSize,
            colorNumber(input.color),
            input.bold,
            input.italic,
            input.underline,
            null,
            null,
            input.align,
            input.padding[3] - 2,
            input.padding[1] - 2,
            0,
            input.leading,
        );
        format.kerning = input.flashKerning;
        format.letterSpacing = input.letterSpacing;
        format.blockIndent = 0;
        format.bullet = false;
        format.tabStops = [];
        return format;
    }

    private _applyFormat(format: TextFormat): void {
        const input = this._nativeInput;
        if (format.font != null) input.font = format.font;
        if (format.size != null) input.fontSize = format.size;
        if (format.color != null) input.color = cssColor(format.color);
        if (format.bold != null) input.bold = format.bold;
        if (format.italic != null) input.italic = format.italic;
        if (format.underline != null) input.underline = format.underline;
        if (format.letterSpacing != null) input.letterSpacing = format.letterSpacing;
        if (format.kerning != null) input.flashKerning = format.kerning;
        this._refreshAdvancedRasterization();
    }

    private _ensureCharacterFormats(): TextFormat[] {
        if (this._characterFormats?.length === this.length) return this._characterFormats;
        const base = this._currentFormat();
        const formats = Array.from({ length: this.length }, () => cloneFormat(base));
        if (!this._contentHasHtmlLayout) {
            this._characterFormats = formats;
            return formats;
        }
        for (const record of this._flashLines()) {
            let cursor = record.offset;
            for (let command = record.line.cmd; command; command = command.next) {
                const style = command.style;
                const format = cloneFormat(base);
                format.font = style.font || format.font;
                format.size = command.fontSize || format.size;
                format.color = colorNumber(style.color) ?? format.color;
                format.bold = style.bold;
                format.italic = style.italic;
                format.underline = style.underline;
                format.align = style.align || record.line.align || format.align;
                format.leading = style.leading;
                format.kerning = style.kerning;
                format.letterSpacing = style.letterSpacing;
                for (let index = 0; index < (command.text?.length ?? 0) && cursor + index < formats.length; index++)
                    formats[cursor + index] = cloneFormat(format);
                cursor += command.text?.length ?? 0;
            }
            if (record.length > record.visibleLength && record.offset + record.visibleLength < formats.length) {
                const previous = formats[Math.max(record.offset, record.offset + record.visibleLength - 1)] ?? base;
                formats[record.offset + record.visibleLength] = cloneFormat(previous);
            }
        }
        this._characterFormats = formats;
        return formats;
    }

    private _renderCharacterFormats(): void {
        const formats = this._characterFormats ?? [];
        if (!this._plainText) {
            this._htmlText = "";
            this._writeNativeContent("", "", false);
            return;
        }
        const keys = formats.map(format => formatKey(format));
        if (new Set(keys).size === 1 && formats[0]) {
            this._applyFormat(formats[0]);
            this._htmlText = formatHtmlSegment(this._plainText, formats[0]);
            const linkedLayout = formats[0].url ? this._htmlText : this._plainText;
            this._writeNativeContent(this._plainText, linkedLayout, formats[0].url != null);
            return;
        }
        let markup = "";
        for (let start = 0; start < this._plainText.length;) {
            let end = start + 1;
            while (end < this._plainText.length && keys[end] === keys[start]) end++;
            markup += formatHtmlSegment(this._plainText.slice(start, end), formats[start] ?? this._currentFormat());
            start = end;
        }
        this._htmlText = markup;
        this._writeNativeContent(this._plainText, markup, true);
    }

    private _flashLines(): FlashLineRecord[] {
        this._nativeInput.ensureFlashLayout();
        const source = this._plainText;
        let cursor = 0;
        return this._nativeInput.lines.map(line => {
            let visible = "";
            for (let command = line.cmd; command; command = command.next) visible += command.text ?? "";
            if (source.slice(cursor, cursor + visible.length) !== visible) {
                const located = source.indexOf(visible, cursor);
                if (located >= 0) cursor = located;
            }
            const offset = cursor;
            cursor += visible.length;
            if (source.charAt(cursor) === "\r") cursor++;
            return { line, offset, visibleLength: visible.length, length: cursor - offset, text: source.slice(offset, cursor) };
        });
    }

    private _flashLine(lineIndex: number): FlashLineRecord {
        const index = finiteInteger(lineIndex, -1);
        const record = this._flashLines()[index];
        if (!record || index < 0) throw new RangeError(`Line index ${lineIndex} is out of range`);
        return record;
    }

    private _requireCharIndex(charIndex: number): void {
        if (!Number.isFinite(charIndex) || charIndex < 0 || charIndex >= this.length)
            throw new RangeError(`Character index ${charIndex} is out of range`);
    }

    private _commandCharacterMetric(command: ITextCmd, utf16Index: number): { x: number; width: number } {
        const characters = Array.from(command.text ?? "");
        let utf16Cursor = 0;
        let x = 0;
        const spacing = command.style.letterSpacing ?? 0;
        const context = Browser.context;
        const previousFont = context.font;
        const typedContext = context as CanvasRenderingContext2D & { fontKerning?: string };
        const previousKerning = typedContext.fontKerning;
        context.font = command.ctxFont;
        typedContext.fontKerning = command.style.kerning ? "normal" : "none";
        try {
            for (let index = 0; index < characters.length; index++) {
                const character = characters[index];
                const span = character.length;
                const width = (command.glyphAdvances?.[index] ?? context.measureText(character).width)
                    + spacing * (command.glyphAdvances ? 1 : span);
                if (utf16Index >= utf16Cursor && utf16Index < utf16Cursor + span) return { x, width };
                utf16Cursor += span;
                x += width;
            }
        } finally {
            context.font = previousFont;
            typedContext.fontKerning = previousKerning;
        }
        return { x, width: 0 };
    }

    private _refreshAdvancedRasterization(): void {
        if (!this._embedFonts || this._antiAliasType !== AntiAliasType.ADVANCED) {
            this._nativeInput.rasterizationSettings = null;
            return;
        }
        const input = this._nativeInput;
        const style = input.bold && input.italic ? FontStyle.BOLD_ITALIC
            : input.bold ? FontStyle.BOLD : input.italic ? FontStyle.ITALIC : FontStyle.REGULAR;
        const color = this._defaultFormat.color ?? colorNumber(input.color) ?? 0;
        const colorType = colorLuminance(color) > 0.5 ? TextColorType.LIGHT_COLOR : TextColorType.DARK_COLOR;
        const table = TextRenderer.resolveAdvancedAntiAliasing(input.font, style, colorType, input.fontSize);
        let outsideCutoff = table ? table.outsideCutoff : -0.10;
        let insideCutoff = table ? table.insideCutoff : 0.34;
        outsideCutoff += (0.5 * this._sharpness - this._thickness) / 900;
        insideCutoff += (-0.5 * this._sharpness - this._thickness) / 900;
        if (insideCutoff < outsideCutoff) [outsideCutoff, insideCutoff] = [insideCutoff, outsideCutoff];
        input.rasterizationSettings = {
            coverageMode: "signed-distance-cutoff",
            outsideCutoff,
            insideCutoff,
            gridFit: input.align === TextFormatAlign.LEFT ? this._gridFitType
                : this._gridFitType === GridFitType.PIXEL ? GridFitType.SUBPIXEL : this._gridFitType,
        } as TextRasterizationSettings;
    }

    private _syncAutoSizeBounds(): void {
        if (this._flashAutoSize === TextFieldAutoSize.NONE) return;
        this._nativeInput.ensureFlashLayout();
        const desiredWidth = this._nativeInput.wordWrap ? super.width : Math.max(4, this._nativeInput.textWidth);
        const desiredHeight = Math.max(4, this._nativeInput.textHeight);
        if (desiredWidth === super.width && desiredHeight === super.height) return;
        const right = this.x + super.width;
        const center = this.x + super.width / 2;
        super.size(desiredWidth, desiredHeight);
        this._nativeInput.size(desiredWidth, desiredHeight);
        if (this._flashAutoSize === TextFieldAutoSize.RIGHT) this.x = right - desiredWidth;
        else if (this._flashAutoSize === TextFieldAutoSize.CENTER) this.x = center - desiredWidth / 2;
    }
}

/** Convert Flash HTML into the independent UTF-16 plain-text view. */
export function flashHtmlToText(value: string, condenseWhite = false): string {
    const lineBreak = "\ufdd0";
    let result = stripTrailingEmptyFlashBlocks(value)
        .replace(/<(?:br|sbr)\b[^>]*\/?>/gi, lineBreak)
        .replace(/<\/(?:p|li)>\s*/gi, lineBreak)
        .replace(/<[^>]*>/g, "")
        .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#([0-9]+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
        .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_match, name: string) => ({
            amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0",
        })[name.toLowerCase()]!);
    if (condenseWhite) {
        result = result.replace(/[ \t\n\r\v\f]+/g, " ")
            .replace(new RegExp(` *${lineBreak} *`, "g"), lineBreak);
    } else result = result.replace(/\r\n?|\n/g, "\r");
    return result.replace(new RegExp(lineBreak, "g"), "\r").replace(/\r+$/, "");
}

/** Escape plain text into the independent Flash HTML view. */
export function flashTextToHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;").replace(/\r\n?|\n/g, "<br>");
}

function flashHtmlForLaya(source: string, condenseWhite: boolean): string {
    let value = stripTrailingEmptyFlashBlocks(source).replace(/<sbr\b[^>]*\/?>/gi, "<br>");
    if (condenseWhite) {
        let whitespacePending = false;
        value = value.replace(/<[^>]*>|[^<]+/g, token => {
            if (token.startsWith("<")) return token;
            let collapsed = token.replace(/[ \t\n\r\v\f]+/g, " ");
            if (whitespacePending && collapsed.startsWith(" ")) collapsed = collapsed.slice(1);
            whitespacePending = collapsed.endsWith(" ");
            return collapsed;
        });
    }
    return value.replace(/<\/(?:p|li|div)>\s*$/i, "");
}

function stripTrailingEmptyFlashBlocks(value: string): string {
    const emptyBlock = /<(p|li|div)\b[^>]*>(?:(?:\s|&nbsp;|&#160;|&#xa0;)|<\/?(?:font|b|i|u|span|textformat)\b[^>]*>)*<\/\1>\s*$/i;
    let result = value;
    while (emptyBlock.test(result)) result = result.replace(emptyBlock, "");
    return result;
}

const FORMAT_KEYS: ReadonlyArray<keyof TextFormat> = Object.freeze([
    "font", "size", "color", "bold", "italic", "underline", "url", "target", "align",
    "leftMargin", "rightMargin", "indent", "leading", "blockIndent", "bullet", "kerning",
    "letterSpacing", "tabStops",
]);

function cloneFormat(source: TextFormat): TextFormat {
    const result = new TextFormat(
        source.font, source.size, source.color, source.bold, source.italic, source.underline,
        source.url, source.target, source.align, source.leftMargin, source.rightMargin,
        source.indent, source.leading,
    );
    result.blockIndent = source.blockIndent;
    result.bullet = source.bullet;
    result.kerning = source.kerning;
    result.letterSpacing = source.letterSpacing;
    result.tabStops = source.tabStops ? [...source.tabStops] : null;
    return result;
}

function mergeFormat(base: TextFormat, overlay: TextFormat): TextFormat {
    const result = cloneFormat(base);
    for (const key of FORMAT_KEYS) {
        const value = overlay[key];
        if (value != null) copyFormatProperty(result, overlay, key);
    }
    return result;
}

function commonFormat(formats: readonly TextFormat[], fallback: TextFormat): TextFormat {
    if (!formats.length) return cloneFormat(fallback);
    const result = cloneFormat(formats[0]);
    for (const key of FORMAT_KEYS) {
        const first = result[key];
        if (formats.some(format => JSON.stringify(format[key]) !== JSON.stringify(first)))
            clearFormatProperty(result, key);
    }
    return result;
}

function formatKey(format: TextFormat): string {
    return JSON.stringify(FORMAT_KEYS.map(key => format[key]));
}

function formatHtmlSegment(value: string, format: TextFormat): string {
    const attribute = (name: string, raw: string | number | boolean | null): string =>
        raw == null ? "" : ` ${name}=\"${flashTextToHtml(String(raw))}\"`;
    const color = format.color == null ? null : `#${(format.color >>> 0).toString(16).padStart(6, "0").slice(-6)}`;
    let result = flashTextToHtml(value);
    result = `<font${attribute("face", format.font)}${attribute("size", format.size)}${attribute("color", color)}`
        + `${attribute("letterSpacing", format.letterSpacing)}${attribute("kerning", format.kerning ? 1 : 0)}>${result}</font>`;
    if (format.bold) result = `<b>${result}</b>`;
    if (format.italic) result = `<i>${result}</i>`;
    if (format.underline) result = `<u>${result}</u>`;
    if (format.url) result = `<a${attribute("href", format.url)}${attribute("target", format.target)}>${result}</a>`;
    return result;
}

function requireTextFormat(value: unknown, label: string): asserts value is TextFormat {
    if (!isFlashTextFormat(value)) throw new TypeError(`${label} requires a TextFormat`);
}

function copyFormatProperty(target: TextFormat, source: TextFormat, key: keyof TextFormat): void {
    switch (key) {
        case "font": target.font = source.font; break;
        case "size": target.size = source.size; break;
        case "color": target.color = source.color; break;
        case "bold": target.bold = source.bold; break;
        case "italic": target.italic = source.italic; break;
        case "underline": target.underline = source.underline; break;
        case "url": target.url = source.url; break;
        case "target": target.target = source.target; break;
        case "align": target.align = source.align; break;
        case "leftMargin": target.leftMargin = source.leftMargin; break;
        case "rightMargin": target.rightMargin = source.rightMargin; break;
        case "indent": target.indent = source.indent; break;
        case "leading": target.leading = source.leading; break;
        case "blockIndent": target.blockIndent = source.blockIndent; break;
        case "bullet": target.bullet = source.bullet; break;
        case "kerning": target.kerning = source.kerning; break;
        case "letterSpacing": target.letterSpacing = source.letterSpacing; break;
        case "tabStops": target.tabStops = source.tabStops ? [...source.tabStops] : null; break;
    }
}

function clearFormatProperty(target: TextFormat, key: keyof TextFormat): void {
    switch (key) {
        case "font": target.font = null; break;
        case "size": target.size = null; break;
        case "color": target.color = null; break;
        case "bold": target.bold = null; break;
        case "italic": target.italic = null; break;
        case "underline": target.underline = null; break;
        case "url": target.url = null; break;
        case "target": target.target = null; break;
        case "align": target.align = null; break;
        case "leftMargin": target.leftMargin = null; break;
        case "rightMargin": target.rightMargin = null; break;
        case "indent": target.indent = null; break;
        case "leading": target.leading = null; break;
        case "blockIndent": target.blockIndent = null; break;
        case "bullet": target.bullet = null; break;
        case "kerning": target.kerning = null; break;
        case "letterSpacing": target.letterSpacing = null; break;
        case "tabStops": target.tabStops = null; break;
    }
}

function normalizeText(value: unknown): string {
    return (value == null ? "" : String(value)).replace(/\r\n?|\n/g, "\r");
}

function cssColor(value: number): string {
    return `#${(value >>> 0).toString(16).padStart(6, "0").slice(-6)}`;
}

function colorNumber(value: string | null): number | null {
    const match = /^#([0-9a-f]{6})$/i.exec(value ?? "");
    return match ? Number.parseInt(match[1], 16) : null;
}

function finiteNumber(value: number, fallback: number): number {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function finiteInteger(value: number, fallback: number): number {
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }

function colorLuminance(value: number): number {
    const red = value >> 16 & 255;
    const green = value >> 8 & 255;
    const blue = value & 255;
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

const _textFieldHeritage: new () => InteractiveObject = TextField;
void _textFieldHeritage;
const _textFieldRoot: (value: TextField) => DisplayObject = value => value.root;
void _textFieldRoot;
