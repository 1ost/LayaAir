import { Node as LayaNode } from "../../laya/display/Node";
import { getInputEventOwner } from "../../laya/display/Input";
import { Event as LayaEvent } from "../../laya/events/Event";
import { Event, EventPhase } from "./Event";
import { FocusEvent } from "./FocusEvent";
import { IMEEvent } from "./IMEEvent";
import { MouseEvent } from "./MouseEvent";
import { TextEvent } from "./TextEvent";
import { UnsupportedFlashFeatureError } from "./UnsupportedFlashFeatureError";

export type FlashEventListener = { bivarianceHack(event: Event): void }["bivarianceHack"];

export interface NativeEventHost {
    on(type: string, caller: unknown, listener: Function): unknown;
    off(type: string, caller: unknown, listener: Function): unknown;
    event(type: string, data?: unknown): boolean;
}

interface ListenerEntry { listener: FlashEventListener; priority: number; ordinal: number; }
interface TypeEntry {
    nativeType: string;
    capture: ListenerEntry[];
    bubble: ListenerEntry[];
    forward: (value?: unknown) => void;
}

const HOST_ROUTERS = new WeakMap<object, FlashEventRouter>();
interface NativeDispatchMarker { readonly target: unknown; readonly token: object; }
const ROUTED_NATIVE = new WeakMap<LayaEvent, Map<string, NativeDispatchMarker>>();

const FLASH_TO_LAYA_EVENT: Readonly<Record<string, string>> = Object.freeze({
    [MouseEvent.CLICK]: LayaEvent.CLICK,
    [MouseEvent.DOUBLE_CLICK]: LayaEvent.DOUBLE_CLICK,
    [MouseEvent.MOUSE_DOWN]: LayaEvent.MOUSE_DOWN,
    [MouseEvent.MOUSE_MOVE]: LayaEvent.MOUSE_MOVE,
    [MouseEvent.MOUSE_OUT]: LayaEvent.MOUSE_OUT,
    [MouseEvent.MOUSE_OVER]: LayaEvent.MOUSE_OVER,
    [MouseEvent.MOUSE_UP]: LayaEvent.MOUSE_UP,
    [MouseEvent.MOUSE_WHEEL]: LayaEvent.MOUSE_WHEEL,
    [MouseEvent.ROLL_OUT]: LayaEvent.MOUSE_OUT,
    [MouseEvent.ROLL_OVER]: LayaEvent.MOUSE_OVER,
    [Event.ADDED]: LayaEvent.ADDED,
    [Event.ADDED_TO_STAGE]: LayaEvent.DISPLAY,
    [Event.CHANGE]: LayaEvent.CHANGE,
    [Event.COMPLETE]: LayaEvent.COMPLETE,
    [Event.REMOVED]: LayaEvent.REMOVED,
    [Event.REMOVED_FROM_STAGE]: LayaEvent.UNDISPLAY,
    [Event.RESIZE]: LayaEvent.RESIZE,
    [FocusEvent.FOCUS_IN]: LayaEvent.FOCUS,
    [FocusEvent.FOCUS_OUT]: LayaEvent.BLUR,
    [TextEvent.TEXT_INPUT]: LayaEvent.BEFORE_INPUT,
    [IMEEvent.IME_COMPOSITION]: LayaEvent.COMPOSITION_UPDATE
});

const MOUSE_EVENT_TYPES = new Set([
    MouseEvent.CLICK, MouseEvent.DOUBLE_CLICK, MouseEvent.MOUSE_DOWN, MouseEvent.MOUSE_MOVE,
    MouseEvent.MOUSE_OUT, MouseEvent.MOUSE_OVER, MouseEvent.MOUSE_UP, MouseEvent.MOUSE_WHEEL,
    MouseEvent.ROLL_OUT, MouseEvent.ROLL_OVER
]);

/** One source-visible Flash listener ledger per real Laya dispatcher. */
export class FlashEventRouter {
    private readonly _types = new Map<string, TypeEntry>();
    private _ordinal = 0;

