import { Input as LayaInput, setInputEventOwner, type InputSelectionDirection } from "../../laya/display/Input";
import { Event as LayaEvent } from "../../laya/events/Event";
import { IMEEvent } from "../events/IMEEvent";
import { DisplayObject } from "../display/DisplayObject";
import { InteractiveObject } from "../display/InteractiveObject";

export class TextFieldType {
    static readonly DYNAMIC = "dynamic";
    static readonly INPUT = "input";
}

/**
 * Genuine Flash display hierarchy with a composed native Laya Input.
 * The outer object owns display identity; the inner Input owns browser text,
 * selection, focus, password, HTML and IME behavior.
 */
export class TextField extends InteractiveObject {
    private readonly _nativeInput = new LayaInput();
    private _flashType = TextFieldType.DYNAMIC;
    private _embedFonts = false;
    private _displayAsPassword = false;
    private _focusRequested = false;
    private _nativeChangePending = false;

    constructor() {
        super();
        this._nativeInput.name = "__flashTextInput";
        this._nativeInput.mouseEnabled = true;
        this._nativeInput.type = LayaInput.TYPE_TEXT;
        this._nativeInput.editable = false;
        this.addChild(this._nativeInput);
        setInputEventOwner(this._nativeInput, this);
        this._forwardNative(LayaEvent.FOCUS);
        this._forwardNative(LayaEvent.BLUR);
        this._forwardNative(LayaEvent.BEFORE_INPUT);
        this._nativeInput.on(LayaEvent.CHANGE, this, (value: unknown) => {
            this._nativeChangePending = true;
            queueMicrotask(() => { this._nativeChangePending = false; });
            this.event(LayaEvent.CHANGE, value);
        });
        this._nativeInput.on(LayaEvent.INPUT, this, (value: unknown) => {
            if (this._nativeChangePending) {
                this._nativeChangePending = false;
                return;
            }
            this.event(LayaEvent.CHANGE, value);
        });
        this._nativeInput.on(LayaEvent.COMPOSITION_START, this,
            (value: unknown) => this._dispatchNativeIme("start", value));
        this._nativeInput.on(LayaEvent.COMPOSITION_UPDATE, this,
            (value: unknown) => this.event(LayaEvent.COMPOSITION_UPDATE, value));
        this._nativeInput.on(LayaEvent.COMPOSITION_END, this,
            (value: unknown) => this._dispatchNativeIme("end", value));
    }

    get text(): string { return this._nativeInput.text; }
    set text(value: string) {
        if (typeof value !== "string") throw new TypeError("TextField.text must be a string");
        this._nativeInput.text = value;
    }

    get htmlText(): string { return this._nativeInput.text; }
    set htmlText(value: string) {
        if (typeof value !== "string") throw new TypeError("TextField.htmlText must be a string");
        this._nativeInput.html = true;
        this._nativeInput.text = value;
    }

    get displayAsPassword(): boolean { return this._displayAsPassword; }
    set displayAsPassword(value: boolean) {
        this._displayAsPassword = !!value;
        this._nativeInput.type = this._displayAsPassword ? LayaInput.TYPE_PASSWORD : LayaInput.TYPE_TEXT;
    }

    get embedFonts(): boolean { return this._embedFonts; }
    set embedFonts(value: boolean) { this._embedFonts = !!value; }

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
    set multiline(value: boolean) { this._nativeInput.multiline = !!value; }

    get wordWrap(): boolean { return this._nativeInput.wordWrap; }
    set wordWrap(value: boolean) { this._nativeInput.wordWrap = !!value; }

    get selectable(): boolean { return this._nativeInput.selectable; }
    set selectable(value: boolean) { this._nativeInput.selectable = !!value; }

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
    get caretIndex(): number {
        return this.selectionDirection === "backward" ? this.selectionStart : this.selectionEnd;
    }

    setSelection(startIndex: number, endIndex: number): void {
        this._nativeInput.setSelection(startIndex, endIndex);
    }

    get type(): string { return this._flashType; }
    set type(value: string) {
        if (value !== TextFieldType.DYNAMIC && value !== TextFieldType.INPUT)
            throw new TypeError("TextField.type must be TextFieldType.DYNAMIC or TextFieldType.INPUT");
        this._flashType = value;
        this.editable = value === TextFieldType.INPUT;
        this._nativeInput.type = this._displayAsPassword ? LayaInput.TYPE_PASSWORD : LayaInput.TYPE_TEXT;
    }

    override get width(): number { return super.width; }
    override set width(value: number) { super.width = value; this._nativeInput.width = value; }
    override get height(): number { return super.height; }
    override set height(value: number) { super.height = value; this._nativeInput.height = value; }
    override size(width: number, height: number): this {
        super.size(width, height);
        this._nativeInput.size(width, height);
        return this;
    }

    /** Explicit composition seam for native adapters that do not expose Laya composition events. */
    dispatchImeComposition(phase: "start" | "update" | "end", text: string,
        selectionBeginIndex = this.selectionStart, selectionEndIndex = this.selectionEnd,
        nativeEvent: unknown = null): boolean {
        if (phase !== "start" && phase !== "update" && phase !== "end")
            throw new TypeError("IME composition phase must be start, update or end");
        if (!Number.isInteger(selectionBeginIndex) || selectionBeginIndex < 0
            || !Number.isInteger(selectionEndIndex) || selectionEndIndex < selectionBeginIndex)
            throw new TypeError("IME composition selection must be ordered nonnegative integers");
        void nativeEvent;
        return this.dispatchEvent(new IMEEvent(IMEEvent.IME_COMPOSITION, true, false, text, null));
    }

    private _forwardNative(type: string): void {
        this._nativeInput.on(type, this, (value: unknown) => {
            if (type === LayaEvent.FOCUS) {
                this._focusRequested = true;
                this._syncNativeFocusIndicator(true);
            } else if (type === LayaEvent.BLUR) {
                this._focusRequested = false;
                this._syncNativeFocusIndicator(false);
            }
            this.event(type, value);
        });
    }

    protected override _applyNativeFocus(value: boolean): void {
        this.focus = value;
        this._syncNativeFocusIndicator(value);
    }

    private _dispatchNativeIme(phase: "start" | "end", value: unknown): void {
        if (!value || typeof value !== "object")
            throw new TypeError(`Native IME ${phase} requires composition payload`);
        const data = value as Record<string, unknown>;
        if (typeof data.text !== "string" || !Number.isInteger(data.selectionStart)
            || !Number.isInteger(data.selectionEnd))
            throw new TypeError(`Native IME ${phase} requires text and integer selection`);
        this.dispatchImeComposition(phase, data.text, data.selectionStart as number,
            data.selectionEnd as number, data.nativeEvent ?? null);
    }

    /** @internal Runtime probe for the composed native control; not source API. */
    protected get _nativeTextInput(): LayaInput { return this._nativeInput; }
}

// Compiler-enforced heritage proof: no structural or Symbol.hasInstance substitution.
const _textFieldHeritage: new () => InteractiveObject = TextField;
void _textFieldHeritage;
const _textFieldRoot: (value: TextField) => DisplayObject = value => value.root;
void _textFieldRoot;
