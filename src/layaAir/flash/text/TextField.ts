import { Input as LayaInput } from "../../laya/display/Input";
import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { FlashEventListener, FlashEventRouter } from "../events/FlashEventRouter";
import { Event } from "../events/Event";
import { IEventDispatcher } from "../events/EventDispatcher";

export class TextFieldType {
    static readonly DYNAMIC = "dynamic";
    static readonly INPUT = "input";
}

/** Flash-shaped editable/dynamic text over the real Laya Input/Text implementation. */
export class TextField extends LayaInput implements IEventDispatcher {
    private readonly _textFlashEvents = new FlashEventRouter(this);
    private _flashType = TextFieldType.DYNAMIC;
    private _embedFonts = false;
    private _displayAsPassword = false;
    doubleClickEnabled = false;
    needsSoftKeyboard = false;
    tabEnabled = false;
    tabIndex = -1;

    constructor() {
        super();
        super.type = LayaInput.TYPE_TEXT;
        this.editable = false;
    }

    get root(): LayaSprite {
        let value: LayaSprite = this;
        while (value.parent instanceof LayaSprite) value = value.parent;
        return value;
    }

    get htmlText(): string { return this.text; }
    set htmlText(value: string) {
        if (typeof value !== "string") throw new TypeError("TextField.htmlText must be a string");
        this.html = true;
        this.text = value;
    }

    get displayAsPassword(): boolean { return this._displayAsPassword; }
    set displayAsPassword(value: boolean) {
        this._displayAsPassword = !!value;
        super.type = this._displayAsPassword ? LayaInput.TYPE_PASSWORD : LayaInput.TYPE_TEXT;
    }

    get embedFonts(): boolean { return this._embedFonts; }
    set embedFonts(value: boolean) { this._embedFonts = !!value; }

    get selectionBeginIndex(): number { return this.selectionStart; }
    get selectionEndIndex(): number { return this.selectionEnd; }
    get caretIndex(): number {
        return this.selectionDirection === "backward" ? this.selectionStart : this.selectionEnd;
    }

    override get type(): string { return this._flashType; }
    override set type(value: string) {
        if (value !== TextFieldType.DYNAMIC && value !== TextFieldType.INPUT)
            throw new TypeError("TextField.type must be TextFieldType.DYNAMIC or TextFieldType.INPUT");
        this._flashType = value;
        this.editable = value === TextFieldType.INPUT;
        super.type = this._displayAsPassword ? LayaInput.TYPE_PASSWORD : LayaInput.TYPE_TEXT;
    }

    addEventListener(type: string, listener: FlashEventListener, useCapture = false, priority = 0, useWeakReference = false): void {
        this._textFlashEvents.addEventListener(type, listener, useCapture, priority, useWeakReference);
    }
    removeEventListener(type: string, listener: FlashEventListener, useCapture = false): void {
        this._textFlashEvents.removeEventListener(type, listener, useCapture);
    }
    dispatchEvent(event: Event): boolean { return this._textFlashEvents.dispatchEvent(event, this); }
    hasEventListener(type: string): boolean { return this._textFlashEvents.hasEventListener(type); }
    willTrigger(type: string): boolean {
        let node: LayaSprite | null = this;
        while (node) {
            if (FlashEventRouter.forHost(node)?.hasEventListener(type)) return true;
            node = node.parent as LayaSprite | null;
        }
        return false;
    }
}
