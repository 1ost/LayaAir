import { Event as LayaEvent } from "../../laya/events/Event";
import { Point } from "../../laya/maths/Point";
import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { UnsupportedFlashFeatureError } from "./UnsupportedFlashFeatureError";
import { Event } from "./Event";

const MOUSE_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash mouse events. */
export function isFlashMouseEvent(value: unknown): value is MouseEvent {
    return typeof value === "object" && value !== null && MOUSE_EVENT_VALUES.has(value);
}

function finiteOrNaN(value: number, label: string): number {
    if (typeof value !== "number" || (!Number.isFinite(value) && !Number.isNaN(value)))
        throw new TypeError(`${label} must be finite or NaN`);
    return value;
}

export class MouseEvent extends Event {
    static readonly CLICK = "click";
    static readonly DOUBLE_CLICK = "doubleClick";
    static readonly MOUSE_DOWN = "mouseDown";
    static readonly MOUSE_MOVE = "mouseMove";
    static readonly MOUSE_OUT = "mouseOut";
    static readonly MOUSE_OVER = "mouseOver";
    static readonly MOUSE_UP = "mouseUp";
    static readonly MOUSE_WHEEL = "mouseWheel";
    static readonly ROLL_OUT = "rollOut";
    static readonly ROLL_OVER = "rollOver";

    readonly localX: number;
    readonly localY: number;
    readonly relatedObject: unknown;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
    readonly buttonDown: boolean;
    readonly delta: number;
    readonly clickCount: number;
    readonly stageX: number;
    readonly stageY: number;

    constructor(
        type: string, bubbles: boolean = true, cancelable: boolean = false,
        localX: number = Number.NaN, localY: number = Number.NaN, relatedObject: unknown = null,
        ctrlKey: boolean = false, altKey: boolean = false, shiftKey: boolean = false,
        buttonDown: boolean = false, delta: number = 0, _commandKey: boolean = false,
        _controlKey: boolean = false, clickCount: number = 0,
        stageX: number = localX, stageY: number = localY
    ) {
        super(type, bubbles, cancelable);
        this.localX = finiteOrNaN(localX, "MouseEvent.localX");
        this.localY = finiteOrNaN(localY, "MouseEvent.localY");
        this.relatedObject = relatedObject;
        this.ctrlKey = !!ctrlKey;
        this.altKey = !!altKey;
        this.shiftKey = !!shiftKey;
        this.buttonDown = !!buttonDown;
        this.delta = finiteOrNaN(delta, "MouseEvent.delta");
        if (!Number.isInteger(clickCount) || clickCount < 0) throw new TypeError("MouseEvent.clickCount must be a nonnegative integer");
        this.clickCount = clickCount;
        this.stageX = finiteOrNaN(stageX, "MouseEvent.stageX");
        this.stageY = finiteOrNaN(stageY, "MouseEvent.stageY");
        MOUSE_EVENT_VALUES.add(this);
    }

    override clone(): MouseEvent {
        return new MouseEvent(this.type, this.bubbles, this.cancelable, this.localX, this.localY,
            this.relatedObject, this.ctrlKey, this.altKey, this.shiftKey, this.buttonDown,
            this.delta, false, false, this.clickCount, this.stageX, this.stageY);
    }

    updateAfterEvent(): void {
        throw new UnsupportedFlashFeatureError("flash.events.MouseEvent.updateAfterEvent", "Laya owns render scheduling");
    }

    /** @internal */
    static _fromNative(type: string, value: LayaEvent, target: unknown): MouseEvent {
        const stageX = value.touchPos?.x ?? Number.NaN;
        const stageY = value.touchPos?.y ?? Number.NaN;
        let localX = stageX;
        let localY = stageY;
        if (target instanceof LayaSprite && Number.isFinite(stageX) && Number.isFinite(stageY)) {
            const local = target.globalToLocal(new Point(stageX, stageY), true);
            localX = local.x;
            localY = local.y;
        }
        const native = value.nativeEvent as MouseEventInit | undefined;
        const roll = type === MouseEvent.ROLL_OVER || type === MouseEvent.ROLL_OUT;
        const buttons = typeof native?.buttons === "number" ? native.buttons : 0;
        const down = (buttons & 1) !== 0 || (type === MouseEvent.MOUSE_DOWN && value.button === 0);
        return new MouseEvent(type, !roll, false, localX, localY, null,
            !!native?.ctrlKey, !!native?.altKey, !!native?.shiftKey, down,
            value.delta ?? 0, false, false, value.isDblClick ? 2 : 1, stageX, stageY);
    }
}
