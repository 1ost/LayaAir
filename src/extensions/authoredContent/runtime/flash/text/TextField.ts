import { Input as LayaInput } from "../../../../../layaAir/laya/display/Input";
import { Sprite as LayaSprite } from "../../../../../layaAir/laya/display/Sprite";
import { FlashEventListener, FlashEventRouter } from "../../FlashEventRouter";
import { Event } from "../events/Event";
import { IEventDispatcher } from "../events/EventDispatcher";

export class TextFieldType {
    static readonly DYNAMIC = "dynamic";
    static readonly INPUT = "input";
}

/** Flash-shaped editable/dynamic text over the real Laya Input/Text implementation. */
export class TextField extends LayaInput implements IEventDispatcher {
    private readonly _flashEvents = new FlashEventRouter(this);
    private _flashType = TextFieldType.DYNAMIC;

    constructor() {
        super();
        super.type = LayaInput.TYPE_TEXT;
        this.editable = false;
    }

    override get type(): string { return this._flashType; }
    override set type(value: string) {
        if (value !== TextFieldType.DYNAMIC && value !== TextFieldType.INPUT)
            throw new TypeError("TextField.type must be TextFieldType.DYNAMIC or TextFieldType.INPUT");
        this._flashType = value;
        this.editable = value === TextFieldType.INPUT;
        super.type = LayaInput.TYPE_TEXT;
    }

    addEventListener(type: string, listener: FlashEventListener, useCapture = false, priority = 0, useWeakReference = false): void {
        this._flashEvents.addEventListener(type, listener, useCapture, priority, useWeakReference);
    }
    removeEventListener(type: string, listener: FlashEventListener, useCapture = false): void {
        this._flashEvents.removeEventListener(type, listener, useCapture);
    }
    dispatchEvent(event: Event): boolean { return this._flashEvents.dispatchEvent(event, this); }
    hasEventListener(type: string): boolean { return this._flashEvents.hasEventListener(type); }
    willTrigger(type: string): boolean {
        let node: LayaSprite | null = this;
        while (node) {
            if (FlashEventRouter.forHost(node)?.hasEventListener(type)) return true;
            node = node.parent as LayaSprite | null;
        }
        return false;
    }
}
