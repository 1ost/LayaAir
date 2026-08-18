import { Event as LayaEvent } from "../../laya/events/Event";
import { UnsupportedFlashFeatureError } from "./UnsupportedFlashFeatureError";
import { Event } from "./Event";

const KEYBOARD_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash keyboard events. */
export function isFlashKeyboardEvent(value: unknown): value is KeyboardEvent {
    return typeof value === "object" && value !== null && KEYBOARD_EVENT_VALUES.has(value);
}

function uintValue(value: number, label: string): number {
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF)
        throw new TypeError(`${label} must be a uint`);
    return value;
}

/** Flash keyboard payload projected once from the native Laya/DOM ingress. */
export class KeyboardEvent extends Event {
    static readonly KEY_DOWN = "keyDown";
    static readonly KEY_UP = "keyUp";

    charCode: number;
    keyCode: number;
    keyLocation: number;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    commandKey: boolean;
    controlKey: boolean;

    constructor(
        type: string, bubbles = true, cancelable = false, charCode = 0, keyCode = 0,
        keyLocation = 0, ctrlKey = false, altKey = false, shiftKey = false,
        controlKey = false, commandKey = false
    ) {
        super(type, bubbles, cancelable);
        this.charCode = uintValue(charCode, "KeyboardEvent.charCode");
        this.keyCode = uintValue(keyCode, "KeyboardEvent.keyCode");
        this.keyLocation = uintValue(keyLocation, "KeyboardEvent.keyLocation");
        this.ctrlKey = !!ctrlKey;
        this.altKey = !!altKey;
        this.shiftKey = !!shiftKey;
        this.controlKey = !!controlKey;
        this.commandKey = !!commandKey;
        KEYBOARD_EVENT_VALUES.add(this);
    }

    override clone(): KeyboardEvent {
        return new KeyboardEvent(this.type, this.bubbles, this.cancelable, this.charCode,
            this.keyCode, this.keyLocation, this.ctrlKey, this.altKey, this.shiftKey,
            this.controlKey, this.commandKey);
    }

    updateAfterEvent(): void {
        throw new UnsupportedFlashFeatureError("flash.events.KeyboardEvent.updateAfterEvent", "Laya owns render scheduling");
    }

    /** @internal */
    static _fromNative(type: string, value: LayaEvent): KeyboardEvent {
        const native = value.nativeEvent;
        if (!native || typeof native !== "object")
            throw new TypeError(`Native ${type} requires a DOM keyboard payload`);
        const data = native as globalThis.KeyboardEvent;
        const keyCode = data.keyCode ?? (data as unknown as { which?: number }).which ?? 0;
        const explicitCharCode = data.charCode;
        const charCode = Number.isInteger(explicitCharCode) && explicitCharCode > 0
            ? explicitCharCode
            : (typeof data.key === "string" && [...data.key].length === 1 ? data.key.codePointAt(0)! : 0);
        return new KeyboardEvent(type, true, false, charCode, keyCode, data.location ?? 0,
            data.ctrlKey === true, data.altKey === true, data.shiftKey === true,
            data.ctrlKey === true, data.metaKey === true);
    }
}

Object.freeze(KeyboardEvent);
