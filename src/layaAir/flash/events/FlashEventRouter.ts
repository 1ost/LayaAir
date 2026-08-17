import { Node as LayaNode } from "../../laya/display/Node";
import { Event as LayaEvent } from "../../laya/events/Event";
import { Event, EventPhase } from "./Event";
import { MouseEvent } from "./MouseEvent";
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
    [Event.RESIZE]: LayaEvent.RESIZE
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
            const target = value.target ?? this.host;
            const startsAtTarget = value.currentTarget === target;
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
            const event = MOUSE_EVENT_TYPES.has(type)
                ? MouseEvent._fromNative(type, value, target)
                : new Event(type, false, false);
            event._prepareForDispatch(target);
            event._bindNativeControl(value);
            this._route(event, target);
            return;
        }
        const event = new Event(type);
        event._prepareForDispatch(this.host);
        this._invoke(event, false, EventPhase.AT_TARGET);
    }

    private _route(event: Event, target: unknown): void {
        const targetRouter = FlashEventRouter.forHost(target) ?? this;
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
