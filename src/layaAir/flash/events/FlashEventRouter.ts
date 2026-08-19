import { ILaya } from "../../ILaya";
import { Node as LayaNode } from "../../laya/display/Node";
import { getInputEventOwner } from "../../laya/display/Input";
import { Event as LayaEvent } from "../../laya/events/Event";
import { readTextBeforeInputPayload, readTextCompositionPayload } from "../../laya/platform/TextInputAdapter";
import { Event, EventPhase } from "./Event";
import { ContextMenuEvent } from "./ContextMenuEvent";
import { FocusEvent } from "./FocusEvent";
import { HTTPStatusEvent } from "./HTTPStatusEvent";
import { IMEEvent } from "./IMEEvent";
import { IOErrorEvent } from "./IOErrorEvent";
import { KeyboardEvent } from "./KeyboardEvent";
import { MouseEvent } from "./MouseEvent";
import { ProgressEvent } from "./ProgressEvent";
import { SecurityErrorEvent } from "./SecurityErrorEvent";
import { TextEvent } from "./TextEvent";
import { TimerEvent } from "./TimerEvent";
import { UncaughtErrorEvent } from "./UncaughtErrorEvent";
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
    detach: () => void;
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
    [Event.ACTIVATE]: LayaEvent.FOCUS,
    [Event.ADDED_TO_STAGE]: LayaEvent.DISPLAY,
    [Event.CHANGE]: LayaEvent.CHANGE,
    [Event.COMPLETE]: LayaEvent.COMPLETE,
    [Event.DEACTIVATE]: LayaEvent.BLUR,
    [Event.REMOVED]: LayaEvent.REMOVED,
    [Event.REMOVED_FROM_STAGE]: LayaEvent.UNDISPLAY,
    [Event.RESIZE]: LayaEvent.RESIZE,
    [Event.ENTER_FRAME]: LayaEvent.FRAME,
    [FocusEvent.FOCUS_IN]: LayaEvent.FOCUS,
    [FocusEvent.FOCUS_OUT]: LayaEvent.BLUR,
    [TextEvent.TEXT_INPUT]: LayaEvent.BEFORE_INPUT,
    [IMEEvent.IME_COMPOSITION]: LayaEvent.COMPOSITION_UPDATE,
    [KeyboardEvent.KEY_DOWN]: LayaEvent.KEY_DOWN,
    [KeyboardEvent.KEY_UP]: LayaEvent.KEY_UP
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
            entry = {
                nativeType, capture: [], bubble: [],
                forward: value => this._forward(type, value), detach: () => undefined
            };
            entry.detach = this._subscribe(type, entry);
            this._types.set(type, entry);
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
            entry.detach();
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

    /** Releases native subscriptions, including global frame loops owned by this router. */
    dispose(): void {
        for (const entry of this._types.values()) entry.detach();
        this._types.clear();
        HOST_ROUTERS.delete(this.host as object);
    }

    private _subscribe(type: string, entry: TypeEntry): () => void {
        if (type === Event.ENTER_FRAME) {
            if (!(this.host instanceof LayaNode))
                throw new TypeError("Flash enterFrame requires a native display host");
            const timer = ILaya.timer;
            if (!timer) throw new Error("Laya timer is unavailable for Flash enterFrame");
            timer.frameLoop(1, this, entry.forward);
            return () => timer.clear(this, entry.forward);
        }
        this.host.on(entry.nativeType, this, entry.forward);
        return () => { this.host.off(entry.nativeType, this, entry.forward); };
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
        const beforeInput = type === TextEvent.TEXT_INPUT
            ? readTextBeforeInputPayload(value, this.host, LayaEvent.BEFORE_INPUT) : null;
        const event = this._projectNativeEvent(type, value, this.host, beforeInput?.snapshot.text);
        event._prepareForDispatch(this.host);
        if (beforeInput) {
            event._bindNativeControl({
                preventDefault: beforeInput.preventDefault,
                stopPropagation: beforeInput.stopPropagation,
            });
        }
        this._route(event, this.host);
    }

    private _projectNativeEvent(type: string, value: unknown, target: unknown, beforeInputText?: string): Event {
        if (MOUSE_EVENT_TYPES.has(type)) {
            if (!(value instanceof LayaEvent))
                throw new TypeError(`Native ${type} requires a Laya Event payload`);
            return MouseEvent._fromNative(type, value, target);
        }
        if (type === KeyboardEvent.KEY_DOWN || type === KeyboardEvent.KEY_UP) {
            if (!(value instanceof LayaEvent))
                throw new TypeError(`Native ${type} requires a Laya Event payload`);
            return KeyboardEvent._fromNative(type, value);
        }
        if (type === IOErrorEvent.IO_ERROR || type === IOErrorEvent.DISK_ERROR
            || type === IOErrorEvent.NETWORK_ERROR || type === IOErrorEvent.VERIFY_ERROR)
            return IOErrorEvent._fromNative(type, value);
        if (type === SecurityErrorEvent.SECURITY_ERROR)
            return SecurityErrorEvent._fromNative(type, value);
        if (type === HTTPStatusEvent.HTTP_STATUS)
            return HTTPStatusEvent._fromNative(type, value);
        if (type === ProgressEvent.PROGRESS)
            return ProgressEvent._fromNative(type, value);
        if (type === ContextMenuEvent.MENU_ITEM_SELECT || type === ContextMenuEvent.MENU_SELECT)
            return ContextMenuEvent._fromNative(type, value);
        if (type === UncaughtErrorEvent.UNCAUGHT_ERROR)
            return UncaughtErrorEvent._fromNative(type, value);
        if (type === TimerEvent.TIMER || type === TimerEvent.TIMER_COMPLETE)
            return new TimerEvent(type);
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
            if (beforeInputText === undefined)
                throw new TypeError("Native textInput requires exact before-input text");
            return new TextEvent(type, true, true, beforeInputText);
        }
        if (type === IMEEvent.IME_COMPOSITION) {
            const data = readTextCompositionPayload(value, target, LayaEvent.COMPOSITION_UPDATE);
            if (!data) throw new TypeError("Native imeComposition requires authenticated composition payload");
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