    constructor(readonly host: NativeEventHost) {
        if ((typeof host !== "object" && typeof host !== "function") || host === null)
            throw new TypeError("FlashEventRouter requires a native Laya event host");
        if (HOST_ROUTERS.has(host as object)) throw new Error("A native host can own only one FlashEventRouter");
        HOST_ROUTERS.set(host as object, this);
    }

    addEventListener(type: string, listener: FlashEventListener, useCapture = false, priority = 0, useWeakReference = false): void {
        if (useWeakReference)
            throw new UnsupportedFlashFeatureError("flash.events.IEventDispatcher.useWeakReference", "weak listener retention is nondeterministic");
        if (typeof listener !== "function") throw new TypeError(`Listener for '${type}' must be a function`);
        if (!Number.isFinite(priority)) throw new TypeError("Listener priority must be finite");
        // Event validates source-visible type without mutating the caller's event state.
        new Event(type);
        let entry = this._types.get(type);
        if (!entry) {
            const nativeType = FlashEventRouter.nativeTypeFor(type);
            entry = { nativeType, capture: [], bubble: [], forward: value => this._forward(type, value) };
            this._types.set(type, entry);
            this.host.on(nativeType, this, entry.forward);
        }
        const list = useCapture ? entry.capture : entry.bubble;
        if (list.some(item => item.listener === listener)) return;
        list.push({ listener, priority, ordinal: this._ordinal++ });
        list.sort((a, b) => b.priority - a.priority || a.ordinal - b.ordinal);
    }

    removeEventListener(type: string, listener: FlashEventListener, useCapture = false): void {
        const entry = this._types.get(type);
        if (!entry) return;
        const list = useCapture ? entry.capture : entry.bubble;
        const index = list.findIndex(item => item.listener === listener);
        if (index >= 0) list.splice(index, 1);
        if (entry.capture.length === 0 && entry.bubble.length === 0) {
            this.host.off(entry.nativeType, this, entry.forward);
            this._types.delete(type);
        }
    }

    hasEventListener(type: string): boolean {
        const entry = this._types.get(type);
        return !!entry && (entry.capture.length > 0 || entry.bubble.length > 0);
    }

    dispatchEvent(event: Event, eventTarget: unknown = this.host): boolean {
        if (!(event instanceof Event)) throw new TypeError("dispatchEvent requires a flash.events.Event instance");
        event._prepareForDispatch(eventTarget);
        this._route(event, eventTarget);
        return !event.isDefaultPrevented();
    }

    dispatchOwnedEvent(event: Event, eventTarget: unknown): boolean {
        if (!(event instanceof Event)) throw new TypeError("dispatchEvent requires a flash.events.Event instance");
        event._prepareForDispatch(eventTarget);
        this._route(event, eventTarget, this);
        return !event.isDefaultPrevented();
    }

    static nativeTypeFor(flashType: string): string { return FLASH_TO_LAYA_EVENT[flashType] ?? flashType; }
    static forHost(host: unknown): FlashEventRouter | undefined {
        return ((typeof host === "object" || typeof host === "function") && host !== null)
            ? HOST_ROUTERS.get(host as object) : undefined;
    }

    private _forward(type: string, value?: unknown): void {
        if (value instanceof Event) return; // programmatic dispatch routes directly and never re-enters Laya.
        if (value instanceof LayaEvent) {
            let routed = ROUTED_NATIVE.get(value);
            if (!routed) ROUTED_NATIVE.set(value, routed = new Map());
            const nativeTarget = value.target ?? this.host;
            const target = getInputEventOwner(nativeTarget) ?? nativeTarget;
            const startsAtTarget = value.currentTarget === nativeTarget;
            const active = routed.get(type);
            if (!startsAtTarget && active?.target === target) return;
            const token = {};
            routed.set(type, { target, token });
            queueMicrotask(() => {
                const markers = ROUTED_NATIVE.get(value);
                if (markers?.get(type)?.token !== token) return;
                markers.delete(type);
                if (markers.size === 0) ROUTED_NATIVE.delete(value);
            });
            const event = this._projectNativeEvent(type, value, target);
            event._prepareForDispatch(target);
            event._bindNativeControl(value);
            this._route(event, target);
            return;
        }
        const event = this._projectNativeEvent(type, value, this.host);
        event._prepareForDispatch(this.host);
        if (event.cancelable && value && typeof value === "object"
            && typeof (value as { preventDefault?: unknown }).preventDefault === "function") {
            const control = value as { preventDefault(): void; stopPropagation?: () => void };
            event._bindNativeControl({
                preventDefault: () => control.preventDefault(),
                stopPropagation: () => control.stopPropagation?.()
            });
        }
        this._route(event, this.host);
    }

