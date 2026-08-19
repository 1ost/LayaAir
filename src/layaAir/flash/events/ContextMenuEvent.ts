import { Event as LayaEvent } from "../../laya/events/Event";
import { Event } from "./Event";

const CONTEXT_MENU_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash context-menu events. */
export function isFlashContextMenuEvent(value: unknown): value is ContextMenuEvent {
    return typeof value === "object" && value !== null && CONTEXT_MENU_EVENT_VALUES.has(value);
}

/** Generic context-menu event value; browser menu creation and selection remain host-owned. */
export class ContextMenuEvent extends Event {
    static readonly MENU_ITEM_SELECT = "menuItemSelect";
    static readonly MENU_SELECT = "menuSelect";

    private _mouseTarget: unknown;
    private _contextMenuOwner: unknown;
    private _isMouseTargetInaccessible = false;

    constructor(type: string, bubbles = false, cancelable = false,
        mouseTarget: unknown = null, contextMenuOwner: unknown = null) {
        super(type, bubbles, cancelable);
        this._mouseTarget = mouseTarget;
        this._contextMenuOwner = contextMenuOwner;
        CONTEXT_MENU_EVENT_VALUES.add(this);
    }

    get mouseTarget(): unknown { return this._mouseTarget; }
    set mouseTarget(value: unknown) { this._mouseTarget = value; }
    get contextMenuOwner(): unknown { return this._contextMenuOwner; }
    set contextMenuOwner(value: unknown) { this._contextMenuOwner = value; }
    get isMouseTargetInaccessible(): boolean { return this._isMouseTargetInaccessible; }
    set isMouseTargetInaccessible(value: boolean) { this._isMouseTargetInaccessible = !!value; }

    override clone(): ContextMenuEvent {
        // Pepper Flash 26 resets this producer-owned accessibility flag while preserving both references.
        return new ContextMenuEvent(this.type, this.bubbles, this.cancelable,
            this.mouseTarget, this.contextMenuOwner);
    }

    /** @internal Projects host-owned context-menu data without implementing a browser menu. */
    static _fromNative(type: string, value: unknown): ContextMenuEvent {
        const native = value instanceof LayaEvent ? value.nativeEvent ?? value : value;
        if (native === undefined || native === null) return new ContextMenuEvent(type);
        if (typeof native !== "object") throw new TypeError(`Native ${type} requires a context-menu payload`);
        const data = native as {
            mouseTarget?: unknown; contextMenuOwner?: unknown; isMouseTargetInaccessible?: unknown;
        };
        const event = new ContextMenuEvent(type, false, false,
            data.mouseTarget ?? null, data.contextMenuOwner ?? null);
        if (data.isMouseTargetInaccessible !== undefined)
            event.isMouseTargetInaccessible = data.isMouseTargetInaccessible as boolean;
        return event;
    }
}

Object.freeze(ContextMenuEvent);