    private _projectNativeEvent(type: string, value: unknown, target: unknown): Event {
        if (MOUSE_EVENT_TYPES.has(type)) {
            if (!(value instanceof LayaEvent))
                throw new TypeError(`Native ${type} requires a Laya Event payload`);
            return MouseEvent._fromNative(type, value, target);
        }
        if (type === Event.ADDED || type === Event.REMOVED)
            return new Event(type, true, false);
        if (type === FocusEvent.FOCUS_IN || type === FocusEvent.FOCUS_OUT) {
            const native = value instanceof LayaEvent ? value.nativeEvent : value;
            const record = native && typeof native === "object" ? native as Record<string, unknown> : null;
            const keyCode = record?.keyCode === undefined ? 0 : record.keyCode;
            if (!Number.isInteger(keyCode) || (keyCode as number) < 0)
                throw new TypeError(`Native ${type} keyCode must be a nonnegative integer`);
            return new FocusEvent(type, true, false, record?.relatedTarget ?? null,
                record?.shiftKey === true, keyCode as number, false);
        }
        if (type === TextEvent.TEXT_INPUT) {
            if (!value || typeof value !== "object" || typeof (value as { text?: unknown }).text !== "string")
                throw new TypeError("Native textInput requires exact before-input text");
            return new TextEvent(type, true, true, (value as { text: string }).text);
        }
        if (type === IMEEvent.IME_COMPOSITION) {
            if (!value || typeof value !== "object")
                throw new TypeError("Native imeComposition requires composition payload");
            const data = value as Record<string, unknown>;
            if (typeof data.text !== "string" || !Number.isInteger(data.selectionStart)
                || (data.selectionStart as number) < 0 || !Number.isInteger(data.selectionEnd)
                || (data.selectionEnd as number) < (data.selectionStart as number))
                throw new TypeError("Native imeComposition requires text and ordered nonnegative selection");
            return new IMEEvent(type, true, false, data.text, null);
        }
        return new Event(type, false, false);
    }

    private _route(event: Event, target: unknown, targetRouter = FlashEventRouter.forHost(target) ?? this): void {
        const path: FlashEventRouter[] = [targetRouter];
        if (event.bubbles && target instanceof LayaNode) {
            let node = target.parent;
            while (node) {
                const router = FlashEventRouter.forHost(node);
                if (router) path.push(router);
                node = node.parent;
            }
        }

        if (event.bubbles) {
            for (let index = path.length - 1; index >= 1; index--) {
                path[index]._invoke(event, true, EventPhase.CAPTURING_PHASE);
                if (event._isPropagationStopped) return;
            }
        }

        targetRouter._invoke(event, true, EventPhase.AT_TARGET);
        if (!event._isImmediatePropagationStopped)
            targetRouter._invoke(event, false, EventPhase.AT_TARGET);
        if (!event.bubbles || event._isPropagationStopped) return;

        for (let index = 1; index < path.length; index++) {
            path[index]._invoke(event, false, EventPhase.BUBBLING_PHASE);
            if (event._isPropagationStopped) return;
        }
    }

    private _invoke(event: Event, capture: boolean, phase: EventPhase): void {
        const entry = this._types.get(event.type);
        if (!entry) return;
        event._setCurrentTarget(this.host, phase);
        const list = capture ? entry.capture : entry.bubble;
        for (const item of list.slice()) {
            item.listener(event);
            if (event._isImmediatePropagationStopped) break;
        }
    }
}
